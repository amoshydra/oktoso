import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  AttentionActionInput,
  AttentionPage,
  AttentionType,
  AutomationApproval,
  AutomationRun,
  AutomationSettingsInput,
  AutomationView,
  CreateSessionInput,
  Handoff,
  HubEvent,
  MessagePage,
  MessagesQuery,
  Provider,
  ProviderHealth,
  QuestionPrompt,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import { isDestructiveText, isSensitiveText } from "../lib/destructive";

export interface McpHubApi {
  providers(): Promise<Provider[]>;
  checkProvider(id: string): Promise<ProviderHealth>;
  sessions(query?: SessionListQuery): Promise<SessionPage>;
  session(ref: string): Promise<Session>;
  messages(ref: string, query?: MessagesQuery): Promise<MessagePage>;
  proposeHandoff(input: {
    sourceRef?: string;
    targetRef: string;
    message: string;
    reason?: string;
    evidence?: string;
    callerSessionId?: string;
    createdBy?: "agent" | "owner";
    createdByRef?: string;
  }): Promise<Handoff>;
  question(ref: string): Promise<QuestionPrompt | null>;
  attention(query?: {
    type?: AttentionType;
    sessionRef?: string;
  }): Promise<AttentionPage>;
  sendMessage(
    ref: string,
    input: SendInput,
    options?: { idempotencyKey?: string },
  ): Promise<SendResult>;
  createSession(input: CreateSessionInput): Promise<Session>;
  interrupt(ref: string): Promise<void>;
  markRead(ref: string): Promise<void>;
  actOnAttention(
    id: string,
    action: string,
    input?: AttentionActionInput,
  ): Promise<void>;
  automation(): Promise<AutomationView>;
  automationRuns(limit?: number): Promise<AutomationRun[]>;
  approvals(): Promise<AutomationApproval[]>;
  setAutomation(input: AutomationSettingsInput): Promise<AutomationView>;
  setWatcherPaused(id: string, paused: boolean): Promise<AutomationView>;
  actOnApproval(id: string, action: "approve" | "deny"): Promise<void>;
}

export interface McpCallRecord {
  tool: string;
  ok: boolean;
  durationMs: number;
  callerSessionId?: string;
  target?: string;
  error?: string;
}

export interface OktosoMcpOptions {
  api: McpHubApi;
  version: string;
  allowWrite?: boolean;
  /** Register only these tools. Unknown or write tools are ignored. */
  tools?: string[];
  /** Per tool-call timeout. Defaults to no timeout. */
  timeoutMs?: number;
  onCall?: (record: McpCallRecord) => void;
  /** Host event stream used to notify resource subscribers. */
  events?: {
    subscribe(listener: (event: HubEvent) => void): () => void;
  };
}

interface ToolExtra {
  _meta?: Record<string, unknown>;
}

const WRITE_TOOLS = new Set([
  "sessions_send",
  "sessions_create",
  "sessions_interrupt",
  "sessions_mark_read",
  "attention_act",
  "automation_pause",
  "approvals_act",
]);

export const MCP_READ_TOOL_NAMES = [
  "providers_list",
  "providers_check",
  "sessions_list",
  "sessions_get",
  "sessions_messages",
  "attention_list",
  "questions_get",
  "automation_list",
  "approvals_list",
  "handoff_propose",
] as const;

export const MCP_WRITE_TOOL_NAMES = [
  "sessions_send",
  "sessions_create",
  "sessions_interrupt",
  "sessions_mark_read",
  "attention_act",
  "automation_pause",
  "approvals_act",
] as const;

export const MCP_TOOL_NAMES = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export const MCP_ATTENTION_RESOURCE = "oktoso://attention";
export const MCP_SESSIONS_RESOURCE = "oktoso://sessions";
export const MCP_AUTOMATION_RESOURCE = "oktoso://automation";

const INSTRUCTIONS = `Oktoso is a control plane for sessions across AI providers.

Read before acting. Start with attention_list, then sessions_messages for context.
Never act on the OpenCode session that invoked you; the server rejects it.
Only answer questions when the intent is clear. Deny destructive or sensitive
permission requests unless the user explicitly approved them.
Use a stable idempotencyKey for sessions_send so retries do not double-send.
Prefer mark_read or a reply over interrupt.
Use automation_list and approvals_list before approvals_act, and only approve
actions the user has explicitly approved.

When the user asks you to hand work to another session, use handoff_propose.
It creates a pending card in the source session; it does not send until the
owner approves it there. This is the cross-session message path; sessions_send
is only available to a write-scoped token and is not required for a handoff.
When proposing, put the full context and acceptance criteria in message, and a
compact evidence reference (queue entry, log line, commit, or run ID) in
evidence.`;

function textResult(value: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function callerSessionID(extra: ToolExtra): string | undefined {
  const value = extra._meta?.["ai.opencode/sessionID"];
  return typeof value === "string" && value ? value : undefined;
}

/** Resolve an OpenCode caller ID to a hub session ref for handoff provenance. */
async function callerSourceRef(
  api: McpHubApi,
  extra: ToolExtra,
): Promise<string | undefined> {
  const caller = callerSessionID(extra);
  if (!caller) return undefined;
  try {
    const page = await api.sessions({ q: caller, limit: 50 });
    const found = page.data.find(
      (session) =>
        session.nativeID === caller ||
        session.ref === caller ||
        session.ref.endsWith(`:${caller}`),
    );
    return found?.ref;
  } catch {
    return undefined;
  }
}

function assertNotCaller(ref: string, extra: ToolExtra): void {
  const caller = callerSessionID(extra);
  if (caller && (ref === caller || ref.endsWith(`:${caller}`))) {
    throw new Error("Refusing to act on the OpenCode session that invoked this tool.");
  }
}

function isApprovalAction(action: string): boolean {
  return /^(allow|approve|always|accept)/i.test(action);
}

function targetOf(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ["ref", "sessionRef", "attentionId", "providerID", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> {
  if (!timeoutMs) return work();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Tool call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createOktosoMcpServer(options: OktosoMcpOptions): McpServer {
  const { api } = options;
  const allowed = new Set(options.tools ?? []);
  const restricted = options.tools !== undefined;
  const canReadAttention = !restricted || allowed.has("attention_list");
  const canReadSessions = !restricted || allowed.has("sessions_list");
  const canReadAutomation = !restricted || allowed.has("automation_list");
  const server = new McpServer(
    { name: "oktoso", version: options.version },
    {
      instructions: INSTRUCTIONS,
      capabilities: { resources: { subscribe: true } },
    },
  );
  const subscribed = new Set<string>();

  function enabled(tool: string): boolean {
    if (WRITE_TOOLS.has(tool) && options.allowWrite !== true) return false;
    return !restricted || allowed.has(tool);
  }

  if (canReadAttention) {
    server.registerResource(
      "attention",
      MCP_ATTENTION_RESOURCE,
      {
        title: "Attention inbox",
        description:
          "Permissions, approvals, questions, unread sessions, and errors that need action.",
        mimeType: "application/json",
      },
      async (uri) => {
        const page = await api.attention();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(page),
            },
          ],
        };
      },
    );
  }

  if (canReadSessions) {
    server.registerResource(
      "sessions",
      MCP_SESSIONS_RESOURCE,
      {
        title: "Sessions",
        description: "The newest 50 sessions across providers.",
        mimeType: "application/json",
      },
      async (uri) => {
        const page = await api.sessions({ limit: 50 });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(page),
            },
          ],
        };
      },
    );
  }

  if (canReadAutomation) {
    server.registerResource(
      "automation",
      MCP_AUTOMATION_RESOURCE,
      {
        title: "Automation",
        description:
          "Watchers, start templates, dry-run/pause state, recent runs, and pending approvals.",
        mimeType: "application/json",
      },
      async (uri) => {
        const view = await api.automation();
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({
                data: {
                  ...view,
                  runs: view.runs.slice(0, 10),
                  approvals: view.approvals.slice(0, 10),
                  allowedShapes: view.allowedShapes.slice(0, 20),
                },
              }),
            },
          ],
        };
      },
    );
  }

  server.server.setRequestHandler(
    SubscribeRequestSchema,
    async ({ params }) => {
      if (
        (params.uri === MCP_ATTENTION_RESOURCE && canReadAttention) ||
        (params.uri === MCP_SESSIONS_RESOURCE && canReadSessions) ||
        (params.uri === MCP_AUTOMATION_RESOURCE && canReadAutomation)
      ) {
        subscribed.add(params.uri);
        return {};
      }
      throw new Error(`Resource is not available: ${params.uri}`);
    },
  );
  server.server.setRequestHandler(
    UnsubscribeRequestSchema,
    async ({ params }) => {
      subscribed.delete(params.uri);
      return {};
    },
  );

  if (options.events) {
    const unsubscribe = options.events.subscribe((event) => {
      const uri = event.type.startsWith("attention.")
        ? MCP_ATTENTION_RESOURCE
        : event.type.startsWith("session.")
          ? MCP_SESSIONS_RESOURCE
          : event.type.startsWith("automation.")
            ? MCP_AUTOMATION_RESOURCE
            : undefined;
      if (!uri || !subscribed.has(uri)) return;
      void server.server.sendResourceUpdated({ uri }).catch(() => undefined);
    });
    const previous = server.server.onclose;
    server.server.onclose = () => {
      unsubscribe();
      previous?.();
    };
  }

  async function respond(
    tool: string,
    work: () => Promise<unknown>,
    context: { args?: unknown; extra?: ToolExtra; target?: string } = {},
  ): Promise<CallToolResult> {
    const started = performance.now();
    const caller = context.extra ? callerSessionID(context.extra) : undefined;
    const target = context.target ?? targetOf(context.args);
    const audit = (record: McpCallRecord) => {
      try {
        options.onCall?.(record);
      } catch {
        // Audit failures must not change the tool result.
      }
    };
    try {
      const value = await withTimeout(work, options.timeoutMs);
      audit({
        tool,
        ok: true,
        durationMs: Math.round(performance.now() - started),
        ...(caller ? { callerSessionId: caller } : {}),
        ...(target ? { target } : {}),
      });
      return textResult(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      audit({
        tool,
        ok: false,
        durationMs: Math.round(performance.now() - started),
        ...(caller ? { callerSessionId: caller } : {}),
        ...(target ? { target } : {}),
        error: message,
      });
      return errorResult(error);
    }
  }

  if (enabled("providers_list")) {
    server.registerTool(
      "providers_list",
      {
        title: "List providers",
        description: "List configured providers with their connection status.",
        annotations: { readOnlyHint: true },
      },
      async (extra) =>
        respond(
          "providers_list",
          async () => {
            return { data: await api.providers() };
          },
          { extra },
        ),
    );
  }

  if (enabled("providers_check")) {
    server.registerTool(
      "providers_check",
      {
        title: "Check a provider",
        description: "Run a live health check for one provider.",
        inputSchema: {
          id: z.string().describe("Provider ID"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ id }, extra) =>
        respond(
          "providers_check",
          async () => {
            return api.checkProvider(id);
          },
          { args: { id }, extra },
        ),
    );
  }

  if (enabled("sessions_list")) {
    server.registerTool(
      "sessions_list",
      {
        title: "List sessions",
        description:
          "List sessions across providers. Filter by provider, status, or title/project query.",
        inputSchema: {
          provider: z.string().optional().describe("Provider ID"),
          status: z
            .enum(["running", "idle", "error", "offline"])
            .optional()
            .describe("Session status"),
          scope: z.enum(["all", "root"]).optional(),
          q: z.string().optional().describe("Title or project query"),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(50).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args, extra) =>
        respond(
          "sessions_list",
          async () => {
            return api.sessions({ ...args, limit: args.limit ?? 20 });
          },
          { args, extra },
        ),
    );
  }

  if (enabled("sessions_get")) {
    server.registerTool(
      "sessions_get",
      {
        title: "Get session",
        description: "Read one session by its Oktoso ref.",
        inputSchema: {
          ref: z.string().describe("Session ref, for example opencode:ses_abc"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ ref }, extra) =>
        respond(
          "sessions_get",
          async () => {
            return api.session(ref);
          },
          { args: { ref }, extra },
        ),
    );
  }

  if (enabled("sessions_messages")) {
    server.registerTool(
      "sessions_messages",
      {
        title: "Read session messages",
        description:
          "Read a page of transcript messages. Defaults to the newest 20 messages.",
        inputSchema: {
          ref: z.string().describe("Session ref"),
          cursor: z.string().optional(),
          order: z.enum(["asc", "desc"]).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ ref, ...query }, extra) =>
        respond(
          "sessions_messages",
          async () => {
            return api.messages(ref, { ...query, limit: query.limit ?? 20 });
          },
          { args: { ref, ...query }, extra },
        ),
    );
  }

  if (enabled("handoff_propose")) {
    server.registerTool(
      "handoff_propose",
      {
        title: "Propose a cross-session handoff",
        description:
          "Use this to deliver a message to another session. It creates a pending card in the source session's chat; the owner reviews and approves it there. This tool never sends immediately. sessions_send is only available to a write-scoped token and is not required for a handoff.",
        inputSchema: {
          targetRef: z.string().describe("Target session ref"),
          message: z
            .string()
            .min(1)
            .max(8_000)
            .describe(
              "Exact instruction to send after approval; include context, evidence, and acceptance criteria",
            ),
          reason: z.string().max(500).optional(),
          evidence: z
            .string()
            .max(500)
            .optional()
            .describe(
              "Compact evidence reference: queue entry, log line, commit, or run ID",
            ),
          sourceRef: z
            .string()
            .optional()
            .describe("Source session ref; inferred from the caller when omitted"),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ targetRef, message, reason, evidence, sourceRef }, extra) => {
        const callerRef = await callerSourceRef(api, extra);
        const source = sourceRef ?? callerRef;
        if (!source) {
          return errorResult(
            "Could not resolve the caller session. Pass sourceRef with the source session ref.",
          );
        }
        const caller = callerSessionID(extra);
        return respond(
          "handoff_propose",
          async () =>
            api.proposeHandoff({
              targetRef,
              message,
              sourceRef: source,
              createdBy: "agent",
              createdByRef: callerRef ?? source,
              ...(reason ? { reason } : {}),
              ...(evidence ? { evidence } : {}),
              ...(caller ? { callerSessionId: caller } : {}),
            }),
          {
            args: { targetRef, message, reason, evidence, sourceRef: source },
            extra,
            target: targetRef,
          },
        );
      },
    );
  }

  if (enabled("attention_list")) {
    server.registerTool(
      "attention_list",
      {
        title: "List attention items",
        description:
          "List permissions, approvals, questions, unread sessions, and errors that need action.",
        inputSchema: {
          type: z
            .enum(["permission", "approval", "question", "unread", "error"])
            .optional(),
          sessionRef: z.string().optional(),
        },
        annotations: { readOnlyHint: true },
      },
      async (args, extra) =>
        respond(
          "attention_list",
          async () => {
            return api.attention(args);
          },
          { args, extra },
        ),
    );
  }

  if (enabled("questions_get")) {
    server.registerTool(
      "questions_get",
      {
        title: "Get pending question",
        description:
          "Read the pending question for a session, including choices and risk.",
        inputSchema: {
          ref: z.string().describe("Session ref"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ ref }, extra) =>
        respond(
          "questions_get",
          async () => {
            return { data: await api.question(ref) };
          },
          { args: { ref }, extra },
        ),
    );
  }

  if (enabled("sessions_send")) {
    server.registerTool(
      "sessions_send",
      {
        title: "Send a message",
        description:
          "Send a prompt or answer to a session. Use idempotencyKey for retries.",
        inputSchema: {
          ref: z.string().describe("Session ref"),
          text: z.string().min(1).describe("Prompt or answer summary"),
          answer: z
            .object({
              questionId: z.string(),
              messageId: z.string(),
              revision: z.string(),
              choiceId: z.string().optional(),
              source: z
                .enum(["choice", "boolean", "text", "voice", "suggestion"])
                .optional(),
            })
            .optional(),
          answers: z
            .array(
              z.object({
                questionId: z.string(),
                messageId: z.string(),
                revision: z.string(),
                choiceId: z.string().optional(),
                source: z
                  .enum(["choice", "boolean", "text", "voice", "suggestion"])
                  .optional(),
              }),
            )
            .min(1)
            .max(20)
            .optional(),
          idempotencyKey: z.string().optional(),
        },
        annotations: { destructiveHint: false },
      },
      async ({ ref, idempotencyKey, text, answer, answers }, extra) =>
        respond(
          "sessions_send",
          async () => {
            assertNotCaller(ref, extra);
            const input: SendInput = {
              text,
              ...(answer
                ? {
                    answer: {
                      ...answer,
                      source:
                        answer.source ?? (answer.choiceId ? "choice" : "text"),
                    },
                  }
                : {}),
              ...(answers
                ? {
                    answers: answers.map((item) => ({
                      ...item,
                      source: item.source ?? (item.choiceId ? "choice" : "text"),
                    })),
                  }
                : {}),
            };
            return api.sendMessage(ref, input, { idempotencyKey });
          },
          { args: { ref }, extra },
        ),
    );
  }

  if (enabled("sessions_create")) {
    server.registerTool(
      "sessions_create",
      {
        title: "Create a session",
        description:
          "Create a session on a provider. Pass text to send the first prompt after creation.",
        inputSchema: {
          providerID: z.string(),
          title: z.string().min(1),
          directory: z.string().optional(),
          agent: z.string().optional(),
          model: z.string().optional(),
          text: z.string().optional(),
        },
      },
      async (input, extra) =>
        respond(
          "sessions_create",
          async () => {
            return api.createSession(input);
          },
          { args: input, extra },
        ),
    );
  }

  if (enabled("sessions_interrupt")) {
    server.registerTool(
      "sessions_interrupt",
      {
        title: "Interrupt a session",
        description: "Stop the current run in a session.",
        inputSchema: {
          ref: z.string().describe("Session ref"),
        },
        annotations: { destructiveHint: true },
      },
      async ({ ref }, extra) =>
        respond(
          "sessions_interrupt",
          async () => {
            assertNotCaller(ref, extra);
            await api.interrupt(ref);
            return { ok: true };
          },
          { args: { ref }, extra },
        ),
    );
  }

  if (enabled("sessions_mark_read")) {
    server.registerTool(
      "sessions_mark_read",
      {
        title: "Mark a session read",
        description: "Clear the unread state for a session.",
        inputSchema: {
          ref: z.string().describe("Session ref"),
        },
        annotations: { readOnlyHint: false },
      },
      async ({ ref }, extra) =>
        respond(
          "sessions_mark_read",
          async () => {
            assertNotCaller(ref, extra);
            await api.markRead(ref);
            return { ok: true };
          },
          { args: { ref }, extra },
        ),
    );
  }

  if (enabled("attention_act")) {
    server.registerTool(
      "attention_act",
      {
        title: "Act on an attention item",
        description:
          "Run one of the actions listed on an attention item. Approval actions require confirm: true. Destructive or sensitive items always require confirm: true.",
        inputSchema: {
          attentionId: z.string(),
          action: z
            .string()
            .describe("Action ID from the attention item, for example allow_once or deny"),
          fields: z.record(z.string(), z.unknown()).optional(),
          payload: z.unknown().optional(),
          confirm: z
            .boolean()
            .optional()
            .describe("Required for approval actions and risky items"),
        },
        annotations: { destructiveHint: true },
      },
      async ({ attentionId, action, fields, payload, confirm }, extra) =>
        respond(
          "attention_act",
          async () => {
            const page = await api.attention();
            const item = page.data.find(
              (candidate) => candidate.id === attentionId,
            );
            if (!item) {
              throw new Error(`Attention item not found: ${attentionId}`);
            }
            assertNotCaller(item.sessionRef, extra);

            const risky =
              isDestructiveText(`${item.title} ${item.summary}`) ||
              isSensitiveText(`${item.title} ${item.summary}`);
            if ((isApprovalAction(action) || risky) && confirm !== true) {
              throw new Error(
                `Confirmation required to ${action} "${item.title}". ` +
                  "Inspect the session first, then call again with confirm: true.",
              );
            }

            await api.actOnAttention(attentionId, action, {
              ...(fields ? { fields } : {}),
              ...(payload === undefined ? {} : { payload }),
            });
            return { ok: true };
          },
          { args: { attentionId }, extra, target: attentionId },
        ),
    );
  }

  if (enabled("automation_list")) {
    server.registerTool(
      "automation_list",
      {
        title: "Read automation",
        description:
          "List watchers, start templates, dry-run/pause state, recent runs, and pending approvals.",
        inputSchema: {
          runs: z
            .number()
            .int()
            .min(0)
            .max(50)
            .optional()
            .describe("Recent runs to include (default 10)"),
          approvals: z
            .number()
            .int()
            .min(0)
            .max(50)
            .optional()
            .describe("Pending approvals to include (default 10)"),
          shapes: z
            .number()
            .int()
            .min(0)
            .max(100)
            .optional()
            .describe("Allowed shapes to include (default 20)"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ runs, approvals, shapes }, extra) =>
        respond(
          "automation_list",
          async () => {
            const view = await api.automation();
            return {
              data: {
                ...view,
                runs: view.runs.slice(0, runs ?? 10),
                approvals: view.approvals.slice(0, approvals ?? 10),
                allowedShapes: view.allowedShapes.slice(0, shapes ?? 20),
              },
            };
          },
          { args: { runs, approvals, shapes }, extra },
        ),
    );
  }

  if (enabled("approvals_list")) {
    server.registerTool(
      "approvals_list",
      {
        title: "List automation approvals",
        description: "List actions the automation policy escalated to a human.",
        inputSchema: {
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Approvals to return (default 20)"),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ limit }, extra) =>
        respond(
          "approvals_list",
          async () => ({
            data: (await api.approvals()).slice(0, limit ?? 20),
          }),
          { args: { limit }, extra },
        ),
    );
  }

  if (enabled("automation_pause")) {
    server.registerTool(
      "automation_pause",
      {
        title: "Pause or resume automation",
        description:
          "Pause the whole policy or one watcher. Paused watchers drop new work.",
        inputSchema: {
          paused: z.boolean(),
          watcher: z
            .string()
            .optional()
            .describe("Pause only this watcher ID"),
        },
        annotations: { destructiveHint: true },
      },
      async ({ paused, watcher }, extra) =>
        respond(
          "automation_pause",
          async () =>
            watcher
              ? api.setWatcherPaused(watcher, paused)
              : api.setAutomation({ paused }),
          { args: { watcher }, extra, target: watcher },
        ),
    );
  }

  if (enabled("approvals_act")) {
    server.registerTool(
      "approvals_act",
      {
        title: "Approve or deny an automation action",
        description:
          "Decide a pending automation approval. Approve executes the proposed answer when actionable; otherwise it records that a human handled it. Deny never sends.",
        inputSchema: {
          id: z.string().describe("Approval ID from approvals_list"),
          action: z.enum(["approve", "deny"]),
        },
        annotations: { destructiveHint: true },
      },
      async ({ id, action }, extra) =>
        respond(
          "approvals_act",
          async () => {
            await api.actOnApproval(id, action);
            return { ok: true };
          },
          { args: { id }, extra, target: id },
        ),
    );
  }

  return server;
}
