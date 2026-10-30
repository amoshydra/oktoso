import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "./app";
import { loadConfig } from "./config/load";
import { createLogger } from "./lib/logger";
import { EventBus } from "./services/event-bus";
import { ProviderRegistry } from "./services/provider-registry";
import { SessionService } from "./services/session-service";
import { AttentionService } from "./services/attention-service";
import { DraftService } from "./services/draft-service";
import { AssistantSettingsService } from "./services/assistant-settings";
import { ReplyService } from "./services/reply-service";
import {
  JsonStateStore,
  MemoryStateStore,
  type StateStore,
} from "@agent-hub/storage";
import { createFakeProviderServer, type FakeProviderServer } from "@agent-hub/testing";

const token = "test-token-long-enough";
const logger = createLogger({ level: "silent" });
const servers: FakeProviderServer[] = [];
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-hub-app-"));
  roots.push(root);
  return root;
}

async function createTestApp(options: { store?: StateStore; cors?: string[]; appsRoot?: string } = {}) {
  const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
  servers.push(fake);
  const config = await loadConfig(
    new URL("../test/fixtures/hub.config.json", import.meta.url).pathname,
    { HUB_TOKEN: token, OPENCODE_PASSWORD: "secret" },
  );
  config.providers[0]!.baseUrl = fake.url;
  if (options.cors) config.cors = options.cors;
  const store = options.store ?? new MemoryStateStore();
  const eventBus = new EventBus(store, logger, { heartbeatMs: 10 });
  await eventBus.init();
  const registry = new ProviderRegistry(config.providers, logger);
  const sessions = new SessionService(registry, logger, { store });
  const attention = new AttentionService(registry, sessions, store, eventBus, logger);
  const drafts = new DraftService(store);
  const settings = new AssistantSettingsService(store);
  const replies = new ReplyService(settings, sessions, logger);
  const app = createApp({
    config,
    store,
    eventBus,
    registry,
    sessions,
    attention,
    drafts,
    settings,
    replies,
    logger,
    startedAt: Date.now(),
    appsRoot: options.appsRoot,
  });
  return { app, eventBus, store, registry, sessions, attention, drafts, settings, replies, fake };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hub app", () => {
  it("supports wildcard CORS for local hardware clients", async () => {
    const { app } = await createTestApp({ cors: ["*"] });
    const response = await app.request("/api/v1/auth/check", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("serves device apps under /apps/<id>/ with per-app fallback", async () => {
    const root = await tempRoot();
    const appsRoot = join(root, "apps");
    await mkdir(join(appsRoot, "even-g2", "assets"), { recursive: true });
    await writeFile(
      join(appsRoot, "even-g2", "index.html"),
      "<!doctype html><title>G2 test app</title>",
    );
    await writeFile(
      join(appsRoot, "even-g2", "assets", "app.js"),
      "console.log('g2')",
    );
    const { app } = await createTestApp({ appsRoot });

    const index = await app.request("/apps/even-g2/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("G2 test app");
    expect(index.headers.get("x-frame-options")).toBeNull();

    const redirect = await app.request("/apps/even-g2");
    expect(redirect.status).toBe(308);

    const asset = await app.request("/apps/even-g2/assets/app.js");
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("console.log");

    const fallback = await app.request("/apps/even-g2/deep/route");
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain("G2 test app");

    expect((await app.request("/apps/missing/")).status).toBe(404);
    expect(
      (await app.request("/apps/even-g2/assets/missing.js")).status,
    ).toBe(404);
  });

  it("serves public health", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, version: "0.1.0" });
  });

  it("requires the bearer token for API routes", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/api/v1/auth/check")).status).toBe(401);
    const response = await app.request("/api/v1/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("lists providers and diagnostics with auth", async () => {
    const { app, registry } = await createTestApp();
    await registry.check("desktop-opencode");
    const providers = await app.request("/api/v1/providers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(providers.status).toBe(200);
    expect(await providers.json()).toMatchObject({
      data: [{ id: "desktop-opencode", status: "online" }],
    });

    const sessionsResponse = await app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sessionsResponse.status).toBe(200);
    const sessionsBody = (await sessionsResponse.json()) as { data: Array<{ ref: string }> };
    expect(sessionsBody.data).toHaveLength(3);
    expect(sessionsBody.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ ref: "desktop-opencode:ses_auth" })]),
    );

    const sessionResponse = await app.request("/api/v1/sessions/desktop-opencode%3Ases_auth", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      ref: "desktop-opencode:ses_auth",
      title: "Fix auth race in gateway",
    });

    const messagesResponse = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages?order=asc",
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(messagesResponse.status).toBe(200);
    const messagesBody = (await messagesResponse.json()) as {
      data: Array<{ role: string }>;
    };
    expect(messagesBody.data).toHaveLength(3);
    expect(messagesBody.data[0]?.role).toBe("user");

    const diagnostics = await app.request("/api/v1/diagnostics", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(diagnostics.status).toBe(200);
    expect(await diagnostics.json()).toMatchObject({
      events: { lastSeq: 0 },
      storage: { kind: "memory" },
    });
  });

  it("searches session metadata across the hub cache", async () => {
    const { app } = await createTestApp();
    const headers = { Authorization: `Bearer ${token}` };

    const byTitle = await app.request("/api/v1/sessions?q=auth", { headers });
    expect(byTitle.status).toBe(200);
    const titlePage = (await byTitle.json()) as {
      data: Array<{ ref: string; title: string }>;
    };
    expect(titlePage.data).toHaveLength(1);
    expect(titlePage.data[0]).toMatchObject({
      ref: "desktop-opencode:ses_auth",
      title: "Fix auth race in gateway",
    });

    const filtered = await app.request(
      "/api/v1/sessions?q=agent-hub&status=error&provider=desktop-opencode",
      { headers },
    );
    expect(filtered.status).toBe(200);
    const filteredPage = (await filtered.json()) as {
      data: Array<{ ref: string; status: string }>;
    };
    expect(filteredPage.data).toHaveLength(1);
    expect(filteredPage.data[0]).toMatchObject({
      ref: "desktop-opencode:ses_rust",
      status: "error",
    });

    const wrongProvider = await app.request(
      "/api/v1/sessions?q=auth&provider=missing-provider",
      { headers },
    );
    expect(
      ((await wrongProvider.json()) as { data: unknown[] }).data,
    ).toHaveLength(0);

    // Message bodies stay out of the hub cache search.
    const messageOnly = await app.request(
      "/api/v1/sessions?q=double-refresh",
      { headers },
    );
    expect(
      ((await messageOnly.json()) as { data: unknown[] }).data,
    ).toHaveLength(0);
  });

  it("stores, updates, and clears per-session drafts", async () => {
    const { app, store } = await createTestApp();
    const ref = "desktop-opencode:ses_auth";
    const path = `/api/v1/sessions/${encodeURIComponent(ref)}/draft`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const empty = await app.request(path, { headers });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: null });

    const created = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ text: "half-written reply" }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      data: { sessionRef: string; text: string; updatedAt: number };
    };
    expect(createdBody.data).toMatchObject({
      sessionRef: ref,
      text: "half-written reply",
    });
    expect(createdBody.data.updatedAt).toBeGreaterThan(0);
    expect(store.getState().drafts[ref]?.text).toBe("half-written reply");

    const loaded = await app.request(path, { headers });
    expect(await loaded.json()).toMatchObject({
      data: { sessionRef: ref, text: "half-written reply" },
    });

    const updated = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ text: "revised reply" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      data: { sessionRef: ref, text: "revised reply" },
    });

    const invalid = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ text: 42 }),
    });
    expect(invalid.status).toBe(400);

    const oversized = await app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ text: "x".repeat(100_001) }),
    });
    expect(oversized.status).toBe(400);

    const removed = await app.request(path, { method: "DELETE", headers });
    expect(removed.status).toBe(204);
    expect(store.getState().drafts[ref]).toBeUndefined();

    const afterDelete = await app.request(path, { headers });
    expect(await afterDelete.json()).toEqual({ data: null });

    const removedAgain = await app.request(path, { method: "DELETE", headers });
    expect(removedAgain.status).toBe(204);
  });

  it("exposes assistant settings and canned reply options", async () => {
    const { app } = await createTestApp();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const initial = await app.request("/api/v1/settings/assistant", { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      data: {
        reply: {
          enabled: true,
          baseUrl: "http://127.0.0.1:8080/v1",
          model: "Gemma-4-E4B-Uncensored-HauhauCS-Aggressive",
          hasApiKey: false,
        },
        transcription: { enabled: false },
      },
    });

    const updated = await app.request("/api/v1/settings/assistant", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        reply: { enabled: false, model: "small-4b" },
        transcription: { enabled: true, baseUrl: "https://stt.example/v1" },
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      data: {
        reply: { enabled: false, model: "small-4b" },
        transcription: { enabled: true, baseUrl: "https://stt.example/v1" },
      },
    });

    const options = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/reply-options?mode=reply",
      { headers },
    );
    expect(options.status).toBe(200);
    const payload = (await options.json()) as {
      data: Array<{ id: string; action: string; source: string }>;
    };
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "continue", action: "send", source: "canned" }),
        expect.objectContaining({ id: "alternatives", action: "send" }),
        expect.objectContaining({ id: "stop", action: "interrupt" }),
      ]),
    );
    expect(payload.data.some((item) => item.source === "model")).toBe(false);
  });

  it("persists drafts across a JSON state reload", async () => {
    const root = await tempRoot();
    const filePath = join(root, "state.json");
    const firstStore = await JsonStateStore.open({ filePath });
    const first = await createTestApp({ store: firstStore });
    const ref = "desktop-opencode:ses_index";
    const path = `/api/v1/sessions/${encodeURIComponent(ref)}/draft`;
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const saved = await first.app.request(path, {
      method: "PUT",
      headers,
      body: JSON.stringify({ text: "survives a restart" }),
    });
    expect(saved.status).toBe(200);
    await firstStore.close();

    const reopened = await JsonStateStore.open({ filePath });
    const second = await createTestApp({ store: reopened });
    const loaded = await second.app.request(path, { headers });
    expect(loaded.status).toBe(200);
    expect(await loaded.json()).toMatchObject({
      data: { sessionRef: ref, text: "survives a restart" },
    });
    await reopened.close();
  });

  it("exposes options, creates sessions, sends prompts, and interrupts", async () => {
    const { app } = await createTestApp();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const optionsResponse = await app.request(
      "/api/v1/providers/desktop-opencode/options",
      { headers },
    );
    expect(optionsResponse.status).toBe(200);
    expect(await optionsResponse.json()).toMatchObject({
      agents: [{ id: "build" }],
      models: [{ id: "commandcode/claude-sonnet" }],
    });

    const createResponse = await app.request("/api/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerID: "desktop-opencode",
        title: "Adapter smoke test",
        directory: "/home/me/agent-hub",
        agent: "build",
        model: "commandcode/claude-sonnet",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { ref: string; title: string };
    expect(created.title).toBe("Adapter smoke test");

    const sendResponse = await app.request(
      `/api/v1/sessions/${encodeURIComponent(created.ref)}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Reply with exactly OK." }),
      },
    );
    expect(sendResponse.status).toBe(202);
    expect(await sendResponse.json()).toMatchObject({ accepted: true });

    const messagesResponse = await app.request(
      `/api/v1/sessions/${encodeURIComponent(created.ref)}/messages?order=asc`,
      { headers },
    );
    const messages = (await messagesResponse.json()) as {
      data: Array<{ role: string; parts: unknown[] }>;
    };
    expect(messages.data.some((message) => message.role === "assistant")).toBe(true);

    const interruptResponse = await app.request(
      `/api/v1/sessions/${encodeURIComponent(created.ref)}/interrupt`,
      { method: "POST", headers },
    );
    expect(interruptResponse.status).toBe(204);
  });

  it("lists and resolves provider attention", async () => {
    const { app, eventBus } = await createTestApp();
    const headers = { Authorization: `Bearer ${token}` };

    const listResponse = await app.request("/api/v1/attention", { headers });
    expect(listResponse.status).toBe(200);
    const page = (await listResponse.json()) as {
      data: Array<{ id: string; type: string; sessionRef: string; fields?: unknown[] }>;
    };
    const permission = page.data.find((item) => item.type === "permission");
    const question = page.data.find((item) => item.type === "question");
    const unread = page.data.find((item) => item.type === "unread");
    expect(permission).toBeDefined();
    expect(question).toBeDefined();
    expect(unread).toBeDefined();
    expect(page.data.some((item) => item.type === "error")).toBe(true);
    const created = eventBus
      .replay(0)
      .events.filter((event) => event.type === "attention.created");
    expect(created.some((event) => event.attentionID === permission!.id)).toBe(true);
    expect(created.some((event) => event.attentionID === question!.id)).toBe(true);

    const permissionResponse = await app.request(
      `/api/v1/attention/${encodeURIComponent(permission!.id)}/actions/approve_once`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(permissionResponse.status).toBe(204);
    expect(
      eventBus
        .replay(0)
        .events.some(
          (event) =>
            event.type === "attention.resolved" &&
            event.attentionID === permission!.id,
        ),
    ).toBe(true);

    const answerResponse = await app.request(
      `/api/v1/attention/${encodeURIComponent(question!.id)}/actions/answer`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ fields: { model: "claude-sonnet", remember: true } }),
      },
    );
    expect(answerResponse.status).toBe(204);
    expect(
      eventBus
        .replay(0)
        .events.some(
          (event) =>
            event.type === "attention.resolved" &&
            event.attentionID === question!.id,
        ),
    ).toBe(true);

    const unreadResponse = await app.request(
      `/api/v1/attention/${encodeURIComponent(unread!.id)}/actions/mark_read`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(unreadResponse.status).toBe(204);

    const after = await app.request("/api/v1/attention", { headers });
    const afterPage = (await after.json()) as { data: Array<{ id: string }> };
    expect(afterPage.data.some((item) => item.id === permission!.id)).toBe(false);
    expect(afterPage.data.some((item) => item.id === question!.id)).toBe(false);
    expect(afterPage.data.some((item) => item.id === unread!.id)).toBe(false);
  });

  it("drops cached sessions when the provider no longer reports them", async () => {
    const { sessions, fake } = await createTestApp();
    const created = await sessions.create({
      providerID: "desktop-opencode",
      title: "Ephemeral provider session",
      directory: "/home/me/agent-hub",
    });
    expect(
      (await sessions.list({ limit: 200 })).data.some(
        (session) => session.ref === created.ref,
      ),
    ).toBe(true);

    const deleteResponse = await fetch(
      `${fake.url}/api/session/${encodeURIComponent(created.nativeID)}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(204);
    await sessions.refresh();

    expect(
      (await sessions.list({ limit: 200 })).data.some(
        (session) => session.ref === created.ref,
      ),
    ).toBe(false);
  });

  it("opens an authenticated SSE stream and replay", async () => {
    const { app, eventBus } = await createTestApp();
    const response = await app.request("/api/v1/events?after=0", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    expect(new TextDecoder().decode(first.value)).toContain("retry: 3000");
    await eventBus.publish("provider.status", { id: "desktop-opencode" });
    const next = await reader!.read();
    expect(new TextDecoder().decode(next.value)).toContain("provider.status");
    await reader!.cancel();
  });
});
