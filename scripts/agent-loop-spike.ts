/**
 * Agent-loop spike: for each attention item, ask the hub's reply model what it
 * would say next, print the proposal, and stop there.
 *
 * This is the "LLM supervises" experiment, not a feature. It never sends,
 * never resolves attention, and never writes to the hub. The only side effect
 * is the model call the hub already exposes to the composer.
 *
 *   pnpm exec tsx scripts/agent-loop-spike.ts
 *   pnpm exec tsx scripts/agent-loop-spike.ts --session desktop-opencode:ses_x
 *   pnpm exec tsx scripts/agent-loop-spike.ts --type error --limit 3
 *   pnpm exec tsx scripts/agent-loop-spike.ts --decide --session desktop-opencode:ses_x
 *   pnpm exec tsx scripts/agent-loop-spike.ts --interval 60 --json /tmp/opencode/agent-loop.json
 *
 * Two brains, to compare:
 *   default   the composer's reply service (GET /reply-options): fast, but its
 *             prompt is built for "what can I say to this pending moment"
 *   --decide  a supervisor prompt written for this experiment: the model gets
 *             the transcript and returns send/wait/escalate as strict JSON.
 *             It calls the configured reply endpoint directly, so it refuses
 *             when the hub holds an API key (the script cannot read it).
 *
 * It reads the same config and owner token as `oktoso status`, so point
 * --config at the hub's config when it is not the default one.
 *
 * What the report means:
 *   SEND      high confidence and a concrete answer/next step; a real loop
 *             would send this text
 *   REVIEW    a draft exists but confidence is medium/low; a real loop would
 *             put it in the approval queue
 *   ESCALATE  the model has no draft for a failure or blocker; a human must act
 *   WAIT      the session is running or the moment is not ready
 *   DONE      the moment is finished; nothing to do
 *   NO DRAFT  the reply model is off or returned only canned options
 *
 * The move is mapped from the reply service's state, kind, confidence, and the
 * role of its first model option. It is not a new model output.
 */
import { writeFile } from "node:fs/promises";
import type {
  Attention,
  AttentionType,
  Message,
  ReplyOption,
  ReplyOptions,
  Session,
} from "@amoshydra/oktoso-contracts";
import { HubClient } from "@amoshydra/oktoso-client";
import { loadPairingConfig } from "../packages/hub/src/config/load";
import { pairingRequestUrl } from "../packages/hub/src/cli/urls";

const TIMEOUT_MS = 120_000;
const DEFAULT_CONFIG = "hub.config.json";

type Move = "send" | "review" | "escalate" | "wait" | "done" | "no_draft";

interface Options {
  configPath: string;
  url?: string;
  session?: string;
  type?: AttentionType;
  limit: number;
  intervalMs: number;
  json?: string;
  refresh: boolean;
  decide: boolean;
}

interface Decision {
  action: "send" | "wait" | "escalate";
  message?: string;
  reason?: string;
  confidence?: "high" | "medium" | "low";
}

interface Proposal {
  move: Move;
  option?: ReplyOption;
  message?: string;
  reason: string;
  state?: string;
  kind?: string;
  confidence?: string;
  model?: string;
  durationMs: number;
}

interface ReportItem {
  attention: Pick<
    Attention,
    "id" | "type" | "title" | "summary" | "sessionRef" | "createdAt"
  >;
  proposal: Proposal;
}

function usage(): string {
  return `Agent-loop spike — proposals only, nothing is sent.

Usage:
  agent-loop-spike [options]

Options:
  --config <path>     Hub config (default: ${DEFAULT_CONFIG}, else the platform path)
  --url <url>         Hub base URL (default: the config's publicUrl or host:port)
  --session <ref>     Probe one session instead of listing attention
  --type <type>       permission | approval | question | unread | error
  --limit <n>         Stop after n items (default: 5)
  --interval <sec>    Repeat every n seconds; 0 runs once (default: 0)
  --json <path>       Write the full report as JSON
  --refresh           In loop mode, re-ask the model for an unchanged item
  --decide            Use the supervisor prompt (send/wait/escalate) instead of
                      the composer's reply-options
  --help, -h          Show this help

The report is read-only. There is no send path in this script.
`;
}

function parse(argv: string[]): Options {
  const options: Options = {
    configPath: process.env.HUB_CONFIG ?? DEFAULT_CONFIG,
    limit: 5,
    intervalMs: 0,
    refresh: false,
    decide: false,
  };
  const types = new Set([
    "permission",
    "approval",
    "question",
    "unread",
    "error",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--config":
        options.configPath = value();
        break;
      case "--url":
        options.url = value();
        break;
      case "--session":
        options.session = value();
        break;
      case "--type": {
        const type = value();
        if (!types.has(type)) throw new Error(`Unknown attention type: ${type}`);
        options.type = type as AttentionType;
        break;
      }
      case "--limit": {
        const limit = Number(value());
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit needs a positive integer");
        }
        options.limit = limit;
        break;
      }
      case "--interval": {
        const seconds = Number(value());
        if (!Number.isFinite(seconds) || seconds < 0) {
          throw new Error("--interval needs a number of seconds");
        }
        options.intervalMs = Math.round(seconds * 1_000);
        break;
      }
      case "--json":
        options.json = value();
        break;
      case "--refresh":
        options.refresh = true;
        break;
      case "--decide":
        options.decide = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

/** A timeout that clears its timer so a finished call does not keep the loop alive. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms} ms`)),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function chooseOption(reply: ReplyOptions): ReplyOption | undefined {
  const model = reply.data.filter(
    (option) => option.source === "model" && option.text.trim().length > 0,
  );
  return (
    model.find((option) => option.role === "answer") ??
    model.find((option) => option.role === "next") ??
    model[0]
  );
}

function decide(reply: ReplyOptions): Omit<Proposal, "durationMs"> {
  const base = {
    state: reply.state,
    kind: reply.kind,
    confidence: reply.confidence,
    ...(reply.model ? { model: reply.model } : {}),
  };

  if (reply.state === "done") {
    return { ...base, move: "done", reason: "the moment is finished" };
  }
  if (reply.state === "wait") {
    return { ...base, move: "wait", reason: "the session is still working" };
  }

  const option = chooseOption(reply);
  if (!option) {
    if (reply.kind === "failure" || reply.kind === "blocker") {
      return {
        ...base,
        move: "escalate",
        reason: `no draft for a ${reply.kind}`,
      };
    }
    return {
      ...base,
      move: "no_draft",
      reason: "the reply model returned no usable text",
    };
  }

  if (reply.confidence === "high") {
    return {
      ...base,
      move: "send",
      option,
      reason: `high confidence ${option.role ?? "reply"}`,
    };
  }
  return {
    ...base,
    move: "review",
    option,
    reason: `${reply.confidence ?? "unknown"} confidence ${option.role ?? "reply"}`,
  };
}

function moveLabel(move: Move): string {
  switch (move) {
    case "send":
      return "SEND";
    case "review":
      return "REVIEW";
    case "escalate":
      return "ESCALATE";
    case "wait":
      return "WAIT";
    case "done":
      return "DONE";
    case "no_draft":
      return "NO DRAFT";
  }
}

const SUPERVISOR_PROMPT = `You supervise one coding-agent session. Decide the single next move.

Return JSON only, with this shape:
{"action":"send"|"wait"|"escalate","message":"...","reason":"...","confidence":"high"|"medium"|"low"}

- send: a human reply is needed now. "message" is the exact text to send.
- wait: the agent is working, or the work is complete. No reply helps.
- escalate: a human must decide something the transcript does not answer.

Rules:
- Never repeat the user's last message as the message.
- If the last turn is the assistant's and the work looks complete, wait.
- If the last turn asks a question, answer it concretely in under 40 words.
- No markdown, no preamble, no code fences.
- reason is one short sentence.`;

interface SupervisorConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  disableThinking: boolean;
}

function messageText(message: Message): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function transcriptText(messages: Message[]): string {
  return [...messages]
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-14)
    .map((message) => {
      const body = messageText(message).slice(0, 800);
      return body ? `${message.role.toUpperCase()}: ${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseDecision(content: string): Decision {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("the model returned no JSON object");
  }
  const parsed = JSON.parse(content.slice(start, end + 1)) as Partial<Decision>;
  if (
    parsed.action !== "send" &&
    parsed.action !== "wait" &&
    parsed.action !== "escalate"
  ) {
    throw new Error(`invalid action: ${String(parsed.action)}`);
  }
  return {
    action: parsed.action,
    ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
    ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    ...(parsed.confidence === "high" ||
    parsed.confidence === "medium" ||
    parsed.confidence === "low"
      ? { confidence: parsed.confidence }
      : {}),
  };
}

async function askSupervisor(
  supervisor: SupervisorConfig,
  attention: Attention,
  session: Session | undefined,
  messages: Message[],
): Promise<Decision> {
  const body: Record<string, unknown> = {
    model: supervisor.model,
    messages: [
      { role: "system", content: SUPERVISOR_PROMPT },
      {
        role: "user",
        content: [
          `Session: ${session?.title ?? attention.title}`,
          `Status: ${session?.status ?? "unknown"} · ${session?.providerID ?? "unknown"}`,
          `Attention: ${attention.type} — ${attention.title} — ${attention.summary}`,
          "",
          "Transcript, oldest first:",
          transcriptText(messages),
        ].join("\n"),
      },
    ],
    temperature: 0.2,
    max_tokens: 300,
    stream: false,
    ...(supervisor.disableThinking
      ? { chat_template_kwargs: { enable_thinking: false } }
      : {}),
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["action", "message", "reason", "confidence"],
    properties: {
      action: { type: "string", enum: ["send", "wait", "escalate"] },
      message: { type: "string" },
      reason: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  };
  const structured = {
    ...body,
    response_format: {
      type: "json_schema",
      json_schema: { name: "supervisor_decision", strict: true, schema },
    },
  };

  const post = (payload: Record<string, unknown>): Promise<Response> =>
    fetch(`${supervisor.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(supervisor.timeoutMs),
    });

  let response = await post(structured);
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await post(body);
  }
  if (!response.ok) {
    throw new Error(`supervisor model returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return parseDecision(content);
}

function decisionProposal(decision: Decision, durationMs: number): Proposal {
  const message = decision.message?.trim();
  const base = {
    message: message || undefined,
    confidence: decision.confidence,
    durationMs,
  };
  if (decision.action === "wait") {
    return {
      ...base,
      move: "wait",
      reason: decision.reason ?? "the supervisor says wait",
    };
  }
  if (decision.action === "escalate") {
    return {
      ...base,
      move: "escalate",
      reason: decision.reason ?? "the supervisor needs a human",
    };
  }
  if (!message) {
    return { ...base, move: "escalate", reason: "send with no message" };
  }
  if (decision.confidence === "high") {
    return {
      ...base,
      move: "send",
      reason: decision.reason ?? "high confidence send",
    };
  }
  return {
    ...base,
    move: "review",
    reason: decision.reason ?? "the supervisor wants a human check",
  };
}

function summarize(attention: Attention): ReportItem["attention"] {
  return {
    id: attention.id,
    type: attention.type,
    title: attention.title,
    summary: attention.summary,
    sessionRef: attention.sessionRef,
    createdAt: attention.createdAt,
  };
}

async function probe(
  client: HubClient,
  attention: Attention,
  supervisor: SupervisorConfig | undefined,
): Promise<ReportItem> {
  const started = Date.now();
  try {
    if (supervisor) {
      const session = await client.session(attention.sessionRef).catch(() => undefined);
      const messages = session
        ? (await client.messages(attention.sessionRef, { limit: 20 })).data
        : [];
      const decision = await withTimeout(
        askSupervisor(supervisor, attention, session, messages),
        TIMEOUT_MS,
        `supervisor for ${attention.sessionRef}`,
      );
      return {
        attention: summarize(attention),
        proposal: decisionProposal(decision, Date.now() - started),
      };
    }
    const reply = await withTimeout(
      client.replyOptions(attention.sessionRef),
      TIMEOUT_MS,
      `reply options for ${attention.sessionRef}`,
    );
    return {
      attention: summarize(attention),
      proposal: { ...decide(reply), durationMs: Date.now() - started },
    };
  } catch (error) {
    return {
      attention: summarize(attention),
      proposal: {
        move: "escalate",
        reason: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      },
    };
  }
}

function printItem(entry: ReportItem, index?: number, total?: number): void {
  const { attention, proposal } = entry;
  const prefix = index !== undefined && total !== undefined ? `[${index + 1}/${total}] ` : "";
  const moment = [
    proposal.kind ?? "supervisor",
    proposal.state ? `state ${proposal.state}` : undefined,
    proposal.confidence ? `${proposal.confidence} confidence` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  process.stdout.write(`${prefix}${attention.type} · ${attention.title}\n`);
  process.stdout.write(`      ${attention.sessionRef}\n`);
  process.stdout.write(`      ${moment} · ${proposal.durationMs} ms\n`);
  process.stdout.write(
    `      move: ${moveLabel(proposal.move)} — ${proposal.reason}\n`,
  );
  if (
    proposal.message &&
    (proposal.move === "send" || proposal.move === "review")
  ) {
    process.stdout.write(`      "${proposal.message}"\n`);
  } else if (proposal.option) {
    const label = proposal.option.label ? ` (${proposal.option.label})` : "";
    process.stdout.write(`      "${proposal.option.text.trim()}"${label}\n`);
  }
}

async function loadSessionItem(
  client: HubClient,
  ref: string,
): Promise<Attention> {
  let session: Session | undefined;
  try {
    session = await client.session(ref);
  } catch {
    session = undefined;
  }
  return {
    id: `spike:${ref}`,
    sessionRef: ref,
    type: "unread",
    priority: "normal",
    title: session?.title ?? ref,
    summary: session
      ? `${session.status} · ${session.providerID}`
      : "session probe",
    createdAt: Date.now(),
    actions: [],
  };
}

async function listItems(
  client: HubClient,
  options: Options,
): Promise<Attention[]> {
  if (options.session) {
    return [await loadSessionItem(client, options.session)];
  }
  const page = await client.attention(
    options.type ? { type: options.type } : {},
  );
  return page.data.slice(0, options.limit);
}

async function loadSupervisor(client: HubClient): Promise<SupervisorConfig> {
  const settings = await client.assistantSettings();
  const reply = settings.reply;
  if (!reply.enabled || !reply.baseUrl.trim() || !reply.model?.trim()) {
    throw new Error(
      "the reply model is not configured; enable it in Settings → Assistant",
    );
  }
  if (reply.hasApiKey) {
    throw new Error(
      "the hub holds an API key for the reply model, which this spike cannot read; run without --decide",
    );
  }
  return {
    baseUrl: reply.baseUrl,
    model: reply.model,
    timeoutMs: reply.timeoutMs,
    disableThinking: reply.disableThinking,
  };
}

async function runOnce(options: Options): Promise<number> {
  const config = await loadPairingConfig(options.configPath);
  const baseUrl =
    options.url ?? process.env.HUB_URL ?? pairingRequestUrl(config);
  const client = new HubClient({ baseUrl, token: config.token });
  const supervisor = options.decide ? await loadSupervisor(client) : undefined;
  const attention = await listItems(client, options);

  if (attention.length === 0) {
    process.stdout.write("Nothing needs attention. Nothing to propose.\n");
    return 0;
  }

  process.stdout.write("Agent-loop spike · proposals only, nothing is sent\n");
  process.stdout.write(`Hub   ${baseUrl}\n`);
  process.stdout.write(
    `Brain ${supervisor ? `supervisor prompt · ${supervisor.model}` : "reply-options"}\n\n`,
  );

  const report: ReportItem[] = [];
  for (const [index, item] of attention.entries()) {
    const entry = await probe(client, item, supervisor);
    report.push(entry);
    printItem(entry, index, attention.length);
    process.stdout.write("\n");
  }

  const counts = new Map<Move, number>();
  for (const entry of report) {
    counts.set(entry.proposal.move, (counts.get(entry.proposal.move) ?? 0) + 1);
  }
  process.stdout.write(
    `Summary: ${[...counts.entries()]
      .map(([move, count]) => `${count} ${moveLabel(move)}`)
      .join(" · ")}\n`,
  );

  if (options.json) {
    await writeFile(
      options.json,
      `${JSON.stringify(
        { generatedAt: Date.now(), baseUrl, items: report },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`Wrote ${options.json}\n`);
  }

  return 0;
}

async function runLoop(options: Options): Promise<number> {
  const config = await loadPairingConfig(options.configPath);
  const baseUrl =
    options.url ?? process.env.HUB_URL ?? pairingRequestUrl(config);
  const client = new HubClient({ baseUrl, token: config.token });
  const supervisor = options.decide ? await loadSupervisor(client) : undefined;
  const seen = new Set<string>();

  process.stdout.write(
    `Agent-loop spike · proposals only, nothing is sent · every ${Math.round(
      options.intervalMs / 1_000,
    )}s\n`,
  );
  process.stdout.write(`Hub   ${baseUrl}\n\n`);

  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    const attention = await listItems(client, options);
    for (const item of attention) {
      const key = `${item.id}:${item.createdAt}`;
      if (!options.refresh && seen.has(key)) continue;
      seen.add(key);
      const entry = await probe(client, item, supervisor);
      printItem(entry);
      process.stdout.write("\n");
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }

  return 0;
}

async function main(): Promise<void> {
  let options: Options;
  try {
    options = parse(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${usage()}`,
    );
    process.exit(2);
  }

  try {
    const code =
      options.intervalMs === 0
        ? await runOnce(options)
        : await runLoop(options);
    process.exit(code);
  } catch (error) {
    process.stderr.write(
      `Agent-loop spike failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exit(1);
  }
}

void main();
