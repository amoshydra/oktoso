import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appErrorFor, createApp } from "./app";
import { AuthService } from "./auth/service";
import { SESSION_TTL_SECONDS } from "./auth/session";
import { loadConfig } from "./config/load";
import { createLogger } from "./lib/logger";
import { EventBus } from "./services/event-bus";
import { ProviderRegistry } from "./services/provider-registry";
import { ProviderAdminService } from "./services/provider-admin";
import { SessionService } from "./services/session-service";
import { AttentionService } from "./services/attention-service";
import { DraftService } from "./services/draft-service";
import { AttachmentStore } from "./services/attachment-store";
import { AssistantSettingsService } from "./services/assistant-settings";
import { ReplyService } from "./services/reply-service";
import { TranscriptionService } from "./services/transcription-service";
import { QuestionService } from "./services/question-service";
import { VERSION } from "./version";
import {
  JsonStateStore,
  MemoryStateStore,
  type StateStore,
} from "@amoshydra/oktoso-storage";
import {
  createFakeProviderServer,
  resetFakeProviderState,
  type FakeProviderServer,
} from "@amoshydra/oktoso-testing";

const token = "test-token-long-enough";
const logger = createLogger({ level: "silent" });
const servers: FakeProviderServer[] = [];
const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-app-"));
  roots.push(root);
  return root;
}

function formAudio(bytes: Uint8Array, type: string): FormData {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array(bytes)], "clip", { type }));
  return form;
}

function formFile(name: string, body: string, type: string): FormData {
  const form = new FormData();
  form.set("file", new File([body], name, { type }));
  return form;
}

async function createTestApp(options: {
  store?: StateStore;
  cors?: string[];
  appsRoot?: string;
  auth?: AuthService;
  providerConfigPath?: string;
  transcriptionFetch?: typeof fetch;
  openwebui?: boolean;
} = {}) {
  const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
  servers.push(fake);
  const openwebui = options.openwebui
    ? await createFakeProviderServer({ kind: "openwebui", port: 0 })
    : undefined;
  if (openwebui) servers.push(openwebui);
  // The loader refuses a config that other accounts can read, and git cannot
  // store 0600, so copy the tracked fixture into an owner-only temp file.
  const configPath = join(await tempRoot(), "hub.config.json");
  await writeFile(
    configPath,
    await readFile(new URL("../test/fixtures/hub.config.json", import.meta.url), "utf8"),
    { mode: 0o600 },
  );
  const config = await loadConfig(configPath, {
    HUB_TOKEN: token,
    OPENCODE_PASSWORD: "secret",
  });
  config.providers[0]!.baseUrl = fake.url;
  if (openwebui) {
    config.providers.push({
      id: "fake-openwebui",
      type: "openwebui",
      name: "fake-openwebui",
      baseUrl: openwebui.url,
      auth: { kind: "bearer", token: "fake-token" },
      enabled: true,
      timeoutMs: 20_000,
    });
  }
  if (options.cors) config.cors = options.cors;
  const store = options.store ?? new MemoryStateStore();
  const eventBus = new EventBus(store, logger, { heartbeatMs: 10 });
  await eventBus.init();
  const registry = new ProviderRegistry(config.providers, logger);
  const attachments = new AttachmentStore({
    root: join(await tempRoot(), "attachments"),
  });
  await attachments.init();
  const sessions = new SessionService(registry, logger, {
    store,
    attachments,
  });
  const attention = new AttentionService(registry, sessions, store, eventBus, logger);
  const drafts = new DraftService(store);
  const settings = new AssistantSettingsService(store);
  const replies = new ReplyService(settings, sessions, logger);
  const transcription = new TranscriptionService(
    settings,
    logger,
    options.transcriptionFetch,
  );
  const questions = new QuestionService(sessions);
  const providerAdmin = options.providerConfigPath
    ? new ProviderAdminService(
        registry,
        sessions,
        attention,
        undefined,
        logger,
        options.providerConfigPath,
      )
    : undefined;
  const app = createApp({
    config,
    store,
    eventBus,
    registry,
    ...(providerAdmin ? { providerAdmin } : {}),
    sessions,
    attention,
    drafts,
    attachments,
    settings,
    replies,
    transcription,
    questions,
    logger,
    startedAt: Date.now(),
    appsRoot: options.appsRoot,
    auth: options.auth,
  });
  return {
    app,
    eventBus,
    store,
    registry,
    sessions,
    attention,
    drafts,
    attachments,
    settings,
    replies,
    transcription,
    questions,
    fake,
    openwebui,
  };
}

afterEach(async () => {
  resetFakeProviderState();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hub error mapping", () => {
  it("maps operation timeouts to a retryable 504", () => {
    expect(appErrorFor(new DOMException("timed out", "TimeoutError"))).toMatchObject({
      code: "timeout",
      status: 504,
      retryable: true,
    });
  });
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
    expect(await response.json()).toMatchObject({ ok: true, version: VERSION });
  });

  it("requires a hub credential for API routes", async () => {
    const { app } = await createTestApp();
    expect((await app.request("/api/v1/auth/check")).status).toBe(401);
    const response = await app.request("/api/v1/auth/check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      auth: { kind: "owner" },
    });
  });

  it("proxies provider attachments with safe headers", async () => {
    const { app, fake } = await createTestApp();
    const image = encodeURIComponent(`${fake.url}/api/files/shot.png`);
    const response = await app.request(
      `/api/v1/attachments?provider=desktop-opencode&url=${image}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const text = encodeURIComponent(`${fake.url}/api/files/note.txt`);
    const download = await app.request(
      `/api/v1/attachments?provider=desktop-opencode&url=${text}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/plain");
    expect(download.headers.get("content-disposition")).toContain("attachment");
  });

  it("rejects attachment URLs outside the provider origin", async () => {
    const { app } = await createTestApp();
    const url = encodeURIComponent("https://example.com/shot.png");
    const response = await app.request(
      `/api/v1/attachments?provider=desktop-opencode&url=${url}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("requires hub auth for attachments", async () => {
    const { app, fake } = await createTestApp();
    const url = encodeURIComponent(`${fake.url}/api/files/shot.png`);
    const response = await app.request(
      `/api/v1/attachments?provider=desktop-opencode&url=${url}`,
    );
    expect(response.status).toBe(401);
  });

  it("issues and redeems a single-use pairing code for a JSON client", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });

    const pair = await app.request("/api/v1/auth/pair", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pair.status).toBe(200);
    const { code, expiresIn } = (await pair.json()) as {
      code: string;
      expiresIn: number;
    };
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(expiresIn).toBe(300);

    const connect = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    expect(connect.status).toBe(200);
    const { token: session, expiresAt } = (await connect.json()) as {
      token: string;
      expiresAt: number;
    };
    expect(session).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const check = await app.request("/api/v1/auth/check", {
      headers: { Authorization: `Bearer ${session}` },
    });
    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({ auth: { kind: "session" } });

    const replay = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(replay.status).toBe(401);
  });

  it("does not consume a pairing code when the link is viewed", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const pairing = auth.issuePairing();

    const page = await app.request(`/pair/${pairing.code}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Pair this device");
    expect(html).toContain('font-family: "Inter Variable"');
    expect(html).toContain('font-family: "IBM Plex Mono"');
    expect(html).toContain("data:font/woff2;base64,");
    expect(page.headers.get("set-cookie")).toBeNull();

    const exchange = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(exchange.status).toBe(200);
  });

  it("sets an HttpOnly session cookie when the pairing form is submitted", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });

    const pair = await app.request("/api/v1/auth/pair", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = (await pair.json()) as { code: string };

    const form = await app.request(`/pair/${code}`, {
      method: "POST",
      headers: { Origin: "http://localhost" },
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/");

    const setCookie = form.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("oktoso_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(setCookie).not.toContain("Secure");

    const cookie = setCookie.split(";")[0]!;
    const check = await app.request("/api/v1/auth/check", {
      headers: { Cookie: cookie },
    });
    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({ auth: { kind: "session" } });
  });

  it("accepts a pairing confirmation from an embedded webview origin", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });

    const pair = await app.request("/api/v1/auth/pair", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = (await pair.json()) as { code: string };

    const form = await app.request(`/pair/${code}`, {
      method: "POST",
      headers: {
        Origin: "https://even.app",
        "Sec-Fetch-Site": "cross-site",
      },
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("set-cookie")).toContain("oktoso_session=");
  });

  it("shows an already-paired page without consuming a valid link", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const cookie = `oktoso_session=${auth.mintSession().token}`;
    const pairing = auth.issuePairing();

    const page = await app.request(`/pair/${pairing.code}`, {
      headers: { Cookie: cookie },
    });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Already paired");

    const exchange = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(exchange.status).toBe(200);
  });

  it("marks the session cookie Secure behind an HTTPS proxy", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });

    const pair = await app.request("/api/v1/auth/pair", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const { code } = (await pair.json()) as { code: string };

    const form = await app.request(`/pair/${code}`, {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(form.status).toBe(303);
    expect(form.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects a non-JSON pairing exchange without consuming the code", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const pairing = auth.issuePairing();

    const form = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `code=${pairing.code}`,
    });
    expect(form.status).toBe(400);

    const exchange = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(exchange.status).toBe(200);
  });

  it("does not let a paired session create another pairing code", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });

    const response = await app.request("/api/v1/auth/pair", {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.mintSession().token}` },
    });
    expect(response.status).toBe(403);
  });

  it("rejects cross-origin cookie mutations", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const cookie = `oktoso_session=${auth.mintSession().token}`;

    const crossOrigin = await app.request(
      "/api/v1/providers/desktop-opencode/check",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://evil.example",
          Host: "localhost",
        },
      },
    );
    expect(crossOrigin.status).toBe(403);

    const sameOrigin = await app.request(
      "/api/v1/providers/desktop-opencode/check",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost",
          Host: "localhost",
        },
      },
    );
    expect(sameOrigin.status).toBe(200);
  });

  it("rejects expired pairing and session tokens", async () => {
    let now = Date.now();
    const auth = new AuthService(token, { now: () => now });
    const { app } = await createTestApp({ auth });

    const pairing = auth.issuePairing();
    now = pairing.expiresAt;
    const expiredPage = await app.request(`/pair/${pairing.code}`);
    expect(expiredPage.status).toBe(401);

    const expiredExchange = await app.request("/api/v1/auth/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pairing.code }),
    });
    expect(expiredExchange.status).toBe(401);

    const session = auth.mintSession();
    now = session.expiresAt;
    const expiredSession = await app.request("/api/v1/auth/check", {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(expiredSession.status).toBe(401);
  });

  it("explains an expired pairing link to a browser", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/pair/not-a-code");
    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain("Pairing link expired");
    expect(html).toContain("<code>p</code>");
    expect(html).toContain("<code>pair</code>");
  });

  it("serves the pairing page as HTML even when Accept is */*", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const pairing = auth.issuePairing();

    const page = await app.request(`/pair/${pairing.code}`, {
      headers: { Accept: "*/*", "Sec-Fetch-Mode": "navigate" },
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
  });

  it("sends an already-paired browser to the app when a link is reused", async () => {
    const auth = new AuthService(token);
    const { app } = await createTestApp({ auth });
    const cookie = `oktoso_session=${auth.mintSession().token}`;

    const response = await app.request("/pair/not-a-code", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  it("refreshes a session token on demand", async () => {
    let now = Date.now();
    const auth = new AuthService(token, { now: () => now });
    const { app } = await createTestApp({ auth });
    const session = auth.mintSession();
    now += 1_000;

    const response = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(response.status).toBe(200);
    const refreshed = (await response.json()) as {
      token: string;
      expiresAt: number;
    };
    expect(refreshed.token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(refreshed.expiresAt).toBeGreaterThan(session.expiresAt);

    const owner = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(owner.status).toBe(400);
  });

  it("refreshes a near-expiry session cookie automatically", async () => {
    let now = Date.now();
    const auth = new AuthService(token, { now: () => now });
    const { app } = await createTestApp({ auth });
    const session = auth.mintSession();
    now = session.expiresAt - 6 * 24 * 60 * 60 * 1000;

    const response = await app.request("/api/v1/auth/check", {
      headers: { Cookie: `oktoso_session=${session.token}` },
    });
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("oktoso_session=");
    const refreshedToken = setCookie.split(";")[0]!.split("=")[1]!;
    expect(refreshedToken).not.toBe(session.token);

    const body = (await response.json()) as {
      auth: { expiresAt: number };
    };
    expect(body.auth.expiresAt).toBeGreaterThan(session.expiresAt);
  });

  it("clears the session cookie on signout", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/api/v1/auth/signout", {
      method: "POST",
      headers: { Cookie: "oktoso_session=stale" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("adds a provider, persists it, and hot-loads the adapter", async () => {
    const root = await tempRoot();
    const configPath = join(root, "hub.config.json");
    await writeFile(
      configPath,
      JSON.stringify({ token, providers: [] }, null, 2),
      { mode: 0o600 },
    );
    const { app, registry, fake } = await createTestApp({
      providerConfigPath: configPath,
    });

    const response = await app.request("/api/v1/providers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: "second-opencode",
        type: "opencode",
        name: "Second OpenCode",
        baseUrl: fake.url,
        auth: { kind: "basic", username: "opencode", password: "secret" },
        enabled: true,
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        id: "second-opencode",
        authKind: "basic",
        status: "online",
      },
    });
    expect(registry.list().some((provider) => provider.id === "second-opencode")).toBe(true);

    const saved = JSON.parse(await readFile(configPath, "utf8")) as {
      providers: Array<{ id: string }>;
    };
    expect(saved.providers.map((provider) => provider.id)).toEqual([
      "second-opencode",
    ]);
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

  it("returns a pending question from the latest assistant message", async () => {
    const { app } = await createTestApp();
    const headers = { Authorization: `Bearer ${token}` };

    const response = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/question",
      { headers },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        sessionRef: "desktop-opencode:ses_auth",
        questions: [
          {
            kind: "boolean",
            choices: [{ text: "Yes" }, { text: "No" }],
          },
        ],
      },
    });

    const none = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_index/question",
      { headers },
    );
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ data: null });
  });

  it("returns pending question summaries for cheap discovery", async () => {
    const { app } = await createTestApp();
    const headers = { Authorization: `Bearer ${token}` };

    const response = await app.request(
      "/api/v1/questions?ref=desktop-opencode%3Ases_auth&ref=desktop-opencode%3Ases_index",
      { headers },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        sessionRef: string;
        questionCount: number;
        text: string;
      }>;
      failed: string[];
    };
    expect(body.failed).toEqual([]);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      sessionRef: "desktop-opencode:ses_auth",
      questionCount: 1,
      text: "Should I continue with the double-refresh case?",
    });

    const missing = await app.request("/api/v1/questions", { headers });
    expect(missing.status).toBe(400);
  });

  it("rejects stale answers and deduplicates retries", async () => {
    const { app } = await createTestApp();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const questionResponse = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/question",
      { headers },
    );
    const questionBody = (await questionResponse.json()) as {
      data: {
        messageId: string;
        revision: string;
        questions: Array<{ id: string }>;
      };
    };
    const prompt = questionBody.data;
    const answer = {
      questionId: prompt.questions[0]!.id,
      messageId: prompt.messageId,
      revision: prompt.revision,
      source: "boolean" as const,
    };

    const stale = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "Yes",
          answer: { ...answer, revision: "stale-revision" },
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: {
        code: "conflict",
        details: { reason: "question_changed" },
      },
    });

    const beforeResponse = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages?order=asc",
      { headers },
    );
    const before = (await beforeResponse.json()) as { data: unknown[] };

    const send = () =>
      app.request("/api/v1/sessions/desktop-opencode%3Ases_auth/messages", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "answer-1" },
        body: JSON.stringify({ text: "Yes", answer }),
      });

    const first = await send();
    expect(first.status).toBe(202);
    const firstBody = await first.json();
    const second = await send();
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual(firstBody);

    const afterResponse = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages?order=asc",
      { headers },
    );
    const after = (await afterResponse.json()) as { data: unknown[] };
    expect(after.data.length).toBe(before.data.length + 2);

    const resolved = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "answer-2" },
        body: JSON.stringify({ text: "Yes", answer }),
      },
    );
    expect(resolved.status).toBe(409);
    expect(await resolved.json()).toMatchObject({
      error: {
        code: "conflict",
        details: { reason: "question_resolved" },
      },
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
      "/api/v1/sessions?q=oktoso&status=error&provider=desktop-opencode",
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
          model: "gemma-3-4b-it",
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

  it("transcribes audio through the configured endpoint", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const transcriptionFetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ text: "  hello from whisper  " }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const { app } = await createTestApp({ transcriptionFetch });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const disabled = await app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array([1, 2, 3]), "audio/webm"),
    });
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toMatchObject({
      error: { code: "transcription_disabled" },
    });

    const saved = await app.request("/api/v1/settings/assistant", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        transcription: {
          enabled: true,
          baseUrl: "https://stt.example/v1/",
          model: "whisper-1",
          apiKey: "stt-secret",
        },
      }),
    });
    expect(saved.status).toBe(200);

    const missing = await app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: new FormData(),
    });
    expect(missing.status).toBe(400);

    const unsupported = await app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array([1, 2, 3]), "application/pdf"),
    });
    expect(unsupported.status).toBe(400);

    const response = await app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array([1, 2, 3]), "audio/webm"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { text: "hello from whisper", model: "whisper-1" },
    });
    expect(captured?.url).toBe(
      "https://stt.example/v1/audio/transcriptions",
    );
    const upstreamHeaders = new Headers(captured?.init?.headers);
    expect(upstreamHeaders.get("authorization")).toBe("Bearer stt-secret");
    const upstreamForm = captured?.init?.body as FormData;
    expect(upstreamForm.get("model")).toBe("whisper-1");
    expect(upstreamForm.get("response_format")).toBe("json");
    const file = upstreamForm.get("file") as File;
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe(3);
  });

  it("does not apply the JSON body limit to transcription audio", async () => {
    const transcriptionFetch = (async () =>
      new Response(JSON.stringify({ text: "large clip" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const { app } = await createTestApp({ transcriptionFetch });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    await app.request("/api/v1/settings/assistant", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        transcription: {
          enabled: true,
          baseUrl: "https://stt.example/v1",
          model: "whisper-1",
        },
      }),
    });

    const response = await app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array(1_100_000), "audio/webm"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { text: "large clip" },
    });
  });

  it("maps transcription endpoint failures and timeouts", async () => {
    const failing = (async () =>
      new Response("upstream exploded", { status: 503 })) as typeof fetch;
    const failingApp = await createTestApp({ transcriptionFetch: failing });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    await failingApp.app.request("/api/v1/settings/assistant", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        transcription: {
          enabled: true,
          baseUrl: "https://stt.example/v1",
          model: "whisper-1",
        },
      }),
    });
    const failed = await failingApp.app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array([1]), "audio/webm"),
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      error: { code: "transcription_failed", retryable: true },
    });

    const timeoutFetch = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    const timeoutApp = await createTestApp({ transcriptionFetch: timeoutFetch });
    await timeoutApp.app.request("/api/v1/settings/assistant", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        transcription: {
          enabled: true,
          baseUrl: "https://stt.example/v1",
          model: "whisper-1",
        },
      }),
    });
    const timedOut = await timeoutApp.app.request("/api/v1/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formAudio(new Uint8Array([1]), "audio/webm"),
    });
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toMatchObject({
      error: { code: "transcription_timeout", retryable: true },
    });
  });

  it("allows the web client to request the microphone", async () => {
    const { app } = await createTestApp();
    const response = await app.request("/api/v1/health");
    expect(response.headers.get("permissions-policy")).toContain(
      "microphone=(self)",
    );
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
      agents: [{ id: "build" }, { id: "plan" }],
      models: [
        {
          id: "commandcode/claude-sonnet",
          variants: [{ id: "max" }, { id: "high" }],
        },
      ],
    });

    const createResponse = await app.request("/api/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        providerID: "desktop-opencode",
        title: "Adapter smoke test",
        directory: "/home/me/oktoso",
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

    const selectionResponse = await app.request(
      `/api/v1/sessions/${encodeURIComponent(created.ref)}/selection`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          agent: "plan",
          model: "commandcode/claude-sonnet#high",
        }),
      },
    );
    expect(selectionResponse.status).toBe(200);
    expect(await selectionResponse.json()).toMatchObject({
      agent: "plan",
      model: "commandcode/claude-sonnet#high",
    });

    const emptySelection = await app.request(
      `/api/v1/sessions/${encodeURIComponent(created.ref)}/selection`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(emptySelection.status).toBe(400);

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
      directory: "/home/me/oktoso",
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
  it("accepts a batch answer covering every pending question", async () => {
    const { app } = await createTestApp();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const questionResponse = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/question",
      { headers },
    );
    const questionBody = (await questionResponse.json()) as {
      data: {
        messageId: string;
        revision: string;
        questions: Array<{ id: string }>;
      };
    };
    const prompt = questionBody.data;
    const response = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: "1. Yes",
          answers: prompt.questions.map((question) => ({
            questionId: question.id,
            messageId: prompt.messageId,
            revision: prompt.revision,
            source: "text",
          })),
        }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true });
  });

});

describe("chat attachments and branches", () => {
  it("uploads an attachment, sends it, and removes the staged copy", async () => {
    const { app, attachments } = await createTestApp();
    const auth = { Authorization: `Bearer ${token}` };

    const uploaded = await app.request("/api/v1/attachments", {
      method: "POST",
      headers: auth,
      body: formFile("notes.txt", "the secret word is ORANGE", "text/plain"),
    });
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()) as {
      data: { id: string; name: string; mimeType: string; size: number };
    };
    expect(attachment.data).toMatchObject({
      name: "notes.txt",
      mimeType: "text/plain",
      size: "the secret word is ORANGE".length,
    });

    const sent = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages",
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Read the attached notes.",
          attachments: [attachment.data.id],
        }),
      },
    );
    expect(sent.status).toBe(202);

    const page = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/messages?order=asc&limit=20",
      { headers: auth },
    );
    const payload = (await page.json()) as {
      data: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const user = payload.data
      .filter((message) => message.role === "user")
      .at(-1);
    expect(user?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Read the attached notes." }),
        expect.objectContaining({
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          url: expect.stringMatching(/^data:text\/plain;base64,/),
        }),
      ]),
    );

    await expect(attachments.read(attachment.data.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("rejects unsupported attachment types and sends supported ones", async () => {
    const { app, sessions, attachments } = await createTestApp({ openwebui: true });
    await sessions.refresh();
    const auth = { Authorization: `Bearer ${token}` };

    const unsupported = await app.request("/api/v1/attachments", {
      method: "POST",
      headers: auth,
      body: formFile("tool.bin", "nope", "application/x-msdownload"),
    });
    expect(unsupported.status).toBe(400);

    const uploaded = await app.request("/api/v1/attachments", {
      method: "POST",
      headers: auth,
      body: formFile("notes.txt", "hello", "text/plain"),
    });
    const attachment = (await uploaded.json()) as { data: { id: string } };

    const sent = await app.request(
      "/api/v1/sessions/fake-openwebui%3Achat_fake_openwebui/messages",
      {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Try an attachment",
          attachments: [attachment.data.id],
        }),
      },
    );
    expect(sent.status).toBe(202);

    const page = await app.request(
      "/api/v1/sessions/fake-openwebui%3Achat_fake_openwebui/messages?order=asc&limit=100",
      { headers: auth },
    );
    const payload = (await page.json()) as {
      data: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const user = payload.data.filter((message) => message.role === "user").at(-1);
    expect(user?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "Try an attachment" }),
        expect.objectContaining({
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
        }),
      ]),
    );

    await expect(attachments.read(attachment.data.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("lists and switches Open WebUI in-chat branches", async () => {
    const { app, sessions } = await createTestApp({ openwebui: true });
    await sessions.refresh();
    const headers = { Authorization: `Bearer ${token}` };
    const ref = "fake-openwebui:chat_fake_branches";
    const path = `/api/v1/sessions/${encodeURIComponent(ref)}`;

    const initial = await app.request(`${path}/branches`, { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({
      data: [
        {
          messageId: "branch-assistant-2",
          role: "assistant",
          siblingIds: ["branch-assistant-1", "branch-assistant-2"],
          index: 1,
          count: 2,
        },
      ],
    });

    const switched = await app.request(`${path}/branches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ siblingId: "branch-assistant-1" }),
    });
    expect(switched.status).toBe(200);

    const messages = await app.request(`${path}/messages?order=asc`, { headers });
    const payload = (await messages.json()) as {
      data: Array<{ id: string }>;
    };
    const ids = payload.data.map((message) => message.id);
    expect(ids).toContain("branch-answer-1");
    expect(ids).not.toContain("branch-answer-2");

    const after = await app.request(`${path}/branches`, { headers });
    expect(await after.json()).toMatchObject({
      data: [
        {
          messageId: "branch-assistant-1",
          index: 0,
          count: 2,
        },
      ],
    });
  });

  it("retries an Open WebUI assistant as a new sibling", async () => {
    const { app, sessions } = await createTestApp({ openwebui: true });
    await sessions.refresh();
    const headers = { Authorization: `Bearer ${token}` };
    const path =
      "/api/v1/sessions/fake-openwebui%3Achat_fake_branches";

    const retried = await app.request(`${path}/retry`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: "branch-assistant-2" }),
    });
    expect(retried.status).toBe(202);
    expect(await retried.json()).toMatchObject({ accepted: true });

    const branches = await app.request(`${path}/branches`, { headers });
    expect(await branches.json()).toMatchObject({
      data: [{ index: 2, count: 3 }],
    });
  });

  it("forks an OpenCode session before a message", async () => {
    const { app } = await createTestApp();
    const headers = { Authorization: `Bearer ${token}` };

    const forked = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/fork",
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ before: "msg_auth_answer" }),
      },
    );
    expect(forked.status).toBe(200);
    const payload = (await forked.json()) as {
      data: { ref: string; parentRef?: string; title: string };
    };
    expect(payload.data).toMatchObject({
      parentRef: "desktop-opencode:ses_auth",
      title: "Fix auth race in gateway (fork)",
    });

    const page = await app.request(
      `/api/v1/sessions/${encodeURIComponent(payload.data.ref)}/messages?order=asc`,
      { headers },
    );
    const messages = (await page.json()) as { data: Array<{ id: string }> };
    expect(messages.data.map((message) => message.id)).toEqual([
      "msg_auth_user",
      "msg_auth_reasoning",
    ]);

    const noBranches = await app.request(
      "/api/v1/sessions/desktop-opencode%3Ases_auth/branches",
      { headers },
    );
    expect(await noBranches.json()).toEqual({ data: [] });
  });

  it("rejects forking for a provider without fork support", async () => {
    const { app, sessions } = await createTestApp({ openwebui: true });
    await sessions.refresh();
    const response = await app.request(
      "/api/v1/sessions/fake-openwebui%3Achat_fake_openwebui/fork",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(response.status).toBe(501);
  });
});
