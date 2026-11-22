#!/usr/bin/env node
/**
 * Benchmark the shipped assistant loop through the hub API.
 *
 * Unlike `spike-context.mjs`, this drives the real `AssistantService`: the
 * shipped prompt, retrieval tools, paging, evidence, and usage. It creates a
 * session-scoped thread, asks each suite question, polls the thread until the
 * answer lands, and scores it with the suite's regex.
 *
 * Usage:
 *   node scripts/bench-assistant.mjs --session <ref> --suite questions.json
 *   node scripts/bench-assistant.mjs --free --suite questions.json
 *   node scripts/bench-assistant.mjs --session <ref> "one question" [--expect ok]
 *
 * Options:
 *   --session <ref>   session scope (must have no existing thread, unless
 *                     --append is passed: the run would add turns to it)
 *   --free            pick a visible session that has no assistant thread
 *   --suite <file>    JSON: { "questions": [{ "question", "expect" }] }
 *   --expect <regex>  expectation for the single-question form
 *   --timeout <s>     per-question wait, default 180
 *   --append          allow an existing thread (the turns stay)
 *   --json            machine-readable report
 *
 * Environment:
 *   HUB_CONFIG        hub config path (default ~/.config/oktoso/hub.config.json)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG = join(homedir(), ".config/oktoso/hub.config.json");

function parseArgs(argv) {
  const options = {
    session: undefined,
    free: false,
    suite: undefined,
    expect: undefined,
    timeoutSec: 180,
    append: false,
    keep: false,
    json: false,
    words: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case "--session": options.session = value(); break;
      case "--free": options.free = true; break;
      case "--suite": options.suite = value(); break;
      case "--expect": options.expect = value(); break;
      case "--timeout": options.timeoutSec = Number(value()); break;
      case "--append": options.append = true; break;
      case "--keep": options.keep = true; break;
      case "--json": options.json = true; break;
      case "--help":
        console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].trim());
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
        options.words.push(arg);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const config = JSON.parse(
  readFileSync(process.env.HUB_CONFIG ?? DEFAULT_CONFIG, "utf8"),
);
const host = String(config.host ?? "127.0.0.1").replace(/^(?!http)/, "http://");
const base = `${host.replace(/\/+$/, "")}:${config.port ?? 8787}`;
const headers = {
  Authorization: `Bearer ${config.token}`,
  "Content-Type": "application/json",
};

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers });
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status}`);
  return response.json();
}

const threadPage = await get("/api/v1/assistant/threads");
const sessionThreads = new Map(
  threadPage.data
    .filter((thread) => thread.scope?.kind === "session")
    .map((thread) => [thread.scope.sessionRef, thread]),
);

let sessionRef = options.session;
if (!sessionRef && options.free) {
  const sessions = await get("/api/v1/sessions?limit=50");
  sessionRef = sessions.data.find((session) => !sessionThreads.has(session.ref))?.ref;
  if (!sessionRef) throw new Error("every visible session already has a thread");
}
if (!sessionRef) {
  throw new Error("pass --session <ref> or --free");
}

const existing = sessionThreads.get(sessionRef);
if (existing && !options.append) {
  throw new Error(
    `that session already has thread ${existing.id} (${existing.messageCount} messages); pass --append to add turns to it`,
  );
}

const suite = options.suite
  ? JSON.parse(readFileSync(options.suite, "utf8")).questions
  : [{ question: options.words.join(" "), expect: options.expect }];
if (!suite.length || !suite[0].question) throw new Error("no question");

const before = new Set(threadPage.data.map((thread) => thread.id));
const created = await post("/api/v1/assistant/threads", {
  scope: { kind: "session", sessionRef },
});
const threadId = created.data.id;
const owned = !before.has(threadId);

const report = [];
try {
  for (const entry of suite) {
    const started = Date.now();
    const accepted = await post(`/api/v1/assistant/threads/${threadId}/messages`, {
      text: entry.question,
    });
    const runId = accepted.data.run.id;

    let turn;
    let error;
    while (Date.now() - started < options.timeoutSec * 1_000) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const detail = await get(`/api/v1/assistant/threads/${threadId}`);
      const candidate = detail.data.turns.find(
        (row) => row.role === "assistant" && row.runId === runId,
      );
      if (candidate?.usage || candidate?.error) {
        turn = candidate;
        break;
      }
      if (!candidate) error = "no assistant turn";
    }
    if (!turn) throw new Error(error ?? `timed out after ${options.timeoutSec}s`);

    const hit =
      entry.expect === undefined
        ? undefined
        : new RegExp(entry.expect, "i").test(turn.text);
    report.push({
      question: entry.question,
      expect: entry.expect,
      hit,
      ms: Date.now() - started,
      answer: turn.text,
      action: turn.action?.kind ?? null,
      error: turn.error,
      usage: turn.usage,
      steps: turn.activity?.length ?? 0,
      calls: (turn.activity ?? []).filter((step) => step.kind === "tool").length,
    });
  }
} finally {
  if (owned && !options.keep) {
    await fetch(`${base}/api/v1/assistant/threads/${threadId}`, {
      method: "DELETE",
      headers,
    });
  }
}

if (options.json) {
  console.log(JSON.stringify({ session: sessionRef, thread: threadId, report }, null, 2));
} else {
  for (const row of report) {
    console.log(
      `${row.hit === undefined ? "----" : row.hit ? "PASS" : "MISS"}  ${String(
        row.ms,
      ).padStart(6)}ms  ${String(row.usage?.promptTokens ?? 0).padStart(6)} in  ${String(
        row.calls,
      ).padStart(2)} call(s)  ${row.question}`,
    );
    if (row.action) console.log(`      action proposed: ${row.action} (not scored)`);
    if (row.error) console.log(`      error: ${row.error}`);
  }
  const scored = report.filter((row) => row.hit !== undefined);
  console.log(
    `\n${scored.filter((row) => row.hit).length}/${scored.length} hits · ${Math.round(
      report.reduce((total, row) => total + row.ms, 0) / 1000,
    )}s · ${report.reduce((total, row) => total + (row.usage?.promptTokens ?? 0), 0)} in · ${report.reduce(
      (total, row) => total + (row.usage?.completionTokens ?? 0),
      0,
    )} out · ${report.reduce((total, row) => total + row.calls, 0)} tool calls`,
  );
  if (owned && !options.keep) console.log("thread deleted");
  if (owned && options.keep) console.log(`thread kept: ${threadId}`);
}
