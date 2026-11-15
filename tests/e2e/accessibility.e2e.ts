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

const HUB_PORT = 8801;
const TOKEN = "e2e-a11y-token-long-enough";
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
  throw new Error("The accessibility E2E hub did not become healthy");
}

function requirePage(): Page {
  if (!page) throw new Error("The accessibility E2E page is not ready");
  return page;
}

async function openSession(title: string): Promise<void> {
  const current = requirePage();
  await current.getByRole("button", { name: "Sessions" }).click();
  await current
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click({ timeout: 5_000 });
  await current.locator(".chat-composer textarea").waitFor({ timeout: 5_000 });
}

/** Visible buttons and links that carry no text need an explicit name. */
async function unnamedControls(): Promise<string[]> {
  const current = requirePage();
  return current.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    return Array.from(document.querySelectorAll("button, a[href]"))
      .filter(visible)
      .filter((element) => (element.textContent ?? "").trim() === "")
      .filter(
        (element) =>
          !element.getAttribute("aria-label") &&
          !element.getAttribute("aria-labelledby") &&
          !element.getAttribute("title"),
      )
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}`);
  });
}

beforeAll(async () => {
  providers = await Promise.all([
    createFakeProviderServer({ kind: "opencode", port: 0 }),
    createFakeProviderServer({ kind: "openwebui", port: 0 }),
  ]);
  root = await mkdtemp(join(tmpdir(), "oktoso-a11y-e2e-"));
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
  if (!browser) throw new Error("The accessibility E2E browser is not ready");
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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

describe("landmarks and headings", () => {
  it("renders exactly one h1 on every main view", async () => {
    const current = requirePage();
    const views = [
      ["/foundation", "Runtime"],
      ["/inbox", "Inbox"],
      ["/sessions", "Sessions"],
      ["/search", "Search"],
      ["/providers", "Providers"],
      ["/settings", "Settings"],
    ] as const;

    for (const [path, title] of views) {
      await current.goto(`${BASE_URL}${path}`);
      await current.locator(".topbar-title").waitFor({ timeout: 5_000 });
      await expect(
        current.locator("h1").count(),
        `${path} has one h1`,
      ).resolves.toBe(1);
      await expect(current.locator(".topbar-title").textContent()).resolves.toBe(
        title,
      );
    }

    await current.route("**/api/v1/sessions/*/messages*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      body.data.push({
        id: "msg_a11y_heading",
        sessionRef: "desktop-opencode:ses_auth",
        role: "assistant",
        parts: [{ type: "text", text: "# Transcript heading\n\nBody copy." }],
        createdAt: Date.now(),
      });
      await route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    await openSession("Fix auth race in gateway");
    await expect(current.locator("h1").count()).resolves.toBe(1);
    // Markdown headings in the transcript shift below the page title.
    await expect(
      current.locator(".chat-message-parts h1").count(),
    ).resolves.toBe(0);
    await expect(
      current.locator(".chat-message-parts h2").last().textContent(),
    ).resolves.toContain("Transcript heading");
  });

  it("marks the current destination and the active session row", async () => {
    const current = requirePage();
    await openSession("Fix auth race in gateway");

    await expect(
      current.locator('.rail-item[aria-current="page"]').count(),
    ).resolves.toBe(1);
    await expect(
      current.locator('.rail-item[aria-current="page"]').textContent(),
    ).resolves.toContain("Sessions");

    await current.locator('.chat-sidebar .session-list-item').first().waitFor();
    await expect(
      current.locator('.chat-sidebar .session-list-item[aria-current="page"]').count(),
    ).resolves.toBe(1);
  });
});

describe("inbox filters", () => {
  it("exposes one pressed filter and keeps the count in the name", async () => {
    const current = requirePage();
    await current.goto(`${BASE_URL}/inbox`);
    await current.locator(".inbox-tabs .chip").first().waitFor();

    await expect(
      current.locator('.inbox-tabs .chip[aria-pressed="true"]').count(),
    ).resolves.toBe(1);
    await expect(
      current.locator(".inbox-tabs .chip").first().getAttribute("aria-label"),
    ).resolves.toMatch(/^All, \d+ items?$/);

    await current
      .getByRole("button", { name: /^Questions, \d+ items?$/ })
      .click();
    await current.waitForFunction(() => window.location.search.includes("filter=question"));

    await expect(
      current.locator('.inbox-tabs .chip[aria-pressed="true"]').count(),
    ).resolves.toBe(1);
    await expect(
      current
        .getByRole("button", { name: /^Questions, \d+ items?$/ })
        .getAttribute("aria-pressed"),
    ).resolves.toBe("true");
    await expect(
      current
        .getByRole("button", { name: /^All, \d+ items?$/ })
        .getAttribute("aria-pressed"),
    ).resolves.toBe("false");
  });
});

describe("modal focus handling", () => {
  it("traps Tab in the details sheet and restores focus to its opener", async () => {
    const current = requirePage();
    await current.setViewportSize({ width: 390, height: 844 });
    await openSession("Fix auth race in gateway");

    const toggle = current.getByRole("button", { name: "Details", exact: true });
    await toggle.focus();
    await toggle.click();

    const sheet = current.getByRole("dialog", { name: "Session details" });
    await sheet.waitFor({ timeout: 3_000 });
    await expect(sheet.getAttribute("aria-modal")).resolves.toBe("true");
    await expect(
      current.evaluate(() =>
        Boolean(
          document
            .querySelector("#session-details")
            ?.contains(document.activeElement),
        ),
      ),
    ).resolves.toBe(true);

    // Backwards from the first control stays inside the sheet.
    await current.keyboard.press("Shift+Tab");
    await expect(
      current.evaluate(() =>
        Boolean(
          document
            .querySelector("#session-details")
            ?.contains(document.activeElement),
        ),
      ),
    ).resolves.toBe(true);

    await current.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 3_000 });
    await expect(
      current.evaluate(() =>
        Boolean(document.activeElement?.classList.contains("topbar-details")),
      ),
    ).resolves.toBe(true);
  });

  it("traps Tab in the model and agent sheet and restores focus to the chip", async () => {
    const current = requirePage();
    await current.setViewportSize({ width: 390, height: 844 });
    await openSession("Fix auth race in gateway");

    const chip = current.getByRole("button", { name: /Model and agent/ });
    await chip.waitFor({ timeout: 5_000 });
    await chip.focus();
    await chip.click();

    const sheet = current.getByRole("dialog", { name: "Model & agent" });
    await sheet.waitFor({ timeout: 3_000 });
    await current.keyboard.press("Shift+Tab");
    await expect(
      current.evaluate(() =>
        Boolean(
          document
            .querySelector("#composer-context-sheet")
            ?.contains(document.activeElement),
        ),
      ),
    ).resolves.toBe(true);

    await current.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 3_000 });
    await expect(
      current.evaluate(() =>
        Boolean(document.activeElement?.classList.contains("composer-context-chip")),
      ),
    ).resolves.toBe(true);
  });
});

describe("accessible names", () => {
  it("names every icon-only control on the list and chat surfaces", async () => {
    const current = requirePage();

    for (const path of ["/inbox", "/sessions", "/providers", "/settings"]) {
      await current.goto(`${BASE_URL}${path}`);
      await current.locator(".topbar-title").waitFor({ timeout: 5_000 });
      await expect(unnamedControls(), `${path} icon-only controls`).resolves.toEqual([]);
    }

    const theme = current.getByRole("button", {
      name: /Switch to (light|dark) theme/,
    });
    await expect(theme.count()).resolves.toBe(1);

    await openSession("Fix auth race in gateway");
    await expect(unnamedControls(), "chat icon-only controls").resolves.toEqual([]);
    await expect(
      current.getByRole("button", { name: "Back", exact: true }).count(),
    ).resolves.toBe(1);

    await current.setViewportSize({ width: 390, height: 844 });
    await current.getByRole("button", { name: "Details", exact: true }).click();
    await current.getByRole("dialog", { name: "Session details" }).waitFor();
    await expect(unnamedControls(), "details icon-only controls").resolves.toEqual([]);
    await expect(
      current.getByRole("button", { name: "Close details" }).count(),
    ).resolves.toBe(1);
  });

  it("keeps the hidden jump pill out of the tab order", async () => {
    const current = requirePage();
    await openSession("Refactor session index");

    const panel = current.locator(".chat-panel");
    await panel.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    });
    await current.waitForTimeout(400);

    const jump = current.locator(".chat-jump-float");
    await expect(jump.getAttribute("aria-hidden")).resolves.toBeNull();
    // The visible text stays the accessible name.
    await expect(jump.evaluate((element) => element.textContent?.trim())).resolves.toMatch(
      /Jump to latest|Input needed/,
    );

    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await current.waitForTimeout(400);
    await expect(jump.getAttribute("aria-hidden")).resolves.toBe("true");
    await expect(jump.getAttribute("tabindex")).resolves.toBe("-1");
  });
});
