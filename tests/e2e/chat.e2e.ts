import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
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

  it("stacks the session scope under the summary on a narrow screen", async () => {
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.getByRole("button", { name: "Sessions" }).click();
    const panel = page!.locator(".sessions-panel");
    await panel.locator(".session-scope").waitFor();
    const geometry = await panel.evaluate((element) => {
      const summary = element.querySelector(".panel-head p")!;
      const scope = element.querySelector(".session-scope")!;
      return {
        summaryBottom: summary.getBoundingClientRect().bottom,
        scopeTop: scope.getBoundingClientRect().top,
        chipTops: Array.from(scope.querySelectorAll(".chip")).map((chip) =>
          Math.round(chip.getBoundingClientRect().top),
        ),
      };
    });
    expect(geometry.scopeTop).toBeGreaterThanOrEqual(geometry.summaryBottom);
    expect(new Set(geometry.chipTops).size).toBe(1);
  });

  it("keeps the running mobile composer controls at 44px without overlap", async () => {
    await openSession("Port hub to Rust");
    await page!.setViewportSize({ width: 390, height: 844 });
    await page!.locator(".chat-composer textarea").fill(`Slow cluster ${Date.now()}`);
    await page!.getByRole("button", { name: "Send message" }).click();
    await page!
      .getByRole("button", { name: "Interrupt the running agent" })
      .waitFor({ timeout: 5_000 });

    const rects = await page!.evaluate(() => {
      const selectors = {
        more: ".composer-tools-toggle",
        stop: ".composer-interrupt",
        send: ".composer-send",
      };
      const result: Record<string, { x: number; w: number; h: number; right: number } | null> = {};
      for (const [key, selector] of Object.entries(selectors)) {
        const node = document.querySelector(selector);
        if (!node) {
          result[key] = null;
          continue;
        }
        const rect = node.getBoundingClientRect();
        result[key] = {
          x: Math.round(rect.x),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          right: Math.round(rect.right),
        };
      }
      return result;
    });

    for (const key of ["more", "stop", "send"] as const) {
      expect(rects[key]).not.toBeNull();
      expect(rects[key]!.w).toBe(44);
      expect(rects[key]!.h).toBe(44);
    }
    expect(rects.more!.right).toBeLessThanOrEqual(rects.stop!.x);
    expect(rects.stop!.right).toBeLessThanOrEqual(rects.send!.x);

    const glyphs = await page!.evaluate(() => {
      const more = document.querySelector(".composer-tools-toggle");
      const send = document.querySelector(".composer-send");
      return {
        moreText: more?.textContent?.trim() ?? "",
        moreIcon: Boolean(more?.querySelector("svg")),
        sendIcon: Boolean(send?.querySelector("svg")),
        themeVisible: Boolean(
          document.querySelector(".app-shell.chat-open .topbar-theme")
            ? getComputedStyle(
                document.querySelector(".app-shell.chat-open .topbar-theme")!,
              ).display !== "none"
            : false,
        ),
      };
    });
    expect(glyphs.moreText).toBe("");
    expect(glyphs.moreIcon).toBe(true);
    expect(glyphs.sendIcon).toBe(true);
    expect(glyphs.themeVisible).toBe(false);
  });

  it("keeps the topbar as the only page title", async () => {
    await openSession("Fix auth race in gateway");
    expect(await page!.locator("h1").count()).toBe(1);
    expect(await page!.locator(".chat-doc-title").count()).toBe(0);
    expect(
      await page!.locator(".topbar-title").textContent(),
    ).toContain("Fix auth race in gateway");
  });

  it("floats the jump and keeps the composer fixed while the transcript fades", async () => {
    await openSession("Refactor session index");
    const composerTop = await page!
      .locator(".chat-composer-wrap")
      .evaluate((element) => Math.round(element.getBoundingClientRect().top));

    await page!.locator(".chat-panel").evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    });
    await page!.waitForTimeout(400);

    const middle = await page!.evaluate(() => {
      const panel = document.querySelector(".chat-panel")!;
      const jump = document.querySelector(".chat-jump-float")!;
      const row = document.querySelector(".chat-background-row");
      const style = getComputedStyle(panel);
      return {
        classes: panel.className,
        jumpOpacity: getComputedStyle(jump).opacity,
        jumpHidden: jump.getAttribute("aria-hidden"),
        jumpAria: jump.getAttribute("aria-label"),
        jumpText: jump.textContent?.trim() ?? "",
        measure: getComputedStyle(document.querySelector(".chat-message")!).maxWidth,
        fadeTop: style.getPropertyValue("--fade-top").trim(),
        fadeBottom: style.getPropertyValue("--fade-bottom").trim(),
        masked: style.maskImage !== "none",
        composerTop: Math.round(
          document
            .querySelector(".chat-composer-wrap")!
            .getBoundingClientRect().top,
        ),
        rowInPanel: row ? panel.contains(row) : false,
        rowText: row?.textContent?.trim() ?? "",
      };
    });

    expect(middle.classes).toContain("has-above");
    expect(middle.classes).toContain("has-below");
    expect(middle.jumpOpacity).toBe("1");
    expect(middle.jumpAria).toBeNull();
    expect(middle.jumpText.length).toBeGreaterThan(0);
    expect(middle.measure).toBe("640px");
    expect(middle.fadeTop).toBe("24px");
    expect(middle.fadeBottom).toBe("24px");
    expect(middle.masked).toBe(true);
    expect(middle.composerTop).toBe(composerTop);
    expect(middle.rowInPanel).toBe(true);
    expect(middle.rowText).toContain("1 shell running");

    await page!.locator(".chat-jump-float").click();
    await page!.waitForFunction(
      () => {
        const panel = document.querySelector(".chat-panel")!;
        const jump = document.querySelector(".chat-jump-float")!;
        return (
          panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2 &&
          getComputedStyle(jump).opacity === "0"
        );
      },
      undefined,
      { timeout: 5_000 },
    );

    const bottom = await page!.evaluate(() => {
      const panel = document.querySelector(".chat-panel")!;
      const jump = document.querySelector(".chat-jump-float")!;
      const style = getComputedStyle(panel);
      return {
        classes: panel.className,
        jumpHidden: jump.getAttribute("aria-hidden"),
        fadeBottom: style.getPropertyValue("--fade-bottom").trim(),
        composerTop: Math.round(
          document
            .querySelector(".chat-composer-wrap")!
            .getBoundingClientRect().top,
        ),
      };
    });

    expect(bottom.classes).toContain("has-above");
    expect(bottom.classes).not.toContain("has-below");
    expect(bottom.fadeBottom).toBe("0px");
    expect(bottom.jumpHidden).toBe("true");
    expect(bottom.composerTop).toBe(composerTop);
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
    // The draft arrives before the fork's session header; the topbar shows
    // "Session" until it resolves.
    await page!.waitForFunction(
      () =>
        document
          .querySelector(".topbar-title")
          ?.textContent?.toLowerCase()
          .includes("fork") === true,
      undefined,
      { timeout: 10_000 },
    );
    expect(await page!.locator(".topbar-title").textContent()).toContain("fork");
  });

  it("streams a file-part video through a preview ticket", async () => {
    await openSession("Fix auth race in gateway");
    const video = page!.locator("video.message-attachment-video").last();
    await video.waitFor({ timeout: 5_000 });
    const src = await video.getAttribute("src");
    // A session path becomes a ticket URL, not an authenticated blob.
    expect(src).toMatch(/^\/preview\/[0-9a-f-]+\/race\.mp4$/);

    const ranged = await page!.request.get(`${BASE_URL}${src}`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-3\/\d+$/);
    expect((await ranged.body()).byteLength).toBe(4);
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

  it("renames a session from the details panel", async () => {
    await page!.setViewportSize({ width: 1440, height: 900 });
    await openSession("Fix auth race in gateway");
    await page!.locator("#session-details").waitFor();
    try {
      await page!.getByRole("button", { name: "Rename" }).click();
      const input = page!.locator("#session-rename-input");
      await input.fill("Renamed from e2e");
      await page!.getByRole("button", { name: "Save", exact: true }).focus();
      await page!.keyboard.press("Escape");
      await page!.locator("#session-details").waitFor({ state: "visible" });
      await page!.getByRole("button", { name: "Rename" }).waitFor();
      await page!.getByRole("button", { name: "Rename" }).click();
      await page!.locator("#session-rename-input").fill("Renamed from e2e");
      await page!.getByRole("button", { name: "Save", exact: true }).click();
      await page!.waitForFunction(
        () =>
          document.querySelector(".topbar-title")?.textContent ===
          "Renamed from e2e",
        undefined,
        { timeout: 5_000 },
      );
      expect(
        await page!.locator(".session-rename-row strong").textContent(),
      ).toBe("Renamed from e2e");
    } finally {
      const token = await page!.evaluate(() =>
        sessionStorage.getItem("oktoso-token"),
      );
      await page!.request.patch(
        `${BASE_URL}/api/v1/sessions/${encodeURIComponent("desktop-opencode:ses_auth")}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          data: { title: "Fix auth race in gateway" },
        },
      );
    }
  });

  it("closes the desktop details column with Escape and restores focus", async () => {
    await page!.setViewportSize({ width: 1440, height: 900 });
    await openSession("Fix auth race in gateway");
    // Above 1320px the column opens automatically with the session.
    await page!.locator("#session-details").waitFor();
    await page!.getByRole("button", { name: "Details", exact: true }).click();
    await page!.locator("#session-details").waitFor({ state: "hidden" });
    await page!.getByRole("button", { name: "Details", exact: true }).click();
    await page!.locator("#session-details").waitFor();
    await page!.keyboard.press("Escape");
    await page!.locator("#session-details").waitFor({ state: "hidden" });
    expect(
      await page!.evaluate(() =>
        document.activeElement?.classList.contains("topbar-details"),
      ),
    ).toBe(true);
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
    // Session rows can contain "search" in their title; match the rail control.
    await page.getByRole("button", { name: "Search", exact: true }).click();
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

describe("notification settings", () => {
  it("saves routing and keeps it across a reload", async () => {
    await page!.goto(`${BASE_URL}/settings`);
    await page!.getByRole("heading", { name: "Notifications" }).waitFor();

    const enabled = page!.getByLabel("Send notifications");
    if (!(await enabled.isChecked())) await enabled.check();
    await page!.getByLabel("Quiet hours").check();
    await page!.getByLabel("Start", { exact: true }).fill("23:00");
    await page!.getByLabel("End", { exact: true }).fill("06:00");
    await page!.getByRole("button", { name: "Save routing" }).click();
    await page!
      .getByText("Notification settings saved.")
      .waitFor({ state: "visible" });

    await page!.reload();
    await page!.getByRole("heading", { name: "Notifications" }).waitFor();

    await expect(
      page!.getByLabel("Send notifications").isChecked(),
    ).resolves.toBe(true);
    await expect(page!.getByLabel("Quiet hours").isChecked()).resolves.toBe(
      true,
    );
    await expect(
      page!.getByLabel("Start", { exact: true }).inputValue(),
    ).resolves.toBe("23:00");
  });
});

describe("local data", () => {
  it("keeps the cache controls and survives a reload", async () => {
    await page!.goto(`${BASE_URL}/settings`);
    await page!.getByRole("heading", { name: "Local data" }).waitFor();

    const enabled = page!.getByLabel("Cache transcripts on the hub");
    if (!(await enabled.isChecked())) await enabled.check();
    await page!.getByLabel("Maximum sessions").fill("40");
    await page!.getByRole("button", { name: "Save cache settings" }).click();
    await page!
      .getByText("Transcript cache saved.")
      .waitFor({ state: "visible" });

    await page!.reload();
    await page!.getByRole("heading", { name: "Local data" }).waitFor();
    await page!
      .locator(".settings-local .mode-badge", { hasText: "hub disk" })
      .waitFor();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if ((await page!.getByLabel("Maximum sessions").inputValue()) === "40") break;
      await page!.waitForTimeout(100);
    }

    await expect(
      page!.getByLabel("Cache transcripts on the hub").isChecked(),
    ).resolves.toBe(true);
    await expect(
      page!.getByLabel("Maximum sessions").inputValue(),
    ).resolves.toBe("40");
  });

  it("requires a second click to clear everything", async () => {
    await page!.goto(`${BASE_URL}/settings`);
    await page!.getByRole("heading", { name: "Local data" }).waitFor();

    await page!
      .getByRole("button", { name: "Clear all local data" })
      .click();
    const confirm = page!.getByRole("button", {
      name: "Confirm clear all local data",
    });
    await confirm.waitFor();
    await page!.getByRole("button", { name: "Cancel", exact: true }).click();
    await page!
      .getByRole("button", { name: "Clear all local data" })
      .waitFor();
  });
});

describe("session export", () => {
  it("downloads a markdown transcript from the details panel", async () => {
    await openSession("Fix auth race in gateway");
    await page!.getByRole("button", { name: "Details", exact: true }).click();
    await page!.locator(".chat-details").waitFor();

    const [download] = await Promise.all([
      page!.waitForEvent("download"),
      page!.getByRole("button", { name: "Export Markdown" }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^desktop-opencode-fix-auth-race-in-gateway-\d{4}-\d{2}-\d{2}\.md$/,
    );
    const path = await download.path();
    expect(path).toBeTruthy();
    const body = await readFile(path!, "utf8");
    expect(body).toContain("# Fix auth race in gateway");
  });
});

describe("overview usage", () => {
  it("reports usage and regroups it", async () => {
    await page!.goto(`${BASE_URL}/`);
    await page!.getByRole("heading", { name: "Usage" }).waitFor({ timeout: 10_000 });

    await page!.locator(".usage-table tbody tr").first().waitFor();
    const providerHeader = await page!
      .locator(".usage-table thead th")
      .first()
      .innerText();
    expect(providerHeader.toLowerCase()).toBe("provider");
    expect(await page!.locator(".usage-table tbody tr").count()).toBeGreaterThan(1);
    expect(await page!.locator(".usage-table").innerText()).toContain("OpenCode");

    await page!
      .getByRole("group", { name: "Group usage by" })
      .getByRole("button", { name: "Project" })
      .click();

    expect(
      (await page!.locator(".usage-table thead th").first().innerText()).toLowerCase(),
    ).toBe("project");
  });
});

describe("session lineage", () => {
  it("shows a fork under its parent and opens the parent", async () => {
    await openSession("Fix auth race in gateway");
    await page!.getByRole("button", { name: "Details", exact: true }).click();
    await page!.locator(".chat-details").waitFor();
    await page!.getByRole("button", { name: "Fork session" }).click();

    // Forking opens the new session and closes the sheet. The toggle state can
    // settle either way, so drive it from the panel and retry once.
    await page!.locator(".chat-composer textarea").waitFor({ timeout: 10_000 });
    await page!.waitForTimeout(500);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await page!.locator(".chat-details").isVisible().catch(() => false)) break;
      await page!
        .getByRole("button", { name: "Details", exact: true })
        .click();
      await page!.waitForTimeout(300);
    }
    await page!.locator(".chat-details").waitFor({ timeout: 5_000 });

    // Wait for the panel to switch to the fork before reading the tree, or the
    // stale render for the parent is what gets clicked.
    await page!
      .locator(
        '.lineage-node[aria-current="true"][title^="desktop-opencode:ses_fake_fork_"]',
      )
      .waitFor({ timeout: 10_000 });

    const nodes = page!.locator(".lineage-node");
    expect(await nodes.count()).toBeGreaterThanOrEqual(2);
    expect(await page!.locator('.lineage-node[aria-current="true"]').count()).toBe(1);

    await page!
      .locator('.lineage-node[title="desktop-opencode:ses_auth"]')
      .click();
    await page!.waitForURL(/ses_auth(\?|$)/, { timeout: 10_000 });
    await page!.waitForFunction(
      () =>
        document.querySelector(".topbar-title")?.textContent ===
        "Fix auth race in gateway",
      undefined,
      { timeout: 10_000 },
    );
  });
});

describe("message search", () => {
  it("explains when the transcript cache is off", async () => {
    // An earlier settings test leaves the cache on, so turn it off explicitly.
    await fetch(`${BASE_URL}/api/v1/settings/transcripts`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });

    await page!.goto(`${BASE_URL}/search?q=refresh&scope=messages`);
    await page!
      .getByText("Message search needs the transcript cache.")
      .waitFor({ timeout: 10_000 });
  });

  it("searches cached transcripts and highlights the match", async () => {
    await fetch(`${BASE_URL}/api/v1/settings/transcripts`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });

    // Reading a session is what writes the transcript the index covers.
    await openSession("Fix auth race in gateway");
    await page!.waitForTimeout(1_500);

    await page!.goto(`${BASE_URL}/search?q=refresh&scope=messages`);
    await page!.locator(".search-hit").first().waitFor({ timeout: 10_000 });

    const hits = await page!.locator(".search-hit").count();
    expect(hits).toBeGreaterThan(0);
    expect(await page!.locator(".search-hit-snippet mark").count()).toBeGreaterThan(0);
    expect(
      (await page!.locator(".search-hit-snippet").first().innerText()).toLowerCase(),
    ).toContain("refresh");

    // Opening a hit lands in the session that owns the message.
    await page!.locator(".search-hit").first().click();
    await page!.locator(".chat-composer textarea").waitFor({ timeout: 5_000 });
  });

  it("keeps the scope in the URL and the back stack", async () => {
    await page!.goto(`${BASE_URL}/search?q=token`);
    await page!.getByRole("button", { name: "Messages" }).click();
    await page!.waitForURL(/scope=messages/);

    await page!.goBack();
    await page!.waitForURL(/\/search\?q=token$/);
    await expect(
      page!
        .getByRole("group", { name: "Search scope" })
        .getByRole("button", { name: "Sessions" })
        .getAttribute("aria-pressed"),
    ).resolves.toBe("true");
  });
});

describe("offline queue", () => {
  it("queues a send offline, survives a reload, and lands once", async () => {
    await openSession("Fix auth race in gateway");
    await page!.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );

    let posts = 0;
    await page!.route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() === "POST") posts += 1;
      await route.continue();
    });

    await page!.context().setOffline(true);
    const text = `Offline ${Date.now()}`;
    await sendPrompt(text);

    await page!
      .locator(".message-send-state.queued")
      .waitFor({ state: "visible", timeout: 5_000 });
    expect(posts).toBe(0);

    await page!.reload();
    await page!
      .locator(".chat-message.user", { hasText: text })
      .waitFor({ state: "visible", timeout: 10_000 });
    await page!
      .locator(".message-send-state.queued")
      .waitFor({ state: "visible", timeout: 5_000 });

    await page!.context().setOffline(false);
    await page!
      .locator(".message-send-state.queued")
      .waitFor({ state: "hidden", timeout: 10_000 });

    expect(posts).toBe(1);
    expect(
      await page!.locator(".chat-message.user", { hasText: text }).count(),
    ).toBe(1);
  }, 60_000);
});

describe("service worker push", () => {
  it("turns a push payload into a notification with the deep link", async () => {
    await page!.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    const context = page!.context();
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");

    expect(
      await worker.evaluate(
        () =>
          typeof (self as unknown as { PushEvent?: unknown }).PushEvent ===
          "function",
      ),
    ).toBe(true);

    await worker.evaluate(() => {
      const scope = self as unknown as { __oktosoShown: unknown[] };
      scope.__oktosoShown = [];
      ServiceWorkerRegistration.prototype.showNotification = async function (
        title: string,
        options?: NotificationOptions,
      ) {
        scope.__oktosoShown.push({ title, options });
      } as typeof ServiceWorkerRegistration.prototype.showNotification;
    });

    await worker.evaluate((data) => {
      const scope = self as unknown as {
        PushEvent: new (type: string, init: { data: string }) => Event;
      };
      self.dispatchEvent(
        new scope.PushEvent("push", { data: JSON.stringify(data) }),
      );
    }, {
      title: "Build finished",
      body: "Open the session",
      url: "/sessions/desktop-opencode%3Ases_auth?attention=per_1",
      tag: "ses_auth:permission",
      priority: "blocking",
    });

    const shown = await worker.evaluate(
      () => (self as unknown as { __oktosoShown: unknown[] }).__oktosoShown,
    );

    expect(shown).toEqual([
      {
        title: "Build finished",
        options: expect.objectContaining({
          body: "Open the session",
          tag: "ses_auth:permission",
          data: {
            url: "/sessions/desktop-opencode%3Ases_auth?attention=per_1",
          },
          requireInteraction: true,
        }),
      },
    ]);
  }, 30_000);
});

describe("automation settings", () => {
  it("pauses and resumes from the settings panel", async () => {
    await page!.goto(`${BASE_URL}/settings`);
    await page!
      .getByRole("heading", { name: "Automation" })
      .waitFor({ timeout: 5_000 });

    await page!
      .getByRole("heading", { name: "Allowed shapes" })
      .waitFor({ timeout: 5_000 });

    await page!.getByRole("button", { name: "Pause all" }).click();
    await page!
      .getByRole("button", { name: "Resume" })
      .waitFor({ state: "visible", timeout: 5_000 });

    await page!.getByRole("button", { name: "Resume" }).click();
    await page!
      .getByRole("button", { name: "Pause all" })
      .waitFor({ state: "visible", timeout: 5_000 });
  });
});

describe("transcript loading", () => {
  async function backToSessions(): Promise<void> {
    await page!.getByRole("button", { name: "Sessions" }).first().click();
    await page!.locator(".session-list").waitFor({ timeout: 10_000 });
  }

  async function newSession(title: string, prompt: string): Promise<void> {
    await page!.getByRole("button", { name: "Sessions" }).first().click();
    await page!.locator(".session-list").waitFor({ timeout: 10_000 });
    await page!.getByRole("button", { name: "New session" }).click();
    await page!.getByRole("heading", { name: "New session" }).waitFor();
    await page!.getByLabel("Title").fill(title);
    if (prompt) await page!.getByLabel("First prompt").fill(prompt);
    await page!.getByRole("button", { name: "Create session" }).click();
  }

  it("shows a skeleton instead of the empty state while the transcript loads", async () => {
    await openSession("Fix auth race in gateway");
    await page!.locator(".chat-message").first().waitFor();
    await backToSessions();

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const route = /\/api\/v1\/sessions\/.+\/messages\?/;
    await page!.route(route, async (handler) => {
      await gate;
      await handler.continue();
    });

    await openSession("Fix auth race in gateway");
    await page!.locator(".transcript-skeleton").first().waitFor({ timeout: 3_000 });
    expect(
      await page!.getByText("No messages yet. Send the first prompt below.").count(),
    ).toBe(0);
    expect(await page!.locator(".chat-panel").getAttribute("aria-busy")).toBe("true");
    expect(
      await page!.locator('.chat-panel [role="status"]').first().innerText(),
    ).toContain("Loading transcript");

    release();
    await page!.locator(".chat-message").first().waitFor({ timeout: 10_000 });
    expect(await page!.locator(".transcript-skeleton").count()).toBe(0);
    await expect(page!.locator(".chat-panel").getAttribute("aria-busy")).resolves.not.toBe(
      "true",
    );
    await page!.unroute(route);
  });

  it("waits for a running session instead of claiming it is empty", async () => {
    await openSession("Fix auth race in gateway");
    await page!.locator(".chat-message").first().waitFor();
    await backToSessions();

    // Force the header to running; the fake's own busy window is too short to
    // rely on when the runner is slow.
    const sessionRoute = /\/api\/v1\/sessions\/[^/]+$/;
    await page!.route(sessionRoute, async (handler) => {
      const response = await handler.fetch();
      const body = (await response.json()) as Record<string, unknown>;
      body.status = "running";
      await handler.fulfill({ response, json: body });
    });

    // Empty for the first read and the one automatic re-read, then the real
    // page, so the waiting state is stable until the user asks to retry.
    let calls = 0;
    const route = /\/api\/v1\/sessions\/.+\/messages\?/;
    await page!.route(route, async (handler) => {
      calls += 1;
      if (calls <= 2) {
        await handler.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], cursor: { next: null, previous: null } }),
        });
        return;
      }
      await handler.continue();
    });

    await openSession("Fix auth race in gateway");
    await page!.getByText(/The agent is running, but no messages/).waitFor({
      timeout: 10_000,
    });
    expect(
      await page!.getByText("No messages yet. Send the first prompt below.").count(),
    ).toBe(0);

    // Let the one-shot automatic re-read happen, then retry for real.
    await page!.waitForTimeout(1_500);
    await page!.getByRole("button", { name: "Retry", exact: true }).click();
    await page!.locator(".chat-message").first().waitFor({ timeout: 10_000 });
    await page!.unroute(route);
    await page!.unroute(sessionRoute);
  });

  it("shows an error and Retry, never the empty state, when the load fails", async () => {
    await openSession("Fix auth race in gateway");
    await page!.locator(".chat-message").first().waitFor();
    await backToSessions();

    let first = true;
    const route = /\/api\/v1\/sessions\/.+\/messages\?/;
    await page!.route(route, async (handler) => {
      if (first) {
        first = false;
        await handler.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "internal", message: "boom" } }),
        });
        return;
      }
      await handler.continue();
    });

    await openSession("Fix auth race in gateway");
    await page!.getByRole("alert").first().waitFor({ timeout: 5_000 });
    expect(
      await page!.getByText("No messages yet. Send the first prompt below.").count(),
    ).toBe(0);

    await page!.getByRole("button", { name: "Retry", exact: true }).click();
    await page!.locator(".chat-message").first().waitFor({ timeout: 10_000 });
    await page!.unroute(route);
  });

  it("keeps the empty state for a session with no prompt", async () => {
    await newSession("Empty transcript check", "");
    await page!.locator(".chat-composer textarea").waitFor({ timeout: 10_000 });
    await page!
      .getByText("No messages yet. Send the first prompt below.")
      .waitFor({ timeout: 10_000 });
    expect(await page!.locator(".transcript-skeleton").count()).toBe(0);
  });

  it("keeps the new-session panel open when the first prompt fails", async () => {
    // Stub in the page rather than through request routing: this path must not
    // depend on service-worker or proxy behaviour in the runner.
    await page!.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const method = (
          init?.method ??
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        if (method === "POST" && url.includes("/messages")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: { code: "internal", message: "send failed" },
              }),
              { status: 500, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return original(input as RequestInfo, init);
      };
    });
    await page!.goto(BASE_URL);
    await page!.getByRole("button", { name: "Sessions" }).waitFor({ timeout: 10_000 });

    await newSession("Prompt failure check", "This prompt will fail");
    await page!
      .getByText(/Session created, but the first prompt failed/)
      .waitFor({ timeout: 10_000 });
    expect(await page!.getByRole("button", { name: "Create session" }).count()).toBe(0);
    expect(await page!.getByRole("button", { name: "Retry prompt" }).count()).toBe(1);
    expect(page!.url()).toContain("/sessions?new=1");

    await page!.getByRole("button", { name: "Open session" }).click();
    await page!.locator(".chat-composer textarea").waitFor({ timeout: 10_000 });
    await page!
      .getByText("No messages yet. Send the first prompt below.")
      .waitFor({ timeout: 10_000 });
  });
});
