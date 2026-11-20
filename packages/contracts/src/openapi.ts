import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  zAgentOption,
  zAssistantInput,
  zAssistantView,
  zTranscriptCacheInput,
  zTranscriptCacheView,
  zAttention,
  zAttentionAction,
  zAttentionActionInput,
  zAttentionField,
  zAttentionPage,
  zAttentionPriority,
  zAttentionType,
  zAuthCheck,
  zAuthKind,
  zCreateSessionInput,
  zCursor,
  zDiagnostics,
  zDraft,
  zDraftInput,
  zDraftResponse,
  zError,
  zHealth,
  zHubEvent,
  zInboxDeliveryInput,
  zInboxItem,
  zInboxPage,
  zMessage,
  zMessagePage,
  zMessagePart,
  zModelOption,
  zModelVariant,
  zPairingCode,
  zPairingExchange,
  zPairingSession,
  zSessionRefresh,
  zSessionRenameInput,
  zProvider,
  zProviderCapabilities,
  zProviderInput,
  zProviderUpdateInput,
  zProviderHealth,
  zProviderOptions,
  zQuestionPrompt,
  zPendingQuestionSummary,
  zQuestionSummaryPage,
  zNotificationChannelKind,
  zNotificationChannelView,
  zNotificationDelivery,
  zNotificationDeliveryPage,
  zNotificationRouting,
  zNotificationSettings,
  zNotificationSettingsInput,
  zNotificationTestResult,
  zPushSubscription,
  zPushSubscriptionInput,
  zPushSubscriptionPage,
  zQuietHours,
  zReplyOptions,
  zReplyAudit,
  zReplyFeedbackInput,
  zReplyFeedbackEntry,
  zReplyFeedbackPage,
  zSearchResult,
  zSearchPage,
  zSessionLineage,
  zLocalDataView,
  zLocalRetentionInput,
  zSendInput,
  zSendResult,
  zSession,
  zSessionPage,
  zSessionSelectionInput,
  zAttentionSummary,
  zAutomationAction,
  zAutomationApproval,
  zAutomationApprovalAction,
  zAutomationApprovalPage,
  zAutomationCondition,
  zAutomationLimits,
  zAutomationRun,
  zAutomationRunPage,
  zAutomationSettingsInput,
  zAutomationShape,
  zAutomationTrigger,
  zAutomationView,
  zAutomationWatcher,
  zTranscriptionResult,
  zAttachment,
  zBranchPage,
  zBranchPoint,
  zBranchSwitchInput,
  zForkInput,
  zRetryInput,
} from "./index";

import {
  zAssistantAction,
  zAssistantActionDecision,
  zAssistantEvent,
  zAssistantMessageInput,
  zAssistantRun,
  zAssistantRunAccepted,
  zAssistantStatus,
  zAssistantThread,
  zAssistantThreadDetail,
  zAssistantThreadInput,
  zAssistantThreadPage,
  zAssistantTurn,
} from "./assistant";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

const ErrorSchema = registry.register("Error", zError);
const CursorSchema = registry.register("Cursor", zCursor);
const HealthSchema = registry.register("Health", zHealth);
const AuthKindSchema = registry.register("AuthKind", zAuthKind);
const AuthCheckSchema = registry.register("AuthCheck", zAuthCheck);
const PairingCodeSchema = registry.register("PairingCode", zPairingCode);
const PairingSessionSchema = registry.register("PairingSession", zPairingSession);
const PairingExchangeSchema = registry.register(
  "PairingExchange",
  zPairingExchange,
);
const SessionRefreshSchema = registry.register(
  "SessionRefresh",
  zSessionRefresh,
);
const DiagnosticsSchema = registry.register("Diagnostics", zDiagnostics);
const ProviderCapabilitiesSchema = registry.register(
  "ProviderCapabilities",
  zProviderCapabilities,
);
const ProviderSchema = registry.register("Provider", zProvider);
const ProviderInputSchema = registry.register("ProviderInput", zProviderInput);
const ProviderUpdateInputSchema = registry.register(
  "ProviderUpdateInput",
  zProviderUpdateInput,
);
const ProviderHealthSchema = registry.register("ProviderHealth", zProviderHealth);
const AgentOptionSchema = registry.register("AgentOption", zAgentOption);
const ModelVariantSchema = registry.register("ModelVariant", zModelVariant);
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
const SessionSelectionInputSchema = registry.register(
  "SessionSelectionInput",
  zSessionSelectionInput,
);
const SessionRenameInputSchema = registry.register(
  "SessionRenameInput",
  zSessionRenameInput,
);
const DraftSchema = registry.register("Draft", zDraft);
const DraftInputSchema = registry.register("DraftInput", zDraftInput);
const DraftResponseSchema = registry.register("DraftResponse", zDraftResponse);
const AssistantViewSchema = registry.register("AssistantView", zAssistantView);
const AssistantStatusSchema = registry.register(
  "AssistantStatus",
  zAssistantStatus,
);
const AssistantActionSchema = registry.register(
  "AssistantAction",
  zAssistantAction,
);
const AssistantActionDecisionSchema = registry.register(
  "AssistantActionDecision",
  zAssistantActionDecision,
);
const AssistantThreadSchema = registry.register(
  "AssistantThread",
  zAssistantThread,
);
const AssistantThreadPageSchema = registry.register(
  "AssistantThreadPage",
  zAssistantThreadPage,
);
const AssistantThreadDetailSchema = registry.register(
  "AssistantThreadDetail",
  zAssistantThreadDetail,
);
const AssistantThreadInputSchema = registry.register(
  "AssistantThreadInput",
  zAssistantThreadInput,
);
const AssistantMessageInputSchema = registry.register(
  "AssistantMessageInput",
  zAssistantMessageInput,
);
const AssistantRunSchema = registry.register("AssistantRun", zAssistantRun);
const AssistantRunAcceptedSchema = registry.register(
  "AssistantRunAccepted",
  zAssistantRunAccepted,
);
const AssistantEventSchema = registry.register(
  "AssistantEvent",
  zAssistantEvent,
);
const TranscriptCacheViewSchema = registry.register(
  "TranscriptCacheView",
  zTranscriptCacheView,
);
const TranscriptCacheInputSchema = registry.register(
  "TranscriptCacheInput",
  zTranscriptCacheInput,
);
const AssistantInputSchema = registry.register("AssistantInput", zAssistantInput);
const TranscriptionResultSchema = registry.register(
  "TranscriptionResult",
  zTranscriptionResult,
);
const AssistantModelsSchema = registry.register(
  "AssistantModels",
  z.object({
    data: z.object({
      data: z.array(z.string()),
      baseUrl: z.string(),
    }),
  }),
);
const ReplyOptionsSchema = registry.register("ReplyOptions", zReplyOptions);
const ReplyAuditSchema = registry.register("ReplyAudit", zReplyAudit);
const ReplyFeedbackInputSchema = registry.register(
  "ReplyFeedbackInput",
  zReplyFeedbackInput,
);
const ReplyFeedbackEntrySchema = registry.register(
  "ReplyFeedbackEntry",
  zReplyFeedbackEntry,
);
const ReplyFeedbackPageSchema = registry.register(
  "ReplyFeedbackPage",
  zReplyFeedbackPage,
);
const QuestionPromptSchema = registry.register(
  "QuestionPrompt",
  zQuestionPrompt,
);
const PendingQuestionSummarySchema = registry.register(
  "PendingQuestionSummary",
  zPendingQuestionSummary,
);
const QuestionSummaryPageSchema = registry.register(
  "QuestionSummaryPage",
  zQuestionSummaryPage,
);
const MessagePartSchema = registry.register("MessagePart", zMessagePart);
const MessageSchema = registry.register("Message", zMessage);
const MessagePageSchema = registry.register("MessagePage", zMessagePage);
const SendInputSchema = registry.register("SendInput", zSendInput);
const SendResultSchema = registry.register("SendResult", zSendResult);
const InboxItemSchema = registry.register("InboxItem", zInboxItem);
const InboxPageSchema = registry.register("InboxPage", zInboxPage);
const InboxDeliveryInputSchema = registry.register(
  "InboxDeliveryInput",
  zInboxDeliveryInput,
);
const AttachmentSchema = registry.register("Attachment", zAttachment);
const BranchPointSchema = registry.register("BranchPoint", zBranchPoint);
const BranchPageSchema = registry.register("BranchPage", zBranchPage);
const BranchSwitchInputSchema = registry.register(
  "BranchSwitchInput",
  zBranchSwitchInput,
);
const ForkInputSchema = registry.register("ForkInput", zForkInput);
const RetryInputSchema = registry.register("RetryInput", zRetryInput);
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
const SearchPageSchema = registry.register("SearchPage", zSearchPage);
const SessionLineageSchema = registry.register(
  "SessionLineage",
  zSessionLineage,
);
const LocalDataViewSchema = registry.register("LocalDataView", zLocalDataView);
const LocalRetentionInputSchema = registry.register(
  "LocalRetentionInput",
  zLocalRetentionInput,
);
const NotificationChannelKindSchema = registry.register(
  "NotificationChannelKind",
  zNotificationChannelKind,
);
const QuietHoursSchema = registry.register("QuietHours", zQuietHours);
const NotificationRoutingSchema = registry.register(
  "NotificationRouting",
  zNotificationRouting,
);
const NotificationChannelViewSchema = registry.register(
  "NotificationChannelView",
  zNotificationChannelView,
);
const PushSubscriptionInputSchema = registry.register(
  "PushSubscriptionInput",
  zPushSubscriptionInput,
);
const PushSubscriptionSchema = registry.register(
  "PushSubscription",
  zPushSubscription,
);
const PushSubscriptionPageSchema = registry.register(
  "PushSubscriptionPage",
  zPushSubscriptionPage,
);
const NotificationDeliverySchema = registry.register(
  "NotificationDelivery",
  zNotificationDelivery,
);
const NotificationDeliveryPageSchema = registry.register(
  "NotificationDeliveryPage",
  zNotificationDeliveryPage,
);
const NotificationTestResultSchema = registry.register(
  "NotificationTestResult",
  zNotificationTestResult,
);
const NotificationSettingsSchema = registry.register(
  "NotificationSettings",
  zNotificationSettings,
);
const NotificationSettingsInputSchema = registry.register(
  "NotificationSettingsInput",
  zNotificationSettingsInput,
);
const AutomationTriggerSchema = registry.register(
  "AutomationTrigger",
  zAutomationTrigger,
);
const AutomationConditionSchema = registry.register(
  "AutomationCondition",
  zAutomationCondition,
);
const AutomationActionSchema = registry.register(
  "AutomationAction",
  zAutomationAction,
);
const AutomationLimitsSchema = registry.register(
  "AutomationLimits",
  zAutomationLimits,
);
const AutomationWatcherSchema = registry.register(
  "AutomationWatcher",
  zAutomationWatcher,
);
const AutomationRunSchema = registry.register("AutomationRun", zAutomationRun);
const AutomationRunPageSchema = registry.register(
  "AutomationRunPage",
  zAutomationRunPage,
);
const AutomationApprovalSchema = registry.register(
  "AutomationApproval",
  zAutomationApproval,
);
const AutomationApprovalPageSchema = registry.register(
  "AutomationApprovalPage",
  zAutomationApprovalPage,
);
const AutomationShapeSchema = registry.register(
  "AutomationShape",
  zAutomationShape,
);
const AutomationViewSchema = registry.register(
  "AutomationView",
  zAutomationView,
);
const AutomationSettingsInputSchema = registry.register(
  "AutomationSettingsInput",
  zAutomationSettingsInput,
);
const AutomationApprovalActionSchema = registry.register(
  "AutomationApprovalAction",
  zAutomationApprovalAction,
);

const json = <T extends z.ZodType>(schema: T) => ({
  "application/json": { schema },
});

const errorResponse = (description: string) => ({
  description,
  content: json(ErrorSchema),
});

const params = z.object({ ref: z.string() });
const attachmentParams = z.object({ id: z.string() });
const providerParams = z.object({ providerID: z.string() });
const assistantTargetParams = z.object({
  target: z.enum(["reply", "transcription"]),
});
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
  summary: "Check the hub credential",
  description:
    "Accepts the owner bearer token, a paired session bearer token, or a paired session cookie.",
  responses: {
    200: { description: "Credential accepted", content: json(AuthCheckSchema) },
    401: errorResponse("Missing or invalid hub credential"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/pair",
  tags: ["auth"],
  summary: "Create a pairing code",
  description:
    "Create a short-lived, single-use code for a /pair/{code} pairing link. Requires the owner credential.",
  responses: {
    200: { description: "Pairing code", content: json(PairingCodeSchema) },
    401: errorResponse("Missing or invalid hub credential"),
    403: errorResponse("A session credential cannot create pairing codes"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/connect",
  tags: ["auth"],
  summary: "Redeem a pairing code",
  description:
    "Redeem a pairing code for a session token. This is the machine exchange; browser pairing uses the GET/POST /pair/{code} page so link previews cannot consume the code. Codes work once and expire after five minutes.",
  security: [],
  request: {
    body: {
      required: true,
      content: json(PairingExchangeSchema),
    },
  },
  responses: {
    200: { description: "Session token", content: json(PairingSessionSchema) },
    400: errorResponse("A JSON body with a pairing code is required"),
    401: errorResponse("Pairing link expired or already used"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/refresh",
  tags: ["auth"],
  summary: "Refresh a session token",
  description:
    "Issue a fresh 30-day session token for a valid paired session. The owner token never expires and is rejected here. Old stateless tokens remain valid until their original expiry.",
  responses: {
    200: { description: "Refreshed session", content: json(SessionRefreshSchema) },
    400: errorResponse("The owner token does not expire"),
    401: errorResponse("Missing or invalid hub credential"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/auth/signout",
  tags: ["auth"],
  summary: "Clear the session cookie",
  description:
    "Clears the paired browser cookie. Stateless session tokens remain valid until they expire or the owner token rotates.",
  security: [],
  responses: {
    204: { description: "Cookie cleared" },
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
  path: "/api/v1/providers",
  tags: ["providers"],
  summary: "Add a provider",
  description:
    "Adds a provider to the hub config, hot-loads its adapter, invalidates provider caches, and returns the provider with its latest health status. Credentials are write-only.",
  request: {
    body: { content: json(ProviderInputSchema), required: true },
  },
  responses: {
    201: {
      description: "Provider added",
      content: json(z.object({ data: ProviderSchema })),
    },
    400: errorResponse("Invalid provider input"),
    409: errorResponse("Provider ID already exists"),
    501: errorResponse("Provider management is not configured"),
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/providers/{providerID}",
  tags: ["providers"],
  summary: "Update a provider",
  description:
    "Updates a provider in the hub config and hot-loads its adapter. Omit the secret to keep the existing credential.",
  request: {
    params: providerParams,
    body: { content: json(ProviderUpdateInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Provider updated",
      content: json(z.object({ data: ProviderSchema })),
    },
    400: errorResponse("Invalid provider input"),
    404: errorResponse("Provider not found"),
    501: errorResponse("Provider management is not configured"),
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
      scope: z.enum(["all", "root"]).optional(),
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
    404: errorResponse("Provider not found"),
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
  method: "patch",
  path: "/api/v1/sessions/{ref}",
  tags: ["sessions"],
  summary: "Rename a session",
  request: {
    params,
    body: { content: json(SessionRenameInputSchema), required: true },
  },
  responses: {
    200: { description: "Renamed session", content: json(SessionSchema) },
    400: errorResponse("Invalid title"),
    404: errorResponse("Session not found"),
    501: errorResponse("Provider does not support renaming sessions"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/selection",
  tags: ["sessions"],
  summary: "Change the session model or agent",
  request: {
    params,
    body: {
      content: json(SessionSelectionInputSchema),
      required: true,
    },
  },
  responses: {
    200: { description: "Updated session", content: json(SessionSchema) },
    400: errorResponse("Invalid selection"),
    404: errorResponse("Session not found"),
    501: errorResponse("Provider does not support changing the selection"),
    502: errorResponse("Provider failure"),
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
    409: errorResponse("Question changed or already answered"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/inbox",
  tags: ["sessions"],
  summary: "List queued provider messages",
  request: { params },
  responses: {
    200: { description: "Queued messages", content: json(InboxPageSchema) },
    404: errorResponse("Session not found"),
    501: errorResponse("Provider does not expose an inbox"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/sessions/{ref}/inbox/{itemId}",
  tags: ["sessions"],
  summary: "Change the delivery mode of a queued message",
  request: {
    params: z.object({ ref: z.string(), itemId: z.string() }),
    body: { content: json(InboxDeliveryInputSchema), required: true },
  },
  responses: {
    204: { description: "Delivery updated" },
    400: errorResponse("Invalid delivery"),
    404: errorResponse("Session or queued message not found"),
    501: errorResponse("Provider cannot change queued delivery"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/sessions/{ref}/inbox/{itemId}",
  tags: ["sessions"],
  summary: "Cancel a queued message",
  request: { params: z.object({ ref: z.string(), itemId: z.string() }) },
  responses: {
    204: { description: "Queued message removed" },
    404: errorResponse("Session or queued message not found"),
    501: errorResponse("Provider cannot cancel queued messages"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/export",
  tags: ["sessions"],
  summary: "Export a session transcript",
  description:
    "Markdown or JSON download of one session and its transcript. Attachment files are listed, not embedded. The hub reads the transcript from the provider.",
  request: {
    params,
    query: z.object({ format: z.enum(["md", "json"]).optional() }),
  },
  responses: {
    200: { description: "Exported transcript" },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/settings/local-data",
  tags: ["settings"],
  summary: "Read local data counts and retention",
  responses: {
    200: {
      description: "Local data view",
      content: json(z.object({ data: LocalDataViewSchema })),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/settings/local-data",
  tags: ["settings"],
  summary: "Set per-store retention",
  description:
    "Retention is per store; `0` means never prune. Drafts default to never so unsent work is not deleted.",
  request: {
    body: { content: json(LocalRetentionInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Updated local data view",
      content: json(z.object({ data: LocalDataViewSchema })),
    },
    400: errorResponse("Invalid retention settings"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/settings/local-data",
  tags: ["settings"],
  summary: "Clear all local data",
  description:
    "Clears drafts, read markers, reply feedback, the transcript cache, and its search index. Providers are untouched.",
  responses: {
    200: {
      description: "Cleared local data view",
      content: json(z.object({ data: LocalDataViewSchema })),
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/settings/local-data/{store}",
  tags: ["settings"],
  summary: "Clear one local store",
  request: {
    params: z.object({ store: z.enum(["drafts", "markers", "feedback"]) }),
  },
  responses: {
    200: {
      description: "Cleared local data view",
      content: json(z.object({ data: LocalDataViewSchema })),
    },
    400: errorResponse("Unknown store"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/lineage",
  tags: ["sessions"],
  summary: "Resolve a session's family tree",
  description:
    "Walks parentRef to the root, then collects descendants. Cycles, depth, node count, and unknown ancestors all stop the walk; `truncated` reports a cap.",
  request: { params },
  responses: {
    200: {
      description: "Session lineage",
      content: json(z.object({ data: SessionLineageSchema })),
    },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/branches",
  tags: ["sessions"],
  summary: "List in-chat branch points",
  request: { params },
  responses: {
    200: { description: "Branch points", content: json(BranchPageSchema) },
    404: errorResponse("Session not found"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/branches",
  tags: ["sessions"],
  summary: "Switch an in-chat branch",
  request: {
    params,
    body: { content: json(BranchSwitchInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Branch switched",
      content: json(z.object({ accepted: z.boolean() })),
    },
    400: errorResponse("Invalid branch"),
    404: errorResponse("Session or branch not found"),
    501: errorResponse("Provider does not support branches"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/retry",
  tags: ["sessions"],
  summary: "Retry an assistant message as a new sibling",
  request: {
    params,
    body: { content: json(RetryInputSchema), required: true },
  },
  responses: {
    202: { description: "Retry accepted", content: json(SendResultSchema) },
    400: errorResponse("Invalid retry target"),
    404: errorResponse("Session or message not found"),
    501: errorResponse("Provider does not support retry"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/sessions/{ref}/fork",
  tags: ["sessions"],
  summary: "Fork a session",
  request: {
    params,
    body: { content: json(ForkInputSchema), required: false },
  },
  responses: {
    200: { description: "Forked session", content: json(SessionSchema) },
    400: errorResponse("Invalid fork input"),
    404: errorResponse("Session or message not found"),
    501: errorResponse("Provider does not support forking"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/attachments",
  tags: ["attachments"],
  summary: "Stage an attachment for a message",
  description:
    "Uploads one file to the hub. Staged attachments expire after one hour and are removed after a successful send.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.string().openapi({ format: "binary" }),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    201: { description: "Staged attachment", content: json(AttachmentSchema) },
    400: errorResponse("Invalid or unsupported attachment"),
    413: errorResponse("Attachment is too large"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/attachments/{id}",
  tags: ["attachments"],
  summary: "Delete a staged attachment",
  request: { params: attachmentParams },
  responses: {
    204: { description: "Deleted" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/files",
  tags: ["sessions"],
  summary: "Read a file from a session's working directory",
  description:
    "Resolves a path inside the session directory and returns the bytes. Relative paths and absolute paths inside that directory are both accepted; paths that escape it, Windows paths, and parent segments are rejected.",
  request: {
    params,
    query: z.object({
      path: z
        .string()
        .min(1)
        .openapi({ description: "Path relative to the session directory" }),
    }),
  },
  responses: {
    200: { description: "File bytes" },
    400: errorResponse("Invalid or escaping path"),
    404: errorResponse("Session or file not found"),
    501: errorResponse("Provider does not expose session files"),
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
  path: "/api/v1/sessions/{ref}/draft",
  tags: ["drafts"],
  summary: "Get the saved draft for a session",
  request: { params },
  responses: {
    200: { description: "Saved draft or null", content: json(DraftResponseSchema) },
    400: errorResponse("Invalid session reference"),
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/sessions/{ref}/draft",
  tags: ["drafts"],
  summary: "Save a draft for a session",
  request: {
    params,
    body: { content: json(DraftInputSchema), required: true },
  },
  responses: {
    200: { description: "Saved draft", content: json(DraftResponseSchema) },
    400: errorResponse("Invalid draft input"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/sessions/{ref}/draft",
  tags: ["drafts"],
  summary: "Delete the saved draft for a session",
  request: { params },
  responses: {
    204: { description: "Draft deleted" },
    400: errorResponse("Invalid session reference"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/settings/assistant",
  tags: ["settings"],
  summary: "Get assistant settings",
  responses: {
    200: { description: "Assistant settings", content: json(z.object({ data: AssistantViewSchema })) },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/settings/assistant",
  tags: ["settings"],
  summary: "Update assistant settings",
  request: {
    body: { content: json(AssistantInputSchema), required: true },
  },
  responses: {
    200: { description: "Updated assistant settings", content: json(z.object({ data: AssistantViewSchema })) },
    400: errorResponse("Invalid settings"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/settings/transcripts",
  tags: ["settings"],
  summary: "Read the transcript cache settings and size",
  responses: {
    200: {
      description: "Transcript cache settings and stats",
      content: json(z.object({ data: TranscriptCacheViewSchema })),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/settings/transcripts",
  tags: ["settings"],
  summary: "Update the opt-in transcript cache",
  description:
    "Turning the cache off deletes every stored transcript. The provider stays authoritative: cached copies never answer a transcript read.",
  request: {
    body: { content: json(TranscriptCacheInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Updated transcript cache settings",
      content: json(z.object({ data: TranscriptCacheViewSchema })),
    },
    400: errorResponse("Invalid transcript cache settings"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/settings/transcripts",
  tags: ["settings"],
  summary: "Delete every cached transcript",
  responses: {
    200: {
      description: "Transcript cache cleared",
      content: json(z.object({ data: TranscriptCacheViewSchema })),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/settings/assistant/{target}/models",
  tags: ["settings"],
  summary: "List models from an assistant endpoint",
  request: { params: assistantTargetParams },
  responses: {
    200: { description: "Available models", content: json(AssistantModelsSchema) },
    400: errorResponse("Endpoint unavailable or invalid target"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/transcribe",
  tags: ["transcription"],
  summary: "Transcribe recorded audio",
  description:
    "Accepts multipart audio and forwards it to the configured OpenAI-compatible transcription endpoint. Audio is not persisted by the hub.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            audio: z
              .string()
              .openapi({ format: "binary", description: "Recorded audio file" }),
            language: z.string().max(16).optional(),
            prompt: z.string().max(2_000).optional(),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Transcription result",
      content: json(z.object({ data: TranscriptionResultSchema })),
    },
    400: errorResponse("Invalid or unsupported audio"),
    409: errorResponse("Transcription is disabled or unconfigured"),
    413: errorResponse("Audio is too large"),
    502: errorResponse("Transcription endpoint failed"),
    504: errorResponse("Transcription timed out"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/reply-options",
  tags: ["replies"],
  summary: "List short reply options for a session",
  request: {
    params,
    query: z.object({
      mode: z.enum(["reply", "choices"]).optional(),
      surface: z.enum(["web", "g2"]).optional(),
    }),
  },
  responses: {
    200: { description: "Reply options", content: json(ReplyOptionsSchema) },
    404: errorResponse("Session not found"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/reply-audit",
  tags: ["replies"],
  summary: "Generate reply options with the prompt and context for review",
  description:
    "Bypasses the reply cache and returns the exact system prompt, transcript context, generated options, and raw model output. Intended for the reply audit page.",
  request: {
    params,
    query: z.object({
      mode: z.enum(["reply", "choices"]).optional(),
      surface: z.enum(["web", "g2"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Reply audit",
      content: json(ReplyAuditSchema),
    },
    404: errorResponse("Session not found"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/reply-feedback",
  tags: ["replies"],
  summary: "List saved reply feedback",
  request: {
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
  },
  responses: {
    200: {
      description: "Reply feedback entries, newest first",
      content: json(ReplyFeedbackPageSchema),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/reply-feedback",
  tags: ["replies"],
  summary: "Save feedback for a generated reply set",
  request: {
    body: {
      required: true,
      content: json(ReplyFeedbackInputSchema),
    },
  },
  responses: {
    201: {
      description: "Saved feedback",
      content: json(ReplyFeedbackEntrySchema),
    },
    400: errorResponse("Invalid feedback"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/reply-feedback/export",
  tags: ["replies"],
  summary: "Download all reply feedback as JSONL",
  responses: {
    200: {
      description: "Feedback JSONL",
      content: {
        "application/x-ndjson": { schema: z.string() },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/questions",
  tags: ["questions"],
  summary: "List pending question summaries for sessions",
  description:
    "Cheap discovery for the glass home and inbox. Returns at most ten summaries; provider failures and sessions without a pending question are omitted. Results are cached briefly.",
  request: {
    query: z.object({
      ref: z.array(z.string().min(1)).min(1).max(10),
    }),
  },
  responses: {
    200: {
      description: "Pending question summaries",
      content: json(QuestionSummaryPageSchema),
    },
    400: errorResponse("Invalid or too many session refs"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/sessions/{ref}/question",
  tags: ["questions"],
  summary: "Get the pending question in a session",
  description:
    "Returns the latest completed assistant question, detected from the transcript, or null when there is no pending question.",
  request: { params },
  responses: {
    200: {
      description: "Pending question or null",
      content: json(z.object({ data: QuestionPromptSchema.nullable() })),
    },
    404: errorResponse("Session not found"),
    502: errorResponse("Provider failure"),
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
  summary: "Search cached transcripts",
  description:
    "Ranks sessions and messages from the local transcript cache. Sessions dedupe by ref and keep their best message; the messages scope returns one row per matching message.",
  request: {
    query: z.object({
      q: z.string().min(1),
      scope: z.enum(["sessions", "messages", "all"]).optional(),
      provider: z.string().min(1).optional(),
      status: z.enum(["running", "idle", "error", "offline"]).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
  responses: {
    200: {
      description: "Search results",
      content: json(SearchPageSchema),
    },
    400: errorResponse("Invalid query or cursor"),
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

registry.registerPath({
  method: "get",
  path: "/api/v1/notifications",
  tags: ["notifications"],
  summary: "Read notification settings",
  responses: {
    200: {
      description: "Notification settings",
      content: json(z.object({ data: NotificationSettingsSchema })),
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/notifications",
  tags: ["notifications"],
  summary: "Update notification settings",
  request: {
    body: { content: json(NotificationSettingsInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Updated notification settings",
      content: json(z.object({ data: NotificationSettingsSchema })),
    },
    400: errorResponse("Invalid settings"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/notifications/subscriptions",
  tags: ["notifications"],
  summary: "List push subscriptions",
  responses: {
    200: {
      description: "Push subscriptions",
      content: json(PushSubscriptionPageSchema),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/notifications/subscriptions",
  tags: ["notifications"],
  summary: "Register a push subscription",
  request: {
    body: { content: json(PushSubscriptionInputSchema), required: true },
  },
  responses: {
    201: {
      description: "Registered subscription",
      content: json(z.object({ data: PushSubscriptionSchema })),
    },
    400: errorResponse("Invalid subscription"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/notifications/subscriptions/{id}",
  tags: ["notifications"],
  summary: "Remove a push subscription",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Subscription removed" },
    404: errorResponse("Subscription not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/notifications/deliveries",
  tags: ["notifications"],
  summary: "Read the recent delivery log",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Recent deliveries, newest first",
      content: json(NotificationDeliveryPageSchema),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/notifications/test",
  tags: ["notifications"],
  summary: "Send a test notification",
  responses: {
    200: {
      description: "Delivery result",
      content: json(z.object({ data: NotificationTestResultSchema })),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/automation",
  tags: ["automation"],
  summary: "Read automation watchers, templates, runs, and approvals",
  responses: {
    200: {
      description: "Automation view",
      content: json(z.object({ data: AutomationViewSchema })),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/automation/templates/{id}/start",
  tags: ["automation"],
  summary: "Start a configured template",
  description:
    "A human action: it ignores pause, dry run, budgets, and quiet hours, and records no automation run. Returns the session object directly, like `POST /api/v1/sessions`.",
  request: {
    params: z.object({ id: z.string().min(1) }),
  },
  responses: {
    201: { description: "Created session", content: json(SessionSchema) },
    404: errorResponse("Unknown template or provider"),
    501: errorResponse("Provider cannot create or send"),
    502: errorResponse("Provider failure"),
  },
});

registry.registerPath({
  method: "put",
  path: "/api/v1/automation",
  tags: ["automation"],
  summary: "Pause, resume, or toggle dry-run",
  request: {
    body: { content: json(AutomationSettingsInputSchema), required: true },
  },
  responses: {
    200: {
      description: "Updated automation view",
      content: json(z.object({ data: AutomationViewSchema })),
    },
    400: errorResponse("Invalid automation settings"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/automation/watchers/{id}/pause",
  tags: ["automation"],
  summary: "Pause or resume one watcher",
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: json(z.object({ paused: z.boolean() })),
      required: true,
    },
  },
  responses: {
    200: {
      description: "Updated automation view",
      content: json(z.object({ data: AutomationViewSchema })),
    },
    404: errorResponse("Watcher not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/automation/runs",
  tags: ["automation"],
  summary: "Read recent automation runs",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  },
  responses: {
    200: {
      description: "Automation runs, newest first",
      content: json(AutomationRunPageSchema),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/automation/approvals",
  tags: ["automation"],
  summary: "List pending approvals",
  responses: {
    200: {
      description: "Pending approvals",
      content: json(AutomationApprovalPageSchema),
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/automation/shapes/{id}",
  tags: ["automation"],
  summary: "Revoke a remembered automation shape",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Allowed shape revoked" },
    404: errorResponse("Allowed shape not found"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/automation/approvals/{id}/{action}",
  tags: ["automation"],
  summary: "Approve or deny a queued automation action",
  request: {
    params: z.object({
      id: z.string(),
      action: AutomationApprovalActionSchema,
    }),
  },
  responses: {
    204: { description: "Approval decided" },
    404: errorResponse("Approval not found"),
    409: errorResponse("Approval expired, already decided, or the question changed"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistant/status",
  tags: ["assistant"],
  summary: "Hub assistant availability",
  description:
    "Reports whether the assistant has a model configured. M1 is read-only and session-scoped.",
  responses: {
    200: { description: "Assistant status", content: json(AssistantStatusSchema) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistant/threads",
  tags: ["assistant"],
  summary: "Open the session assistant thread",
  description:
    "Returns the existing thread for this scope or creates one. M1 supports the session scope only.",
  request: {
    body: { required: true, content: json(AssistantThreadInputSchema) },
  },
  responses: {
    201: { description: "Thread", content: json(AssistantThreadSchema) },
    400: errorResponse("Invalid scope"),
    409: errorResponse("The assistant is not configured"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistant/threads",
  tags: ["assistant"],
  summary: "List assistant threads",
  request: {
    query: z.object({ sessionRef: z.string().optional() }),
  },
  responses: {
    200: { description: "Threads", content: json(AssistantThreadPageSchema) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistant/threads/{id}",
  tags: ["assistant"],
  summary: "Read a thread with its turns",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Thread detail", content: json(AssistantThreadDetailSchema) },
    404: errorResponse("Thread not found"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/assistant/threads/{id}",
  tags: ["assistant"],
  summary: "Delete a thread",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: "Thread deleted" },
    404: errorResponse("Thread not found"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistant/threads/{id}/messages",
  tags: ["assistant"],
  summary: "Ask a question",
  description:
    "Appends the user turn and starts one read-only answer. The run streams on /api/v1/assistant/runs/{id}/events.",
  request: {
    params: z.object({ id: z.string() }),
    body: { required: true, content: json(AssistantMessageInputSchema) },
  },
  responses: {
    202: { description: "Run accepted", content: json(AssistantRunAcceptedSchema) },
    400: errorResponse("Invalid message"),
    404: errorResponse("Thread not found"),
    409: errorResponse("A run is already in flight for this thread"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistant/threads/{id}/turns/{turnId}/action",
  tags: ["assistant"],
  summary: "Confirm or cancel a proposed action",
  description:
    "The only path that writes to a provider. `confirm` sends, answers, or interrupts; `cancel` records the decision and does nothing. Write actions are disabled unless assistant.allowWrite is on.",
  request: {
    params: z.object({ id: z.string(), turnId: z.string() }),
    body: { required: true, content: json(AssistantActionDecisionSchema) },
  },
  responses: {
    200: { description: "Updated turn", content: json(zAssistantTurn) },
    400: errorResponse("Invalid decision"),
    404: errorResponse("Turn or action not found"),
    409: errorResponse("Writes are disabled or the action was already decided"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistant/runs/{id}/stop",
  tags: ["assistant"],
  summary: "Stop an answer",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: "Run state", content: json(AssistantRunSchema) },
    404: errorResponse("Run not found"),
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistant/runs/{id}/events",
  tags: ["assistant"],
  summary: "Follow an answer",
  description:
    "Server-sent events: delta frames carry text, and exactly one done or error frame ends the stream. Replay with ?since=<index>.",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      since: z.coerce.number().int().min(0).optional(),
    }),
  },
  responses: {
    200: {
      description: "Assistant run events",
      content: { "text/event-stream": { schema: AssistantEventSchema } },
    },
    404: errorResponse("Run not found"),
  },
});

export function buildOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Oktoso API",
      version: "0.2.0",
      description:
        "Hub API for sessions, drafts, messages, attention, provider options, diagnostics, and a resumable event stream.",
    },
    servers: [{ url: "http://127.0.0.1:8787", description: "Local hub" }],
    tags: [
      { name: "health" },
      { name: "auth" },
      { name: "providers" },
      { name: "sessions" },
      { name: "attachments" },
      { name: "drafts" },
      { name: "questions" },
      { name: "attention" },
      { name: "replies" },
      { name: "settings" },
      { name: "transcription" },
      { name: "events" },
      { name: "search" },
      { name: "notifications" },
      { name: "automation" },
      { name: "assistant" },
      { name: "diagnostics" },
    ],
    security: [{ bearerAuth: [] }],
  });
}
