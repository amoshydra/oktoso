import type { AttentionService } from "../services/attention-service";
import type { AutomationService } from "../services/automation-service";
import type { ProviderRegistry } from "../services/provider-registry";
import type { QuestionService } from "../services/question-service";
import type { SessionActions } from "../services/session-actions";
import type { SessionService } from "../services/session-service";
import type { McpHubApi } from "./server";

export interface ServiceMcpApiDependencies {
  registry: ProviderRegistry;
  sessions: SessionService;
  questions: QuestionService;
  attention: AttentionService;
  actions: SessionActions;
  automation?: AutomationService;
}

/** Adapt the hub's in-process services to the MCP tool surface. */
export function createServiceMcpApi(
  deps: ServiceMcpApiDependencies,
): McpHubApi {
  const automation = () => {
    if (!deps.automation) throw new Error("Automation is not available");
    return deps.automation;
  };

  return {
    providers: async () => deps.registry.list(),
    checkProvider: async (id) => deps.registry.check(id),
    sessions: async (query) => deps.sessions.list(query ?? {}),
    session: async (ref) => deps.sessions.get(ref),
    messages: async (ref, query) => deps.sessions.messages(ref, query ?? {}),
    question: async (ref) => deps.questions.get(ref),
    attention: async (query) => deps.attention.list(query ?? {}),
    sendMessage: async (ref, input, options) =>
      deps.actions.send(ref, input, options?.idempotencyKey),
    createSession: async (input) => deps.sessions.create(input),
    interrupt: async (ref) => deps.sessions.interrupt(ref),
    markRead: async (ref) => deps.sessions.markRead(ref),
    actOnAttention: async (id, action, input) =>
      deps.attention.act(id, action, input ?? {}),
    automation: async () => automation().view(),
    automationRuns: async (limit) => automation().runs(limit),
    approvals: async () => automation().approvals(),
    setAutomation: async (input) => automation().updateSettings(input),
    setWatcherPaused: async (id, paused) =>
      automation().setWatcherPaused(id, paused),
    actOnApproval: async (id, action) => automation().actOnApproval(id, action),
  };
}
