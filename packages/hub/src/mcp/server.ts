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
  CreateSessionInput,
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
]);

export const MCP_READ_TOOL_NAMES = [
  "providers_list",
  "providers_check",
  "sessions_list",
  "sessions_get",
  "sessions_messages",
  "attention_list",
  "questions_get",
] as const;

export const MCP_WRITE_TOOL_NAMES = [
  "sessions_send",
  "sessions_create",
  "sessions_interrupt",
  "sessions_mark_read",
  "attention_act",
] as const;

export const MCP_TOOL_NAMES = [
  ...MCP_READ_TOOL_NAMES,
  ...MCP_WRITE_TOOL_NAMES,
] as const;

export const MCP_ATTENTION_RESOURCE = "oktoso://attention";
export const MCP_SESSIONS_RESOURCE = "oktoso://sessions";

const INSTRUCTIONS = `Oktoso is a control plane for sessions across AI providers.

Read before acting. Start with attention_list, then sessions_messages for context.
Never act on the OpenCode session that invoked you; the server rejects it.
Only answer questions when the intent is clear. Deny destructive or sensitive
permission requests unless the user explicitly approved them.
Use a stable idempotencyKey for sessions_send so retries do not double-send.
Prefer mark_read or a reply over interrupt.`;

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

  server.server.setRequestHandler(
    SubscribeRequestSchema,
    async ({ params }) => {
      if (
        (params.uri === MCP_ATTENTION_RESOURCE && canReadAttention) ||
        (params.uri === MCP_SESSIONS_RESOURCE && canReadSessions)
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
        description: "Create a session on a provider.",
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

  return server;
}
