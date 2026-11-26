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
const MARKDOWN_ANSWER = [
  "## Diagnosis",
  "",
  "The **runner** is stuck on `pnpm test`.",
  "",
  "```sh",
  "pnpm test --filter auth",
  "```",
  "",
  "![chart](plots/chart.png)",
  "",
  "See `plots/chart.png` for the race.",
].join("\n");

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
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const wantsAction = body.includes("ACTION:");
        const wantsHandoff = body.includes("ACTION: handoff");
        const wantsMarkdown = body.includes("Show it as markdown");
        const frames = wantsHandoff
          ? [
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_handoff",
                          function: {
                            name: "propose_session_action",
                            arguments: JSON.stringify({
                              kind: "handoff",
                              targetRef: "desktop-opencode:ses_index",
                              text: "E2E handoff instruction",
                              reason: "E2E handoff",
                              summary: "Hand off the fix?",
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              })}\n\n`,
              `data: ${JSON.stringify({
                choices: [{ delta: {}, finish_reason: "tool_calls" }],
                usage: { prompt_tokens: 42, completion_tokens: 8 },
              })}\n\n`,
              "data: [DONE]\n\n",
            ]
          : wantsAction
            ? [
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_1",
                          function: {
                            name: "propose_session_action",
                            arguments: JSON.stringify({
                              kind: "send",
                              text: "E2E confirmed reply",
                              summary: "Send this reply to the session?",
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              })}\n\n`,
              `data: ${JSON.stringify({
                choices: [{ delta: {}, finish_reason: "tool_calls" }],
                usage: { prompt_tokens: 42, completion_tokens: 8 },
              })}\n\n`,
              "data: [DONE]\n\n",
            ]
          : [
              `data: ${JSON.stringify({
                choices: [
                  { delta: { content: wantsMarkdown ? MARKDOWN_ANSWER : ANSWER } },
                ],
              })}\n\n`,
              `data: ${JSON.stringify({
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: { prompt_tokens: 42, completion_tokens: 8 },
              })}\n\n`,
              "data: [DONE]\n\n",
            ];
        for (const frame of frames) response.write(frame);
        response.end();
      });
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
          allowWrite: true,
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
      "WRITES NEED YOUR CONFIRMATION",
    );
    expect(
      await page!
        .locator(".assistant-turn.assistant .assistant-turn-meta")
        .last()
        .innerText(),
    ).toContain("session as of ");
    expect(await page!.locator(".assistant-day").last().innerText()).toBe(
      "TODAY",
    );

    const activity = page!.locator(".agent-activity").last();
    await activity.waitFor({ timeout: 10_000 });
    await activity.locator(".agent-activity-toggle").click();
    expect(await activity.locator(".activity-tile").count()).toBeGreaterThan(0);
    expect(
      await page!.locator(".assistant-model-chip").innerText(),
    ).not.toBe("");

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


  it("renders an answer as Markdown and opens a mentioned file", async () => {
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    await page!.locator("#assistant-input").fill("Show it as markdown");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    await page!.locator("#assistant-input").press("Enter");

    const answer = page!
      .locator(".assistant-turn.assistant .assistant-turn-text")
      .last();
    // The dock offsets headings by one, so `##` renders as `h3`.
    await answer
      .locator("h3", { hasText: "Diagnosis" })
      .waitFor({ timeout: 15_000 });
    expect(await answer.locator("strong").first().innerText()).toBe("runner");
    expect(await answer.locator("pre code").first().innerText()).toContain(
      "pnpm test --filter auth",
    );
    await page!
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: BASE_URL,
      });
    const codeCopy = answer.locator(".code-block-copy").first();
    await codeCopy.waitFor({ timeout: 5_000 });
    expect(await codeCopy.innerText()).toBe("Copy");
    await codeCopy.click();
    await page!.waitForTimeout(100);
    expect(await codeCopy.innerText()).toBe("Copied");
    expect(
      await answer.locator("[data-code-status]").first().innerText(),
    ).toBe("Copied to clipboard");
    expect(
      await page!.evaluate(() => navigator.clipboard.readText()),
    ).toContain("pnpm test --filter auth");

    const inlineImage = answer.locator("img").first();
    await inlineImage.waitFor({ timeout: 5_000 });
    await page!.waitForFunction(
      () => {
        const image = document.querySelector(
          ".assistant-turn.assistant .assistant-turn-text img",
        );
        return image instanceof HTMLImageElement && image.src.startsWith("blob:");
      },
      { timeout: 5_000 },
    );
    expect(await inlineImage.getAttribute("src")).toMatch(/^blob:/);

    const mention = answer.locator(
      '.file-mention[data-file-path="plots/chart.png"]',
    );
    await mention.click();
    const sheet = page!.locator(".file-preview");
    await sheet.waitFor({ timeout: 5_000 });
    expect(await sheet.locator(".file-preview-title").innerText()).toBe(
      "chart.png",
    );

    // Escape closes the sheet, not the dock behind it.
    await page!.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached" });
    await page!.locator("#session-assistant").waitFor({ state: "visible" });
  });

  it("dates the provider compaction behind the answer", async () => {
    await page!
      .getByRole("button", { name: "Sessions", exact: true })
      .click();
    await page!
      .getByRole("button", { name: /Refactor session index/ })
      .first()
      .click({ timeout: 5_000 });
    await page!.locator(".chat-composer textarea").waitFor({ timeout: 5_000 });
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    await page!.locator("#assistant-input").fill("what is the goal?");
    await page!.locator("#assistant-input").press("Enter");

    await page!
      .locator(".assistant-turn.assistant .assistant-turn-text", { hasText: ANSWER })
      .waitFor({ timeout: 15_000 });
    const meta = await page!
      .locator(".assistant-turn.assistant .assistant-turn-meta")
      .last()
      .innerText();
    // The session has a provider compaction, so the line names its date after
    // the session stamp. It is not from today, so it is a date, not a time.
    expect(meta).toContain("session as of ");
    expect(meta).toContain("history ");
    expect(meta.indexOf("history ")).toBeGreaterThan(meta.indexOf("session as of "));
    expect(meta).not.toMatch(/history \d{1,2}:\d{2}/);
  });

  it("opens the global thread from the Overview", async () => {
    await page!.goto(BASE_URL);
    await page!.getByRole("button", { name: "Ask", exact: true }).click();
    await page!.locator("#assistant-input").waitFor({ timeout: 10_000 });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    expect(await page!.locator(".assistant-head p").innerText()).toBe(
      "All sessions",
    );
    expect(
      await page!.locator("span.assistant-scope").innerText(),
    ).toBe("ALL SESSIONS");
    expect(
      await page!.getByRole("dialog", { name: "Assistant" }).count(),
    ).toBe(1);
    expect(
      await page!.locator(".assistant-model-chip").innerText(),
    ).not.toBe("Default model");
    await page!.locator("#assistant-input").fill("what needs me?");
    await page!.locator("#assistant-input").press("Enter");
    await page!
      .locator(".assistant-turn.assistant .assistant-turn-text", {
        hasText: ANSWER,
      })
      .waitFor({ timeout: 15_000 });
    expect(
      await page!.locator(".assistant-turn.assistant .assistant-turn-meta").last().innerText(),
    ).toContain("session as of");
  });

  it("proposes a reply, sends it only after confirmation, and records it", async () => {
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    await page!.locator("#assistant-input").fill("ACTION: send a reply");
    await page!.locator("#assistant-input").press("Enter");

    const card = page!.locator(".assistant-action");
    await card.waitFor({ timeout: 15_000 });
    expect(await card.locator(".assistant-action-label").innerText()).toBe(
      "NEEDS YOUR CONFIRMATION",
    );
    expect(await card.locator(".assistant-action-text").inputValue()).toBe(
      "E2E confirmed reply",
    );

    await card.locator(".assistant-action-buttons .btn.primary").click();
    await card.locator(".assistant-action-state").waitFor({ timeout: 10_000 });
    expect(await card.locator(".assistant-action-state").innerText()).toBe("SENT");

    // The provider transcript now has the message, not just the dock.
    await page!.reload();
    await page!.getByRole("button", { name: "Ask", exact: true }).waitFor();
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    await page!.locator(".assistant-action.done").waitFor({ timeout: 10_000 });
    expect(await page!.locator(".assistant-action-state").innerText()).toBe("SENT");
  });

  it("drafts a handoff, sends it, and records the receipt", async () => {
    await page!
      .getByRole("button", { name: "Ask", exact: true })
      .click();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await page!.locator("#assistant-input").isEnabled()) break;
      await page!.waitForTimeout(100);
    }
    await page!.locator("#assistant-input").fill("ACTION: handoff");
    await page!.locator("#assistant-input").press("Enter");

    const card = page!
      .locator(".assistant-action", { hasText: "Refactor session index" })
      .last();
    await card.waitFor({ timeout: 15_000 });
    expect(await card.locator(".assistant-action-label").innerText()).toBe(
      "NEEDS YOUR CONFIRMATION",
    );
    await expect(
      card.locator(".assistant-action-target", { hasText: "From:" }).innerText(),
    ).resolves.toContain("Fix auth race in gateway");
    await expect(
      card.locator(".assistant-action-target", { hasText: "To:" }).innerText(),
    ).resolves.toContain("Refactor session index");
    expect(await card.locator(".assistant-action-text").inputValue()).toBe(
      "E2E handoff instruction",
    );
    expect(await card.locator(".assistant-action-reason").inputValue()).toBe(
      "E2E handoff",
    );
    await card
      .locator(".assistant-action-text")
      .fill("E2E edited handoff instruction");
    await card
      .locator(".assistant-action-reason")
      .fill("E2E edited reason");

    await card.getByRole("button", { name: "Send handoff" }).click();
    await card.locator(".assistant-action-state").waitFor({ timeout: 10_000 });
    await expect
      .poll(() => card.locator(".assistant-action-state").innerText(), {
        timeout: 10_000,
      })
      .toBe("SENT");
    await expect(
      card.locator(".assistant-action-receipt").innerText(),
    ).resolves.toContain("Session receipt queued for its next turn.");

    await expect
      .poll(
        async () => {
          const response = await page!.request.get(
            `${provider!.url}/api/session/ses_auth/inbox`,
          );
          if (!response.ok()) return false;
          const body = (await response.json()) as {
            data?: Array<{
              type?: string;
              payload?: { description?: string };
            }>;
          };
          return (body.data ?? []).some(
            (item) =>
              item.type === "synthetic" &&
              item.payload?.description?.startsWith("Handoff sent to"),
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    await page!.keyboard.press("Escape");
    const sentCard = page!.locator(
      '.chat-panel .handoff-card[data-status="sent"]',
    );
    await sentCard.waitFor({ timeout: 10_000 });
    await expect(sentCard.innerText()).resolves.toContain(
      "Refactor session index",
    );
    await expect(sentCard.innerText()).resolves.toContain(
      "E2E edited handoff instruction",
    );
    await expect(sentCard.innerText()).resolves.toContain(
      "Why: E2E edited reason",
    );
  });
});
