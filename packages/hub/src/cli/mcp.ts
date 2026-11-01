import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type {
  AttentionActionInput,
  AttentionPage,
  AttentionType,
  CreateSessionInput,
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

export interface OktosoMcpOptions {
  api: McpHubApi;
  version: string;
  allowWrite?: boolean;
}

interface ToolExtra {
  _meta?: Record<string, unknown>;
}

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

export function createOktosoMcpServer(options: OktosoMcpOptions): McpServer {
  const { api } = options;
  const server = new McpServer(
    { name: "oktoso", version: options.version },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "providers_list",
    {
      title: "List providers",
      description: "List configured providers with their connection status.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      respond(async () => {
        return { data: await api.providers() };
      }),
  );

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
    async ({ id }) =>
      respond(async () => {
        return api.checkProvider(id);
      }),
  );

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
    async (args) =>
      respond(async () => {
        return api.sessions({ ...args, limit: args.limit ?? 20 });
      }),
  );

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
    async ({ ref }) =>
      respond(async () => {
        return api.session(ref);
      }),
  );

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
    async ({ ref, ...query }) =>
      respond(async () => {
        return api.messages(ref, { ...query, limit: query.limit ?? 20 });
      }),
  );

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
    async (args) =>
      respond(async () => {
        return api.attention(args);
      }),
  );

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
    async ({ ref }) =>
      respond(async () => {
        return { data: await api.question(ref) };
      }),
  );

  if (options.allowWrite) {
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
        respond(async () => {
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
        }),
    );

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
      async (input) =>
        respond(async () => {
          return api.createSession(input);
        }),
    );

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
        respond(async () => {
          assertNotCaller(ref, extra);
          await api.interrupt(ref);
          return { ok: true };
        }),
    );

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
        respond(async () => {
          assertNotCaller(ref, extra);
          await api.markRead(ref);
          return { ok: true };
        }),
    );

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
        respond(async () => {
          const page = await api.attention();
          const item = page.data.find((candidate) => candidate.id === attentionId);
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
        }),
    );
  }

  return server;
}

async function respond(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return textResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}
