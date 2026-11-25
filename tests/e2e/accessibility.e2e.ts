import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import {
  createFakeProviderServer,
  type FakeProviderServer,
} from "@amoshydra/oktoso-testing";

const TOKEN = "e2e-a11y-token-long-enough";
/** Picked at startup so a dev hub on a fixed port cannot shadow the suite. */
let HUB_PORT = 0;
let BASE_URL = "";

let providers: FakeProviderServer[] = [];
let root: string | undefined;
let hub: ChildProcess | undefined;
let browser: Browser | undefined;
let page: Page | undefined;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a hub port")));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

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
  HUB_PORT = await freePort();
  BASE_URL = `http://127.0.0.1:${HUB_PORT}`;
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

describe("access credential", () => {
  async function accessPanel() {
    const current = requirePage();
    await current.goto(`${BASE_URL}/settings`);
    const panel = current.locator(".panel").filter({
      has: current.getByRole("heading", { name: "Access" }),
    });
    await panel.waitFor({ timeout: 5_000 });
    return panel;
  }

  it("shows the owner credential and its permanence", async () => {
    const panel = await accessPanel();
    await panel.getByText("Owner", { exact: true }).waitFor();
    await panel.getByText("Never", { exact: true }).waitFor();
    await panel
      .getByText(/Pairing links, metrics, and MCP tokens require it/)
      .waitFor();
  });

  it("shows a paired session and its expiry", async () => {
    const current = requirePage();
    const pair = await current.request.post(`${BASE_URL}/api/v1/auth/pair`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(pair.ok()).toBe(true);
    const { code } = (await pair.json()) as { code: string };
    const connect = await current.request.post(
      `${BASE_URL}/api/v1/auth/connect`,
      { data: { code } },
    );
    expect(connect.ok()).toBe(true);
    const { token } = (await connect.json()) as { token: string };

    if (!browser) throw new Error("The accessibility E2E browser is not ready");
    const paired = await browser.newPage();
    try {
      await paired.addInitScript((next) => {
        sessionStorage.setItem("oktoso-token", next);
      }, token);
      await paired.goto(`${BASE_URL}/settings`);
      const panel = paired.locator(".panel").filter({
        has: paired.getByRole("heading", { name: "Access" }),
      });
      await panel.getByText("Phone", { exact: true }).waitFor({ timeout: 5_000 });
      await panel
        .getByText(/No pairing, metrics, or MCP-token administration/)
        .waitFor({ timeout: 5_000 });
      await expect(panel.innerText()).resolves.not.toContain("Never");
    } finally {
      await paired.close();
    }
  });

  it("keeps the Access panel inside narrow widths", async () => {
    const current = requirePage();
    for (const width of [390, 320]) {
      await current.setViewportSize({ width, height: 844 });
      await current.goto(`${BASE_URL}/settings`);
      const panel = current.locator(".panel").filter({
        has: current.getByRole("heading", { name: "Access" }),
      });
      await panel.waitFor({ timeout: 5_000 });
      const overflow = await current.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  });
});

describe("landmarks and headings", () => {
  it("renders exactly one h1 on every main view", async () => {
    const current = requirePage();
    const views = [
      ["/foundation", "Overview"],
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
    await current.locator(".chat-message").first().waitFor({ timeout: 5_000 });
    await current.waitForFunction(
      () => {
        const element = document.querySelector(".chat-panel");
        return Boolean(element && element.scrollHeight > element.clientHeight + 8);
      },
      undefined,
      { timeout: 5_000 },
    );
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await panel.evaluate((element) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const jump = current.locator(".chat-jump-float");
    await expect
      .poll(() => jump.getAttribute("data-visible"), { timeout: 5_000 })
      .toBe("true");
    await expect(jump.getAttribute("aria-hidden")).resolves.toBeNull();
    // The visible text stays the accessible name.
    await expect(jump.evaluate((element) => element.textContent?.trim())).resolves.toMatch(
      /Jump to latest|Input needed/,
    );

    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect
      .poll(() => jump.getAttribute("data-visible"), { timeout: 5_000 })
      .toBe("false");
    await expect(jump.getAttribute("aria-hidden")).resolves.toBe("true");
    await expect(jump.getAttribute("tabindex")).resolves.toBe("-1");
  });
});

describe("question fields", () => {
  it("removes the native fieldset frame from choice fields", async () => {
    const current = requirePage();
    await current.goto(`${BASE_URL}/inbox`);
    const fieldset = current.locator("fieldset.attention-choice-field").first();
    await fieldset.waitFor({ timeout: 5_000 });
    const style = await fieldset.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        borderWidth: computed.borderTopWidth,
        borderStyle: computed.borderTopStyle,
        padding: computed.paddingTop,
        margin: computed.marginTop,
      };
    });
    expect(style).toEqual({
      borderWidth: "0px",
      borderStyle: "none",
      padding: "0px",
      margin: "0px",
    });
  });
});

describe("login QR overlay", () => {
  it("focuses Cancel, traps Tab, closes on Escape, and returns focus to the opener", async () => {
    if (!browser) throw new Error("The accessibility E2E browser is not ready");
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const login = await context.newPage();
      // The overlay only renders when the browser exposes the Barcode Detection
      // API and camera capture in a secure context. Both are stubbed; the
      // scanner loop and its abort path stay the real implementation.
      await login.addInitScript(() => {
        const stub = window as unknown as {
          BarcodeDetector: unknown;
          __qrTrackStopped: boolean;
        };
        stub.__qrTrackStopped = false;
        const stream = new MediaStream();
        const track = {
          stop() {
            stub.__qrTrackStopped = true;
          },
        };
        stream.getTracks = () => [track as unknown as MediaStreamTrack];
        stub.BarcodeDetector = class {
          async detect(): Promise<Array<{ rawValue: string }>> {
            return [];
          }
        };
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: { getUserMedia: async () => stream },
        });
        HTMLMediaElement.prototype.play = () => Promise.resolve();
      });
      await login.goto(BASE_URL);

      const opener = login.getByRole("button", { name: "Scan pairing QR" });
      await opener.waitFor({ timeout: 10_000 });
      await opener.click();

      const overlay = login.getByRole("dialog", { name: "Scan pairing QR code" });
      await overlay.waitFor({ timeout: 3_000 });
      await login.waitForFunction(
        () => document.activeElement?.textContent?.trim() === "Cancel",
      );

      // Tab and Shift+Tab stay inside the overlay.
      await login.keyboard.press("Tab");
      await expect(
        login.evaluate(() =>
          Boolean(
            document
              .querySelector(".qr-scan-overlay")
              ?.contains(document.activeElement),
          ),
        ),
      ).resolves.toBe(true);
      await login.keyboard.press("Shift+Tab");
      await expect(
        login.evaluate(() =>
          Boolean(
            document
              .querySelector(".qr-scan-overlay")
              ?.contains(document.activeElement),
          ),
        ),
      ).resolves.toBe(true);

      // The camera stream is live until the overlay closes.
      await expect(
        login.evaluate(
          () => (window as unknown as { __qrTrackStopped: boolean }).__qrTrackStopped,
        ),
      ).resolves.toBe(false);

      await login.keyboard.press("Escape");
      await overlay.waitFor({ state: "hidden", timeout: 3_000 });
      await login.waitForFunction(
        () => document.activeElement?.textContent?.trim() === "Scan pairing QR",
      );
      await login.waitForFunction(
        () => (window as unknown as { __qrTrackStopped: boolean }).__qrTrackStopped,
      );
    } finally {
      await context.close();
    }
  });
});

describe("inline panel focus", () => {
  it("focuses the first provider field and restores focus to Add", async () => {
    const current = requirePage();
    await current.goto(`${BASE_URL}/providers`);
    const add = current.getByRole("button", { name: "+ Add" });
    await add.waitFor({ timeout: 5_000 });
    await add.click();

    const form = current.locator(".provider-form");
    await form.waitFor({ timeout: 3_000 });
    await current.waitForFunction(
      () => document.activeElement?.getAttribute("placeholder") === "desktop-opencode",
    );

    await form.getByRole("button", { name: "Cancel" }).click();
    await form.waitFor({ state: "hidden", timeout: 3_000 });
    await current.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "+ Add",
    );
  });

  it("focuses the first new-session field and restores focus to its opener", async () => {
    const current = requirePage();
    await current.goto(`${BASE_URL}/sessions`);
    const opener = current.getByRole("button", { name: "New session" });
    await opener.waitFor({ timeout: 5_000 });
    await opener.click();

    const panel = current.locator(".new-session-panel");
    await panel.waitFor({ timeout: 3_000 });
    await current.waitForFunction(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLSelectElement &&
        document.querySelector(".new-session-panel")?.contains(active) === true
      );
    });

    await current.getByRole("button", { name: "Close new session" }).click();
    await panel.waitFor({ state: "hidden", timeout: 3_000 });
    await current.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "New session",
    );
  });
});

describe("inbox live region", () => {
  const baseline = {
    id: "att_a11y_baseline",
    sessionRef: "desktop-opencode:ses_auth",
    type: "permission",
    priority: "blocking",
    title: "Allow the agent to push the branch?",
    summary: "shell · git push origin main",
    createdAt: Date.now(),
    actions: [
      { id: "approve_once", label: "Approve" },
      { id: "deny", label: "Deny" },
    ],
  };
  const blocking = {
    ...baseline,
    id: "att_a11y_blocking",
    title: "Deploy the release?",
    summary: "shell · deploy production",
  };
  const quiet = {
    ...baseline,
    id: "att_a11y_quiet",
    type: "unread",
    priority: "normal",
    title: "A background note",
  };

  async function serveAttention(
    responses: () => Array<Record<string, unknown>>,
  ): Promise<void> {
    const current = requirePage();
    await current.route("**/api/v1/attention*", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({ json: { data: responses() } });
    });
  }

  it("stays silent for the first load and for non-blocking arrivals", async () => {
    const current = requirePage();
    let data: Array<Record<string, unknown>> = [baseline];
    await serveAttention(() => data);
    await current.goto(`${BASE_URL}/inbox`);
    await current.locator(".inbox-group").first().waitFor({ timeout: 5_000 });

    const region = current.locator(".page > span.sr-only");
    await expect(region.textContent()).resolves.toBe("");

    data = [baseline, quiet];
    const refreshed = current.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/attention") &&
        response.request().method() === "GET",
    );
    await current.getByRole("button", { name: "Refresh" }).click();
    await refreshed;
    // Wait for the new card so the silence is checked after the update landed.
    await current.getByText("A background note").waitFor({ timeout: 5_000 });
    await expect(region.textContent()).resolves.toBe("");
  });

  it("announces a blocking request that arrives after the first load", async () => {
    const current = requirePage();
    let data: Array<Record<string, unknown>> = [baseline];
    await serveAttention(() => data);
    await current.goto(`${BASE_URL}/inbox`);
    await current.locator(".inbox-group").first().waitFor({ timeout: 5_000 });

    const region = current.locator(".page > span.sr-only");
    await expect(region.textContent()).resolves.toBe("");

    data = [baseline, blocking];
    const refreshed = current.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/attention") &&
        response.request().method() === "GET",
    );
    await current.getByRole("button", { name: "Refresh" }).click();
    await refreshed;
    await current.waitForFunction(() =>
      Boolean(
        document
          .querySelector(".page > span.sr-only")
          ?.textContent?.includes("New blocking request"),
      ),
    );
    await expect(region.textContent()).resolves.toBe(
      "New blocking request: Deploy the release?",
    );
  });
});
