import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  createFakeProviderServer,
  type FakeProviderServer,
} from "@amoshydra/oktoso-testing";

const HUB_PORT = 8799;
const TOKEN = "e2e-token-long-enough";
const BASE_URL = `http://127.0.0.1:${HUB_PORT}`;

let providers: FakeProviderServer[] = [];
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
      // The hub is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The E2E hub did not become healthy");
}

async function openSession(title: string): Promise<void> {
  if (!page) throw new Error("The E2E page is not ready");
  await page.getByRole("button", { name: "Sessions" }).click();
  await page.getByRole("button", { name: new RegExp(title) }).click({ timeout: 5_000 });
  await page.locator(".chat-composer textarea").waitFor({ timeout: 5_000 });
}

async function sendPrompt(text: string): Promise<void> {
  if (!page) throw new Error("The E2E page is not ready");
  await page.locator(".chat-composer textarea").fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

beforeAll(async () => {
  providers = await Promise.all([
    createFakeProviderServer({ kind: "opencode", port: 0 }),
    createFakeProviderServer({ kind: "openwebui", port: 0 }),
    createFakeProviderServer({ kind: "hermes", port: 0 }),
  ]);
  root = await mkdtemp(join(tmpdir(), "oktoso-e2e-"));
  const configPath = join(root, "hub.config.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port: HUB_PORT,
        token: TOKEN,
        dataDir: join(root, "data"),
        providers: [
          {
            id: "desktop-opencode",
            type: "opencode",
            name: "Desktop OpenCode",
            baseUrl: providers[0]!.url,
            auth: {
              kind: "basic",
              username: "opencode",
              password: "e2e-password",
            },
            enabled: true,
          },
          {
            id: "openwebui",
            type: "openwebui",
            name: "Open WebUI",
            baseUrl: providers[1]!.url,
            auth: { kind: "bearer", token: "e2e-token" },
            enabled: true,
          },
          {
            id: "rpi-hermes",
            type: "hermes",
            name: "Hermes",
            baseUrl: providers[2]!.url,
            auth: { kind: "bearer", token: "e2e-token" },
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
  await Promise.all(providers.map((provider) => provider.close()));
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
});

afterEach(async () => {
  await page?.close();
  page = undefined;
});

describe("chat sending", () => {
  it("renders the user message before the send request completes", async () => {
    await openSession("Fix auth race in gateway");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page!.route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    });

    const text = `Optimistic ${Date.now()}`;
    await sendPrompt(text);

    await page!
      .locator(".chat-message.user", { hasText: text })
      .waitFor({ state: "visible", timeout: 1_000 });
    await page!.locator(".message-send-state", { hasText: "Sending…" }).waitFor({
      state: "visible",
      timeout: 1_000,
    });

    release();
    await page!.waitForTimeout(1_200);
    expect(
      await page!.locator(".chat-message.user", { hasText: text }).count(),
    ).toBe(1);
  });

  it("marks a failed send and retries with the same idempotency key", async () => {
    await openSession("Fix auth race in gateway");
    let failNext = true;
    const keys: string[] = [];
    await page!.route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      if (failNext) {
        failNext = false;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "internal",
              message: "E2E forced send failure",
              retryable: true,
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    const text = `Retry ${Date.now()}`;
    await sendPrompt(text);
    const failed = page!.locator(".message-send-state.error", {
      hasText: "Not sent.",
    });
    await failed.waitFor({ state: "visible", timeout: 3_000 });
    await failed.getByRole("button", { name: "Retry" }).click();
    await page!
      .locator(".message-send-state", { hasText: "Sending…" })
      .waitFor({ state: "visible", timeout: 2_000 });
    await failed.waitFor({ state: "hidden", timeout: 3_000 });

    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    await page!.waitForTimeout(1_200);
    expect(
      await page!.locator(".chat-message.user", { hasText: text }).count(),
    ).toBe(1);
  });

  it("shows Open WebUI folders and sends an attachment", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    await page.getByRole("button", { name: "Sessions" }).click();
    const row = page.getByRole("button", { name: /Fake Open WebUI chat/ });
    await row.waitFor({ timeout: 5_000 });
    expect(await row.textContent()).toContain("Research");
    await row.click();
    await page.locator(".chat-composer textarea").waitFor();

    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("E2E attachment"),
    });
    await page.getByText("notes.txt").first().waitFor({ timeout: 5_000 });
    await page.locator(".chat-composer textarea").fill("Attachment E2E");
    await page.getByRole("button", { name: "Send message" }).click();

    const message = page.locator(".chat-message.user", {
      hasText: "Attachment E2E",
    });
    await message.waitFor({ timeout: 5_000 });
    expect(await message.textContent()).toContain("notes.txt");
  });

  it("edits a user message by forking and prefilling the new draft", async () => {
    await openSession("Fix auth race in gateway");
    const original = page!.locator(".chat-message.user", {
      hasText: "Continue with the failing test.",
    });
    await original
      .getByRole("button", { name: "Edit message and fork the session" })
      .click();
    const editor = page!.locator('textarea[aria-label="Edit message"]');
    await editor.waitFor();
    await editor.fill("Edited prompt from E2E");
    await page!.getByRole("button", { name: "Save & fork" }).click();

    await page!.waitForFunction(
      () =>
        (document.querySelector(".chat-composer textarea") as HTMLTextAreaElement | null)
          ?.value === "Edited prompt from E2E",
      undefined,
      { timeout: 5_000 },
    );
    expect(await page!.locator(".chat-doc-title").textContent()).toContain("fork");
  });
});
