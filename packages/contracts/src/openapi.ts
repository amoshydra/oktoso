import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  zAgentOption,
  zAttention,
  zAttentionAction,
  zAttentionActionInput,
  zAttentionField,
  zAttentionPage,
  zAttentionPriority,
  zAttentionType,
  zAuthCheck,
  zCreateSessionInput,
  zCursor,
  zDiagnostics,
  zError,
  zHealth,
  zHubEvent,
  zMessage,
  zMessagePage,
  zMessagePart,
  zModelOption,
  zProvider,
  zProviderCapabilities,
  zProviderHealth,
  zProviderOptions,
  zSearchResult,
  zSendInput,
  zSendResult,
  zSession,
  zSessionPage,
  zAttentionSummary,
} from "./index";

const registry = new OpenAPIRegistry();

const ErrorSchema = registry.register("Error", zError);
const CursorSchema = registry.register("Cursor", zCursor);
const HealthSchema = registry.register("Health", zHealth);
const AuthCheckSchema = registry.register("AuthCheck", zAuthCheck);
const DiagnosticsSchema = registry.register("Diagnostics", zDiagnostics);
const ProviderCapabilitiesSchema = registry.register(
  "ProviderCapabilities",
  zProviderCapabilities,
);
const ProviderSchema = registry.register("Provider", zProvider);
const ProviderHealthSchema = registry.register("ProviderHealth", zProviderHealth);
const AgentOptionSchema = registry.register("AgentOption", zAgentOption);
const ModelOptionSchema = registry.register("ModelOption", zModelOption);
const ProviderOptionsSchema = registry.register(
  "ProviderOptions",
  zProviderOptions,
);
const SessionSchema = registry.register("Session", zSession);
const SessionPageSchema = registry.register("SessionPage", zSessionPage);
const CreateSessionInputSchema = registry.register(
  "CreateSessionInput",
  zCreateSessionInput,
);
const MessagePartSchema = registry.register("MessagePart", zMessagePart);
const MessageSchema = registry.register("Message", zMessage);
const MessagePageSchema = registry.register("MessagePage", zMessagePage);
const SendInputSchema = registry.register("SendInput", zSendInput);
const SendResultSchema = registry.register("SendResult", zSendResult);
const AttentionTypeSchema = registry.register("AttentionType", zAttentionType);
const AttentionPrioritySchema = registry.register(
  "AttentionPriority",
  zAttentionPriority,
);
const AttentionActionSchema = registry.register(
  "AttentionAction",
  zAttentionAction,
);
const AttentionFieldSchema = registry.register("AttentionField", zAttentionField);
const AttentionSchema = registry.register("Attention", zAttention);
const AttentionPageSchema = registry.register("AttentionPage", zAttentionPage);
const AttentionActionInputSchema = registry.register(
  "AttentionActionInput",
  zAttentionActionInput,
);
const AttentionSummarySchema = registry.register(
  "AttentionSummary",
  zAttentionSummary,
);
const HubEventSchema = registry.register("HubEvent", zHubEvent);
const SearchResultSchema = registry.register("SearchResult", zSearchResult);

const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const errorResponse = (description: string) => ({
  description,
  content: json(ErrorSchema),
});

const params = z.object({ ref: z.string() });
const providerParams = z.object({ providerID: z.string() });
const attentionParams = z.object({
  attentionID: z.string(),
  action: z.enum([
    "approve_once",
    "approve_always",
    "deny",
    "answer",
    "mark_read",
    "retry",
    "dismiss",
  ]),
});

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
});

registry.registerPath({
  method: "get",
  path: "/api/v1/health",
  tags: ["health"],
  summary: "Hub liveness",
  security: [],
  responses: {
    200: { description: "Hub is running", content: json(HealthSchema) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/auth/check",
  tags: ["auth"],
  summary: "Check the hub bearer token",
  responses: {
    200: { description: "Token accepted", content: json(AuthCheckSchema) },
    401: errorResponse("Missing or invalid hub token"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/providers",
  tags: ["providers"],
  summary: "List configured providers",
  responses: {
    200: {
      description: "Providers",
      content: json(z.object({ data: z.array(ProviderSchema) })),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/providers/{providerID}/check",
  tags: ["providers"],
  summary: "Check provider health",
  request: { params: providerParams },
  responses: {
    200: { description: "Health result", content: json(ProviderHealthSchema) },
    404: errorResponse("Provider not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/providers/{providerID}/options",
  tags: ["providers"],
  summary: "List provider creation options",
  request: { params: providerParams },
  responses: {
    200: { description: "Provider options", content: json(ProviderOptionsSchema) },
    404: errorResponse("Provider not found"),
    501: errorResponse("Provider does not expose options"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions",
  tags: ["sessions"],
  summary: "List sessions across providers",
  request: {
    query: z.object({
      provider: z.string().optional(),
      status: z.enum(["running", "idle", "error", "offline"]).optional(),
      q: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: { description: "Session page", content: json(SessionPageSchema) },
    400: errorResponse("Invalid query"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions",
  tags: ["sessions"],
  summary: "Create a session",
  request: { body: { content: json(CreateSessionInputSchema), required: true } },
  responses: {
    201: { description: "Session created", content: json(SessionSchema) },
    400: errorResponse("Invalid request"),
    409: errorResponse("Conflict"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}",
  tags: ["sessions"],
  summary: "Get one session",
  request: { params },
  responses: {
    200: { description: "Session", content: json(SessionSchema) },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/messages",
  tags: ["sessions"],
  summary: "List session messages",
  request: {
    params,
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      order: z.enum(["asc", "desc"]).optional(),
    }),
  },
  responses: {
    200: { description: "Message page", content: json(MessagePageSchema) },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/messages",
  tags: ["sessions"],
  summary: "Send a prompt",
  request: {
    params,
    headers: z.object({ "idempotency-key": z.string().optional() }),
    body: { content: json(SendInputSchema), required: true },
  },
  responses: {
    202: { description: "Prompt accepted", content: json(SendResultSchema) },
    404: errorResponse("Session not found"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/interrupt",
  tags: ["sessions"],
  summary: "Interrupt a running session",
  request: { params },
  responses: {
    204: { description: "Interrupted" },
    404: errorResponse("Session not found"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/read",
  tags: ["sessions"],
  summary: "Mark a session read",
  request: { params },
  responses: {
    204: { description: "Read marker updated" },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/attention",
  tags: ["attention"],
  summary: "List attention items",
  request: {
    query: z.object({
      type: AttentionTypeSchema.optional(),
      sessionRef: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Attention items", content: json(AttentionPageSchema) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/attention/{attentionID}/actions/{action}",
  tags: ["attention"],
  summary: "Act on an attention item",
  request: {
    params: attentionParams,
    body: { content: json(AttentionActionInputSchema), required: false },
  },
  responses: {
    204: { description: "Action accepted" },
    404: errorResponse("Attention item not found"),
    409: errorResponse("Conflict"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/events",
  tags: ["events"],
  summary: "Resumable server-sent event stream",
  request: {
    query: z.object({ after: z.coerce.number().int().min(0).optional() }),
  },
  responses: {
    200: {
      description: "Server-sent events",
      content: { "text/event-stream": { schema: z.string() } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/search",
  tags: ["search"],
  summary: "Search sessions",
  request: {
    query: z.object({
      q: z.string().min(1),
      scope: z.enum(["sessions", "messages", "all"]).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Search results",
      content: json(z.object({ data: z.array(SearchResultSchema), cursor: CursorSchema.optional() })),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/diagnostics",
  tags: ["diagnostics"],
  summary: "Authenticated hub diagnostics",
  responses: {
    200: { description: "Diagnostics", content: json(DiagnosticsSchema) },
  },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Agent Hub API",
      version: "0.2.0",
      description:
        "Hub API for sessions, messages, attention, provider options, diagnostics, and a resumable event stream.",
    },
    servers: [{ url: "http://127.0.0.1:8787", description: "Local hub" }],
    tags: [
      { name: "health" },
      { name: "auth" },
      { name: "providers" },
      { name: "sessions" },
      { name: "attention" },
      { name: "events" },
      { name: "search" },
      { name: "diagnostics" },
    ],
    security: [{ bearerAuth: [] }],
  });
}
