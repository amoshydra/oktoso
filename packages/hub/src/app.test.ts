import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { loadConfig } from "./config/load";
import { createLogger } from "./lib/logger";
import { EventBus } from "./services/event-bus";
import { ProviderRegistry } from "./services/provider-registry";
import { SessionService } from "./services/session-service";
import { AttentionService } from "./services/attention-service";
import { MemoryStateStore } from "@agent-hub/storage";
import { createFakeProviderServer, type FakeProviderServer } from "@agent-hub/testing";

const token = "test-token-long-enough";
const logger = createLogger({ level: "silent" });
const servers: FakeProviderServer[] = [];

async function createTestApp() {
  const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
  servers.push(fake);
  const config = await loadConfig(
    new URL("../test/fixtures/hub.config.json", import.meta.url).pathname,
    { HUB_TOKEN: token, OPENCODE_PASSWORD: "secret" },
  );
  config.providers[0]!.baseUrl = fake.url;
  const store = new MemoryStateStore();
  const eventBus = new EventBus(store, logger, { heartbeatMs: 10 });
  await eventBus.init();
  const registry = new ProviderRegistry(config.providers, logger);
  const sessions = new SessionService(registry, logger);
  const attention = new AttentionService(registry, sessions, store, eventBus, logger);
  const app = createApp({
    config,
    store,
    eventBus,
    registry,
    sessions,
    attention,
    logger,
    startedAt: Date.now(),
  });
  return { app, eventBus, store, registry, sessions, attention, fake };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("hub app", () => {
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
    expect(permission).toBeDefined();
    expect(question).toBeDefined();
    expect(page.data.some((item) => item.type === "unread")).toBe(true);
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

    const after = await app.request("/api/v1/attention", { headers });
    const afterPage = (await after.json()) as { data: Array<{ id: string }> };
    expect(afterPage.data.some((item) => item.id === permission!.id)).toBe(false);
    expect(afterPage.data.some((item) => item.id === question!.id)).toBe(false);
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
