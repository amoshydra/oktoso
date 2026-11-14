/**
 * Generate suggestions for a set of fixture moments with the configured reply
 * model, then write a report a reviewer (human or subagent) can judge.
 *
 *   pnpm exec tsx scripts/reply-prompt-check.ts
 *
 * Reads the real reply settings from ~/.local/state/oktoso/state.json unless
 * REPLY_BASE_URL / REPLY_MODEL override them. Output goes to
 * /tmp/opencode/reply-check/report.{md,json}; nothing is committed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  AssistantConfig,
  Message,
  MessagePart,
  Session,
} from "@amoshydra/oktoso-contracts";
import type { Logger } from "../packages/hub/src/lib/logger";
import type { AssistantSettingsService } from "../packages/hub/src/services/assistant-settings";
import { ReplyService } from "../packages/hub/src/services/reply-service";
import type { SessionService } from "../packages/hub/src/services/session-service";

const NOW = 1_793_000_000_000;
const OUT_DIR = "/tmp/opencode/reply-check";

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (message: string, details?: unknown) =>
    process.stderr.write(`warn: ${message} ${JSON.stringify(details ?? {})}\n`),
  error: () => undefined,
} as unknown as Logger;

function session(overrides: Partial<Session> & { title: string }): Session {
  return {
    ref: "desktop-opencode:ses_fixture",
    providerID: "desktop-opencode",
    nativeID: "ses_fixture",
    status: "idle",
    unread: false,
    updatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function text(role: Message["role"], body: string, offset = 0): Message {
  const parts: MessagePart[] = [{ type: "text", text: body }];
  return {
    id: `m_${role}_${offset}`,
    sessionRef: "desktop-opencode:ses_fixture",
    role,
    parts,
    createdAt: NOW + offset,
    completedAt: NOW + offset,
  };
}

function runningShell(command: string): Message {
  return {
    id: "m_tool",
    sessionRef: "desktop-opencode:ses_fixture",
    role: "assistant",
    parts: [
      {
        type: "tool",
        id: "t1",
        name: "shell",
        status: "running",
        input: { command },
      },
    ],
    createdAt: NOW + 1,
  };
}

interface Fixture {
  name: string;
  note: string;
  session: Session;
  messages: Message[];
}

const FIXTURES: Fixture[] = [
  {
    name: "question-mirror",
    note: "Agent asks a direct question after a failed pull.",
    session: session({ title: "Docker pull failure" }),
    messages: [
      text("user", "Fix the docker pull failure.", 0),
      text(
        "assistant",
        "The pull failed because registry.docker.io returns 503. Should I switch to the mirror or retry the pull first?",
        1,
      ),
    ],
  },
  {
    name: "approval-merge",
    note: "Agent is waiting for a merge approval.",
    session: session({ title: "Reply cache refactor" }),
    messages: [
      text("user", "Refactor the reply cache. Do not change the API.", 0),
      text(
        "assistant",
        "Done. The cache is now bounded at 100 entries in reply-service.ts and all 459 tests pass. PR #92 is green. Merge it and I'll publish 0.1.29.",
        1,
      ),
    ],
  },
  {
    name: "done-delivery",
    note: "A finished turn with no pending action. This is the case that used to say nothing.",
    session: session({ title: "Auth race fix" }),
    messages: [
      text("user", "Fix the auth race in the session refresh path.", 0),
      text(
        "assistant",
        "Done. Fixed the auth race in session-service.ts by serialising the refresh. All 459 tests pass and the fix is pushed to main. Nothing else is pending.",
        1,
      ),
    ],
  },
  {
    name: "running-tests",
    note: "Agent is still running a background command.",
    session: session({ title: "Reply cache refactor", status: "running" }),
    messages: [
      text("user", "Refactor the reply cache.", 0),
      runningShell("pnpm test"),
    ],
  },
  {
    name: "failure-ci",
    note: "The Android build failed and the user is waiting for a route out.",
    session: session({ title: "Android build failure" }),
    messages: [
      text("user", "Build the Android app.", 0),
      text(
        "assistant",
        "The Android build failed: Gradle could not resolve androidx.core:core:1.12.0 from the offline cache. The container has 12.0.0 available. I have not changed any files yet.",
        1,
      ),
    ],
  },
  {
    name: "challenge-correction",
    note: "The user just corrected the agent's diagnosis.",
    session: session({ title: "Why does the inbox flicker?" }),
    messages: [
      text("user", "Why does the inbox flicker on mobile?", 0),
      text(
        "assistant",
        "The inbox flickers because the attention list refetches on every event.",
        1,
      ),
      text("user", "No — that's not it. The drawer remounts, not the list.", 2),
    ],
  },
];

async function readReplyConfig(): Promise<AssistantConfig["reply"]> {
  const fallback: AssistantConfig["reply"] = {
    enabled: true,
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "gemma-3-4b-it",
    timeoutMs: 90_000,
    disableThinking: true,
  };
  try {
    const path = `${homedir()}/.local/state/oktoso/state.json`;
    const state = JSON.parse(await readFile(path, "utf8")) as {
      settings?: { reply?: Partial<AssistantConfig["reply"]> };
    };
    return {
      ...fallback,
      ...state.settings?.reply,
      baseUrl: process.env.REPLY_BASE_URL ?? state.settings?.reply?.baseUrl ?? fallback.baseUrl,
      model: process.env.REPLY_MODEL ?? state.settings?.reply?.model ?? fallback.model,
      timeoutMs: Number(process.env.REPLY_TIMEOUT_MS ?? 90_000),
    };
  } catch {
    return fallback;
  }
}

function fakeSettings(reply: AssistantConfig["reply"]): AssistantSettingsService {
  return {
    config: () => ({
      reply,
      transcription: {
        enabled: false,
        baseUrl: "",
        model: "",
        timeoutMs: 1_000,
      },
    }),
  } as unknown as AssistantSettingsService;
}

function fakeSessions(fixture: Fixture): SessionService {
  return {
    messages: async () => ({
      data: structuredClone(fixture.messages),
      cursor: { next: null, previous: null },
    }),
    cachedSession: () => fixture.session,
  } as unknown as SessionService;
}

function optionLine(option: { role?: string; text: string }): string {
  const tag = option.role ? `[${option.role}]` : "[?]";
  return `- ${tag} ${option.text}`;
}

async function main() {
  const reply = await readReplyConfig();
  process.stdout.write(
    `reply model: ${reply.model} at ${reply.baseUrl}\n`,
  );
  const results: Array<{
    name: string;
    note: string;
    state?: string;
    kind?: string;
    pending?: string;
    done: string[];
    constraints: string[];
    context: string;
    modelOptions: Array<{ role?: string; text: string }>;
    rejected: Array<{ role?: string; text: string; reason: string }>;
    raw: string;
    reasoning: string;
    finishReason?: string;
    elapsedMs: number;
    error?: string;
  }> = [];

  for (const fixture of FIXTURES) {
    const fixtureService = new ReplyService(
      fakeSettings(reply),
      fakeSessions(fixture),
      logger,
    );
    const started = Date.now();
    try {
      const audit = await fixtureService.audit(
        fixture.session.ref,
        "reply",
      );
      const modelOptions = audit.options
        .filter((option) => option.source === "model")
        .map((option) => ({ role: option.role, text: option.text }));
      results.push({
        name: fixture.name,
        note: fixture.note,
        state: audit.moment.state,
        kind: audit.moment.kind,
        pending: audit.moment.pending,
        done: audit.moment.done,
        constraints: audit.moment.constraints,
        context: audit.context,
        modelOptions,
        rejected: audit.rejected.map((item) => ({
          role: item.role,
          text: item.text,
          reason: item.reason,
        })),
        raw: audit.raw,
        reasoning: audit.reasoning,
        finishReason: audit.finishReason,
        elapsedMs: Date.now() - started,
      });
      process.stdout.write(
        `${fixture.name}: ${modelOptions.length} options (${audit.moment.state}/${audit.moment.kind}) in ${Date.now() - started}ms\n`,
      );
    } catch (error) {
      results.push({
        name: fixture.name,
        note: fixture.note,
        done: [],
        constraints: [],
        context: "",
        modelOptions: [],
        rejected: [],
        raw: "",
        reasoning: "",
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`${fixture.name}: ERROR ${String(error)}\n`);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = `${OUT_DIR}/report.json`;
  const mdPath = `${OUT_DIR}/report.md`;
  await writeFile(jsonPath, JSON.stringify({ reply, results }, null, 2));

  const lines = [
    "# Reply prompt check",
    "",
    `Model: \`${reply.model}\` at \`${reply.baseUrl}\``,
    "",
    "Rubric for each fixture: does every chip read like a real user message, name a concrete entity from the transcript, stay 2-12 words, and cover distinct intents? A good set has at least four chips, includes a credible alternative or a verification step, and never repeats a question the assistant already asked.",
    "",
  ];
  for (const result of results) {
    lines.push(`## ${result.name}`, "");
    lines.push(result.note, "");
    lines.push(
      `Moment: \`${result.state ?? "?"}\` / \`${result.kind ?? "?"}\`` +
        (result.pending ? ` · pending: ${result.pending}` : ""),
    );
    if (result.done.length > 0) {
      lines.push(`Done: ${result.done.map((item) => `"${item}"`).join("; ")}`);
    }
    if (result.constraints.length > 0) {
      lines.push(`Constraints: ${result.constraints.join(" | ")}`);
    }
    lines.push("");
    if (result.error) {
      lines.push(`**ERROR**: ${result.error}`, "");
      continue;
    }
    lines.push(`Accepted (${result.modelOptions.length}):`);
    lines.push(...result.modelOptions.map(optionLine));
    lines.push("");
    if (result.rejected.length > 0) {
      lines.push("Rejected:");
      lines.push(
        ...result.rejected.map(
          (item) => `- [${item.role}] ${item.text} (${item.reason})`,
        ),
      );
      lines.push("");
    }
    lines.push(
      `Raw: \`${result.raw.replace(/\n/g, " ").slice(0, 500)}\``,
      `Finish: ${result.finishReason ?? "?"} · ${result.elapsedMs}ms`,
      "",
    );
  }
  await writeFile(mdPath, lines.join("\n"));

  process.stdout.write(`\nwrote ${mdPath}\nwrote ${jsonPath}\n`);
}

await main();
