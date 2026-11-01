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
import { AssistantSettingsService } from "./services/assistant-settings";
import { ReplyService } from "./services/reply-service";
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

async function createTestApp(options: {
  store?: StateStore;
  cors?: string[];
  appsRoot?: string;
  auth?: AuthService;
  providerConfigPath?: string;
} = {}) {
  const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
  servers.push(fake);
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
    settings,
    replies,
    questions,
    logger,
    startedAt: Date.now(),
    appsRoot: options.appsRoot,
    auth: options.auth,
  });
  return { app, eventBus, store, registry, sessions, attention, drafts, settings, replies, questions, fake };
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
    expect(await page.text()).toContain("Pair this device");
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
