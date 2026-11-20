import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  createFakeProviderServer,
  type FakeProviderServer,
} from "@amoshydra/oktoso-testing";

const HUB_PORT = 8801;
const TOKEN = "e2e-token-long-enough";
const BASE_URL = `http://127.0.0.1:${HUB_PORT}`;
const ANSWER = "The session is waiting on the e2e question.";

let provider: FakeProviderServer | undefined;
let model: Server | undefined;
let root: string | undefined;
let hub: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The E2E hub did not become healthy");
}

/** A minimal OpenAI-compatible streaming endpoint for the assistant. */
function createFakeModel(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      if (!request.url?.endsWith("/chat/completions")) {
        response.writeHead(404).end();
        return;
      }
      request.resume();
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const frames = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: ANSWER } }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 42, completion_tokens: 8 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ];
      for (const frame of frames) response.write(frame);
      response.end();
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The fake model did not bind"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

beforeAll(async () => {
  provider = await createFakeProviderServer({ kind: "opencode", port: 0 });
  const fake = await createFakeModel();
  model = fake.server;
  root = await mkdtemp(join(tmpdir(), "oktoso-assistant-e2e-"));
  const configPath = join(root, "hub.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port: HUB_PORT,
        token: TOKEN,
        dataDir: join(root, "data"),
        assistant: {
          enabled: true,
          baseUrl: fake.url,
          model: "e2e-assistant",
          timeoutMs: 10_000,
          maxContextMessages: 8,
        },
        providers: [
          {
            id: "desktop-opencode",
            type: "opencode",
            name: "Desktop OpenCode",
            baseUrl: provider.url,
            auth: {
              kind: "basic",
              username: "opencode",
              password: "e2e-password",
            },
            enabled: true,
          },
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  hub = spawn(process.execPath, ["dist/hub.js", "--config", configPath], {
    env: {
      ...process.env,
      HUB_TUI: "0",
      HUB_PAIRING_PROMPT: "0",
      LOG_LEVEL: "error",
    },
    stdio: "ignore",
  });
  await waitForHealth();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  hub?.kill("SIGTERM");
  await provider?.close();
  await new Promise<void>((resolve) => {
    if (!model) return resolve();
    model.close(() => resolve());
  });
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!browser) throw new Error("The E2E browser is not ready");
  page = await browser.newPage();
  await page.addInitScript((token) => {
    sessionStorage.setItem("oktoso-token", token);
  }, TOKEN);
  await page.goto(BASE_URL);
  await page.getByRole("button", { name: "Sessions" }).waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: "Sessions" }).click();
  await page
    .getByRole("button", { name: /Fix auth race in gateway/ })
    .first()
    .click({ timeout: 5_000 });
  await page.locator(".chat-composer textarea").waitFor({ timeout: 5_000 });
});

afterEach(async () => {
  await page?.close();
  page = undefined;
});

describe("session assistant", () => {
  it("answers inside a read-only dock and keeps the thread", async () => {
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    await page!.locator("#assistant-input").fill("why is this stuck?");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    expect(await page!.locator("#assistant-input").isEnabled()).toBe(true);
    await page!.locator("#assistant-input").press("Enter");

    const answer = page!.locator(".assistant-turn.assistant .assistant-turn-text", {
      hasText: ANSWER,
    });
    await answer.waitFor({ timeout: 15_000 });
    expect(await page!.locator(".assistant-readonly").innerText()).toBe(
      "READ-ONLY · NO WRITES",
    );

    // The thread survives a reload: it is hub state, not a provider session.
    await page!.reload();
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .waitFor({ timeout: 10_000 });
    await page!.getByRole("button", { name: "Ask", exact: true }).click();
    await page!
      .locator(".assistant-turn.assistant .assistant-turn-text", { hasText: ANSWER })
      .waitFor({ timeout: 10_000 });
    expect(
      await page!.locator(".assistant-turn.user .assistant-turn-text", {
        hasText: "why is this stuck?",
      }).count(),
    ).toBe(1);
  });
});
