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
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click({ timeout: 5_000 });
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
  browser = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP oktoso.insecure 127.0.0.1"],
  });
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

  it("sends from an insecure origin without crypto.randomUUID", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    await page.goto(`http://oktoso.insecure:${HUB_PORT}`);
    await page
      .getByRole("button", { name: "Sessions" })
      .waitFor({ timeout: 5_000 });

    expect(
      await page.evaluate(() => ({
        secure: window.isSecureContext,
        randomUUID: typeof crypto.randomUUID,
      })),
    ).toEqual({ secure: false, randomUUID: "undefined" });

    await openSession("Fix auth race in gateway");
    const text = `Insecure origin ${Date.now()}`;
    await sendPrompt(text);
    await page
      .locator(".chat-message.user", { hasText: text })
      .waitFor({ timeout: 5_000 });
  });

  it("surfaces a failure that happens before the optimistic message", async () => {
    await openSession("Fix auth race in gateway");
    await page!.evaluate(() => {
      Object.defineProperty(Crypto.prototype, "randomUUID", {
        configurable: true,
        value: () => {
          throw new Error("forced id failure");
        },
      });
    });

    await sendPrompt("Forced preflight failure");
    await page!
      .locator(".alert", { hasText: "forced id failure" })
      .waitFor({ state: "visible", timeout: 2_000 });
    expect(
      await page!
        .locator(".chat-message.user", { hasText: "Forced preflight failure" })
        .count(),
    ).toBe(0);
  });

  it("restores the draft when a send fails", async () => {
    await openSession("Fix auth race in gateway");
    await page!.route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
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
    });

    const text = `Draft ${Date.now()}`;
    const saved = page!.waitForResponse(
      (response) =>
        response.url().includes("/draft") &&
        response.request().method() === "PUT",
      { timeout: 5_000 },
    );
    await sendPrompt(text);
    await page!
      .locator(".message-send-state.error", { hasText: "Not sent." })
      .waitFor({ state: "visible", timeout: 3_000 });
    await saved;

    await page!.reload();
    await page!.locator(".chat-composer textarea").waitFor();
    await page!.waitForFunction(
      (expected) =>
        (
          document.querySelector(
            ".chat-composer textarea",
          ) as HTMLTextAreaElement | null
        )?.value === expected,
      text,
      { timeout: 5_000 },
    );
  });

  it("queues a running follow-up and promotes or removes it", async () => {
    await openSession("Refactor session index");
    await sendPrompt(`Slow queue check ${Date.now()}`);

    const queueAction = page!.getByRole("button", {
      name: "Queue message for the running agent",
    });
    await queueAction.waitFor({ state: "visible", timeout: 5_000 });

    const text = `Queued ${Date.now()}`;
    await page!.locator(".chat-composer textarea").fill(text);
    await queueAction.click();

    const tray = page!.locator(".composer-queued");
    await tray.waitFor({ state: "visible", timeout: 5_000 });
    expect(await tray.textContent()).toContain(text);
    expect(await page!.locator(".composer-queued-list").count()).toBe(0);
    expect(
      await page!.locator(".chat-message.user", { hasText: text }).count(),
    ).toBe(0);

    if (!page) throw new Error("The E2E page is not ready");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page!.locator(".composer-queued-summary").click();
    await page!.locator(".composer-queued-list").waitFor({ timeout: 5_000 });
    await tray.getByRole("button", { name: "Send now" }).click();
    await tray.waitFor({ state: "hidden", timeout: 5_000 });

    const second = `Queued again ${Date.now()}`;
    await page!.locator(".chat-composer textarea").fill(second);
    await queueAction.click();
    await tray.waitFor({ state: "visible", timeout: 5_000 });
    await page!.locator(".composer-queued-summary").click();
    await tray.getByRole("button", { name: "Remove queued message" }).click();
    await tray.waitFor({ state: "hidden", timeout: 5_000 });
    expect(
      await page!.locator(".chat-message.user", { hasText: second }).count(),
    ).toBe(0);
  });

  it("opens the mobile model sheet and keeps Suggest inline", async () => {
    await openSession("Fix auth race in gateway");
    await page!.setViewportSize({ width: 390, height: 844 });

    const suggest = page!.getByRole("button", { name: "Suggest", exact: true });
    await suggest.waitFor({ state: "visible", timeout: 5_000 });

    const chip = page!.getByRole("button", { name: /Model and agent/ });
    await chip.waitFor({ state: "visible", timeout: 5_000 });
    await chip.click();

    const sheet = page!.getByRole("dialog", { name: "Model & agent" });
    await sheet.waitFor({ state: "visible", timeout: 3_000 });
    await sheet.getByRole("combobox", { name: "Agent" }).waitFor();

    await page!.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 3_000 });
    expect(
      await page!.evaluate(() =>
        document.activeElement?.classList.contains("composer-context-chip"),
      ),
    ).toBe(true);
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

describe("session search", () => {
  it("finds a provider archive session that is not in the recent list", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    await page.getByRole("button", { name: "Search" }).click();
    const input = page.locator("#session-search");
    await input.waitFor({ timeout: 5_000 });
    await input.fill("Quarterly archive");

    const result = page.getByRole("button", {
      name: /Quarterly archive review/,
    });
    await result.waitFor({ timeout: 5_000 });
    expect(await result.textContent()).toContain("Quarterly archive review");
  });
});

describe("navigation history", () => {
  function currentPath(): string {
    if (!page) throw new Error("The E2E page is not ready");
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }

  it("moves between the sessions list and a chat with browser back and forward", async () => {
    await openSession("Fix auth race in gateway");
    const chatPath = currentPath();
    expect(chatPath).toMatch(/^\/sessions\//);

    await page!.goBack();
    await page!.getByRole("button", { name: "New session" }).waitFor();
    expect(currentPath()).toBe("/sessions");

    await page!.goForward();
    await page!.locator(".chat-composer textarea").waitFor();
    expect(currentPath()).toBe(chatPath);
  });

  it("closes and reopens the mobile details sheet with history", async () => {
    await page!.setViewportSize({ width: 390, height: 844 });
    await openSession("Fix auth race in gateway");

    await page!.getByRole("button", { name: "Details", exact: true }).click();
    await page!.locator("#session-details").waitFor();
    expect(currentPath()).toContain("details=1");

    await page!.goBack();
    await page!.locator("#session-details").waitFor({ state: "hidden" });
    await page!.locator(".chat-composer textarea").waitFor();
    expect(currentPath()).not.toContain("details=1");

    await page!.goForward();
    await page!.locator("#session-details").waitFor();
    expect(currentPath()).toContain("details=1");
  });

  it("opens and closes the new-session panel with history", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    await page.getByRole("button", { name: "Sessions" }).click();
    await page.getByRole("button", { name: "New session" }).click();
    await page.getByRole("heading", { name: "New session" }).waitFor();
    expect(currentPath()).toBe("/sessions?new=1");

    await page.goBack();
    await page.getByRole("heading", { name: "New session" }).waitFor({
      state: "hidden",
    });
    expect(currentPath()).toBe("/sessions");

    await page.goForward();
    await page.getByRole("heading", { name: "New session" }).waitFor();
  });

  it("updates the search URL without adding a history step per keystroke", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    await page.getByRole("button", { name: "Sessions" }).click();
    await page.getByRole("button", { name: "Search" }).click();
    const input = page.locator("#session-search");
    await input.waitFor();
    await input.fill("auth");

    await page.waitForFunction(() => window.location.search.includes("q=auth"));
    expect(currentPath()).toContain("/search?q=auth");

    await page.goBack();
    await page.getByRole("button", { name: "New session" }).waitFor();
    expect(currentPath()).toBe("/sessions");

    await page.goForward();
    await input.waitFor();
    expect(await input.inputValue()).toBe("auth");
  });

  it("restores a deep link and canonicalizes unknown routes", async () => {
    await openSession("Fix auth race in gateway");
    const chatUrl = page!.url();

    await page!.goto(chatUrl);
    await page!.locator(".chat-composer textarea").waitFor();
    expect(currentPath()).toMatch(/^\/sessions\//);

    await page!.goto(`${BASE_URL}/not-a-route`);
    await page!.getByRole("button", { name: "Sessions" }).waitFor();
    expect(new URL(page!.url()).pathname).toBe("/foundation");
  });
});

describe("responsive history surfaces", () => {
  it("has no horizontal overflow or console errors across widths", async () => {
    if (!page) throw new Error("The E2E page is not ready");
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });

      await page.goto(`${BASE_URL}/inbox`);
      await page.locator(".inbox-tabs").waitFor();
      await expectNoHorizontalOverflow(width, "inbox");

      await page.goto(`${BASE_URL}/sessions`);
      await page.locator(".session-list-item").first().waitFor();
      await expectNoHorizontalOverflow(width, "sessions");

      await page.locator(".session-list-item").first().click();
      await page.locator(".chat-composer textarea").waitFor();
      await expectNoHorizontalOverflow(width, "chat");

      // The chat must span the viewport on mobile, not sit in a grid column
      // sized for the desktop sidebar.
      if (width <= 760) {
        const panelWidth = await page
          .locator(".chat-panel")
          .evaluate((element) => element.getBoundingClientRect().width);
        expect(panelWidth, `chat panel width at ${width}px`).toBeGreaterThan(
          width * 0.8,
        );
      }
    }

    expect(errors).toEqual([]);
  }, 120_000);

  async function expectNoHorizontalOverflow(
    width: number,
    surface: string,
  ): Promise<void> {
    if (!page) throw new Error("The E2E page is not ready");
    const overflow = await page.evaluate(() => ({
      document:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      body: document.body.scrollWidth > document.body.clientWidth,
    }));
    expect(overflow, `${surface} at ${width}px`).toEqual({
      document: false,
      body: false,
    });
  }
});
