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

/**
 * Drives the hosted G2 app through the same channel the Even host uses:
 * `rebuildPageContainer` for pages and menus, `evenHubEvent` for input. No
 * simulator binary and no real provider — the hub runs against fake providers
 * and the transcribe/send calls are intercepted per test.
 */

const HUB_PORT = 8798;
const TOKEN = "g2-e2e-token-long-enough";
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
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The G2 E2E hub did not become healthy");
}

async function configureTranscription(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/v1/settings/assistant`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transcription: {
        enabled: true,
        baseUrl: "http://127.0.0.1:9/v1",
        model: "test",
        timeoutMs: 5_000,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Could not configure transcription: ${response.status}`);
  }
}

beforeAll(async () => {
  providers = await Promise.all([
    createFakeProviderServer({ kind: "opencode", port: 0 }),
    createFakeProviderServer({ kind: "openwebui", port: 0 }),
  ]);
  root = await mkdtemp(join(tmpdir(), "oktoso-g2-e2e-"));
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
              password: "g2-password",
            },
            enabled: true,
          },
          {
            id: "openwebui",
            type: "openwebui",
            name: "Open WebUI",
            baseUrl: providers[1]!.url,
            auth: { kind: "bearer", token: "g2-token" },
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
  await configureTranscription();
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  hub?.kill("SIGTERM");
  await Promise.all(providers.map((provider) => provider.close()));
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!browser) throw new Error("The G2 E2E browser is not ready");
  page = await browser.newPage();
  await page.addInitScript((token) => {
    localStorage.setItem("oktoso-even-g2-token", token);
  }, TOKEN);
  await page.goto(`${BASE_URL}/apps/even-g2/`, { waitUntil: "domcontentloaded" });
  await previewMatches(/Inbox/);
  await page.evaluate(() => {
    const bridge = (window as any).EvenAppBridge;
    const test = ((window as any).__g2 = {
      pages: [] as any[],
      audioOpen: false as boolean | undefined,
    });
    const rebuild = bridge.rebuildPageContainer.bind(bridge);
    bridge.rebuildPageContainer = async (next: any) => {
      try {
        test.pages.push(next.toJson());
      } catch {
        // A malformed page is itself a failure worth surfacing later.
      }
      try {
        await rebuild(next);
      } catch {
        // No native host: painting is simulated by the app's preview.
      }
      return true;
    };
    bridge.textContainerUpgrade = async () => true;
    bridge.audioControl = async (open: boolean) => {
      test.audioOpen = open;
      return true;
    };
    (window as any).__g2.send = (detail: unknown) =>
      window.dispatchEvent(new CustomEvent("evenHubEvent", { detail }));
  });
});

afterEach(async () => {
  await page?.close();
  page = undefined;
});

function requirePage(): Page {
  if (!page) throw new Error("The G2 E2E page is not ready");
  return page;
}

async function preview(): Promise<string> {
  return requirePage().evaluate(
    () => document.querySelector("#glasses-preview")?.textContent ?? "",
  );
}

async function previewMatches(pattern: RegExp): Promise<string> {
  const target = requirePage();
  await target.waitForFunction(
    (source) => {
      const text = document.querySelector("#glasses-preview")?.textContent ?? "";
      return new RegExp(source).test(text);
    },
    pattern.source,
    { timeout: 10_000 },
  );
  return preview();
}

async function send(detail: unknown): Promise<void> {
  await requirePage().evaluate(
    (payload) => (window as any).__g2.send(payload),
    detail,
  );
  // Let the app's serialized event queue drain.
  await requirePage().waitForTimeout(150);
}

async function listTap(index: number): Promise<void> {
  await send({ listEvent: { eventType: 0, currentSelectItemIndex: index } });
}

async function textTap(): Promise<void> {
  await send({ sysEvent: { eventSource: 0 } });
}

async function doubleTap(): Promise<void> {
  await send({ sysEvent: { eventType: 3, eventSource: 0 } });
}

async function menuClick(itemID: number): Promise<void> {
  await send({ menuItemClickEvent: { itemID } });
}

async function lastPage(): Promise<any> {
  return requirePage().evaluate(() => (window as any).__g2.pages.at(-1));
}

async function menuLabels(): Promise<string[]> {
  const page = await lastPage();
  return (page?.menuObject?.menuItems ?? []).map(
    (item: { itemName?: string }) => item.itemName ?? "",
  );
}

async function listLabels(): Promise<string[]> {
  const page = await lastPage();
  const items = page?.listObject?.[0]?.itemContainer;
  return Array.isArray(items?.itemName) ? items.itemName : [items?.itemName];
}

async function tapRowMatching(pattern: RegExp): Promise<void> {
  const labels = await listLabels();
  const index = labels.findIndex((label) => pattern.test(label));
  if (index < 0) {
    throw new Error(`No row matches ${pattern}: ${labels.join(" | ")}`);
  }
  await listTap(index);
}

async function openSession(title: RegExp): Promise<void> {
  await listTap(1);
  await previewMatches(/RECENT/);
  await tapRowMatching(title);
  // The title also appears on the Recent row; the chat is the screen that
  // offers the reply action.
  await previewMatches(/Tap reply|\? Answer/);
}

async function openFirstSession(): Promise<void> {
  await openSession(/Fix auth race/);
}

/** Older fixtures sit past the first Recent page. */
async function openAncientSession(title: RegExp): Promise<void> {
  await listTap(1);
  await previewMatches(/RECENT/);
  for (let page = 0; page < 4; page += 1) {
    const labels = await listLabels();
    if (labels.some((label) => title.test(label))) break;
    const more = labels.findIndex((label) => /More sessions/.test(label));
    if (more < 0) {
      throw new Error(`No row matches ${title}: ${labels.join(" | ")}`);
    }
    await listTap(more);
    await requirePage().waitForTimeout(200);
  }
  await tapRowMatching(title);
  await previewMatches(/Tap reply|\? Answer/);
}

describe("G2 hosted app", () => {
  it("boots to Home and navigates through the empty Inbox", async () => {
    const home = await preview();
    expect(home).toContain("Inbox");
    expect(home).toContain("Recent sessions");

    await listTap(0);
    const inbox = await previewMatches(/No session open|ATTENTION/);
    if (inbox.includes("No session open")) {
      // The empty Inbox is one line with no header or footer.
      expect(inbox.trim().split("\n")).toHaveLength(1);
    }

    await doubleTap();
    await previewMatches(/Recent sessions/);
  });

  it("lists provider sessions on Recent", async () => {
    await listTap(1);
    const recent = await previewMatches(/RECENT/);
    expect(recent).toContain("Fix auth race");
    await doubleTap();
  });

  it("always declares Stop in the chat menu", async () => {
    await openFirstSession();
    const labels = await menuLabels();
    expect(labels[0]).toBe("Stop agent");
    expect(labels).toContain("Scroll to the bottom");
  });

  it("stops from the menu and returns to the chat", async () => {
    await openFirstSession();
    let interrupts = 0;
    await requirePage().route("**/api/v1/sessions/*/interrupt", async (route) => {
      interrupts += 1;
      await route.fulfill({ status: 204, body: "" });
    });

    await menuClick(1);
    const confirm = await previewMatches(/STOP AGENT/);
    expect(confirm).toContain("Stop the agent's current turn?");

    await listTap(0);
    const chat = await previewMatches(/Fix auth race/);
    expect(chat).not.toContain("STOP AGENT");
    expect(interrupts).toBe(1);
  });

  it("dictates, reviews, and sends a voice reply", async () => {
    // This session has no pending question, so the chat tap opens replies.
    await openSession(/Refactor session index/);
    await previewMatches(/Tap reply/);
    await textTap();
    const reply = await previewMatches(/REPLY/);
    expect(reply).toContain("Voice reply");

    await listTap(0);
    await previewMatches(/Listening/);
    expect(await requirePage().evaluate(() => (window as any).__g2.audioOpen)).toBe(
      true,
    );

    for (let frame = 0; frame < 4; frame += 1) {
      await send({ audioEvent: { audioPcm: new Uint8Array(3200) } });
    }

    let sentText = "";
    await requirePage().route("**/api/v1/transcribe", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { text: "Ship it.", model: "test" } }),
      });
    });
    await requirePage().route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      sentText = route.request().postDataJSON()?.text ?? "";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      });
    });

    // The tap guard ignores input for a moment after the voice screen opens.
    await requirePage().waitForTimeout(1_000);
    await textTap();
    // The intercepted transcription is instant, so Transcribing is a single
    // frame; assert the outcome that matters.
    await previewMatches(/Ship it\./);
    expect((await listLabels()).slice(0, 2)).toEqual(["Send", "Edit on phone"]);

    // The result screen also guards against the stop tap acting twice.
    await requirePage().waitForTimeout(1_000);
    await listTap(0);
    await previewMatches(/Refactor session index/);
    expect(sentText).toBe("Ship it.");
    expect(
      await requirePage().evaluate(() => (window as any).__g2.audioOpen),
    ).toBe(false);
  });

  it("opens the answer screen before a stale turn failure", async () => {
    // The Rust session ends in an error and a question. The question wins the
    // tap; the failure stays reachable from the answer screen.
    await openAncientSession(/Port hub to Rust/);
    await previewMatches(/\? Answer/);
    await textTap();
    const answer = await previewMatches(/ANSWER/);
    expect(answer).not.toContain("TURN FAILED");
    expect(await listLabels()).toContain("Failure ›");

    await tapRowMatching(/Failure/);
    await previewMatches(/TURN FAILED/);

    await doubleTap();
    await previewMatches(/ANSWER/);
    expect(await listLabels()).toContain("Type answer");
  });

  it("sends a suggested answer as free text", async () => {
    const target = requirePage();
    await target.route("**/api/v1/sessions/*/question", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            sessionRef: "desktop-opencode:ses_index",
            messageId: "msg_free",
            revision: "msg_free:1",
            askedAt: 1,
            generatedAt: 1,
            questions: [
              {
                id: "msg_free:q0",
                text: "Which branch should I target?",
                kind: "freeform",
                choices: [],
                allowsFreeText: true,
                allowsVoice: false,
                multiSelect: false,
                risk: "normal",
                confidence: "high",
                source: "explicit",
              },
            ],
          },
        }),
      });
    });
    await target.route("**/reply-options**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("mode") !== "answer") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "answer-0",
              label: "Ship it.",
              text: "Ship it.",
              source: "model",
              action: "send",
            },
            {
              id: "answer-1",
              label: "Not yet.",
              text: "Not yet.",
              source: "model",
              action: "send",
            },
          ],
          generatedAt: 1,
          mode: "answer",
        }),
      });
    });
    let sentText = "";
    await target.route("**/api/v1/sessions/*/messages", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      sentText = route.request().postDataJSON()?.text ?? "";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      });
    });

    await openSession(/Refactor session index/);
    await previewMatches(/\? Answer/);
    await textTap();
    await previewMatches(/ANSWER/);
    await tapRowMatching(/Suggested answers/);

    await previewMatches(/SUGGESTED/);
    expect(await listLabels()).toEqual(["Ship it.", "Not yet."]);

    await listTap(0);
    await previewMatches(/Refactor session index/);
    expect(sentText).toBe("Ship it.");
  });

  it("turns an Other sentinel into Type your own answer", async () => {
    await requirePage().route(
      "**/api/v1/sessions/*/question",
      async (route) => {
        if (route.request().method() !== "GET") {
          await route.continue();
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              sessionRef: "desktop-opencode:ses_index",
              messageId: "msg_sentinel",
              revision: "msg_sentinel:1",
              askedAt: 1,
              generatedAt: 1,
              questions: [
                {
                  id: "msg_sentinel:q0",
                  text: "Which branch should I target?",
                  kind: "choice",
                  choices: [
                    {
                      id: "c0",
                      label: "main",
                      text: "main",
                      kind: "choice",
                      source: "explicit",
                    },
                    {
                      id: "c1",
                      label: "Other",
                      text: "Other",
                      kind: "choice",
                      source: "explicit",
                    },
                  ],
                  allowsFreeText: true,
                  allowsVoice: false,
                  multiSelect: false,
                  risk: "normal",
                  confidence: "high",
                  source: "explicit",
                },
              ],
            },
          }),
        });
      },
    );

    await openSession(/Refactor session index/);
    await previewMatches(/\? Answer/);
    await textTap();
    await previewMatches(/ANSWER/);

    const labels = await listLabels();
    expect(labels).toContain("main");
    expect(labels).toContain("Type your own answer");
    expect(labels).not.toContain("Other");

    await tapRowMatching(/Type your own answer/);
    await previewMatches(/TYPE/);
  });
});
