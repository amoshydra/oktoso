import type {
  AttentionPage,
  AttentionType,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import type { McpHubApi } from "./server";

function providerOf(ref: string): string {
  const index = ref.indexOf(":");
  return index > 0 ? ref.slice(0, index) : ref;
}

/**
 * Restrict an MCP API surface to a set of provider IDs. An undefined or empty
 * allowlist means every provider is allowed.
 */
export function withProviderPolicy(
  api: McpHubApi,
  providers?: string[],
): McpHubApi {
  const allowed = new Set(providers ?? []);
  if (allowed.size === 0) return api;

  const assert = (ref: string): void => {
    if (!allowed.has(providerOf(ref))) {
      throw new Error(`Provider access is not allowed for this token: ${providerOf(ref)}`);
    }
  };

  return {
    async providers() {
      return (await api.providers()).filter((provider) =>
        allowed.has(provider.id),
      );
    },
    async checkProvider(id) {
      if (!allowed.has(id)) {
        throw new Error(`Provider access is not allowed for this token: ${id}`);
      }
      return api.checkProvider(id);
    },
    async sessions(query = {}) {
      const scoped =
        allowed.size === 1
          ? { ...query, provider: [...allowed][0]! }
          : query;
      const page = await api.sessions(scoped);
      return filterSessions(page, allowed);
    },
    async session(ref) {
      assert(ref);
      return api.session(ref);
    },
    async messages(ref, query) {
      assert(ref);
      return api.messages(ref, query);
    },
    async question(ref) {
      assert(ref);
      return api.question(ref);
    },
    async attention(query?: { type?: AttentionType; sessionRef?: string }) {
      if (query?.sessionRef) assert(query.sessionRef);
      const page = await api.attention(query);
      return filterAttention(page, allowed);
    },
    async sendMessage(ref, input, options) {
      assert(ref);
      return api.sendMessage(ref, input, options);
    },
    async createSession(input) {
      if (!allowed.has(input.providerID)) {
        throw new Error(
          `Provider access is not allowed for this token: ${input.providerID}`,
        );
      }
      return api.createSession(input);
    },
    async interrupt(ref) {
      assert(ref);
      return api.interrupt(ref);
    },
    async markRead(ref) {
      assert(ref);
      return api.markRead(ref);
    },
    async actOnAttention(id, action, input) {
      const page = await api.attention();
      const item = page.data.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Attention item not found: ${id}`);
      assert(item.sessionRef);
      return api.actOnAttention(id, action, input);
    },
    async automation() {
      const view = await api.automation();
      const watchers = view.watchers.filter((watcher) => {
        const providerID = watcher.condition?.providerID;
        return !providerID || allowed.has(providerID);
      });
      const visibleWatchers = new Set(watchers.map((watcher) => watcher.id));
      return {
        ...view,
        watchers,
        pausedWatchers: view.pausedWatchers.filter((id) =>
          visibleWatchers.has(id),
        ),
        runs: view.runs.filter(
          (run) => !run.sessionRef || allowed.has(providerOf(run.sessionRef)),
        ),
        approvals: view.approvals.filter((approval) =>
          allowed.has(providerOf(approval.sessionRef)),
        ),
        allowedShapes: view.allowedShapes.filter((shape) =>
          visibleWatchers.has(shape.watcherID),
        ),
        templates: view.templates.filter((template) =>
          allowed.has(template.providerID),
        ),
      };
    },
    async automationRuns(limit) {
      return (await api.automationRuns(limit)).filter(
        (run) => !run.sessionRef || allowed.has(providerOf(run.sessionRef)),
      );
    },
    async approvals() {
      return (await api.approvals()).filter((approval) =>
        allowed.has(providerOf(approval.sessionRef)),
      );
    },
    async setAutomation(input) {
      return api.setAutomation(input);
    },
    async setWatcherPaused(id, paused) {
      return api.setWatcherPaused(id, paused);
    },
    async actOnApproval(id, action) {
      const approval = (await api.approvals()).find((item) => item.id === id);
      if (!approval) throw new Error(`Approval not found: ${id}`);
      assert(approval.sessionRef);
      return api.actOnApproval(id, action);
    },
  };
}

export function withSessionPolicy(
  api: McpHubApi,
  sessionRef?: string,
): McpHubApi {
  if (!sessionRef) return api;
  const assert = (ref: string): void => {
    if (ref !== sessionRef) {
      throw new Error(`Session access is not allowed for this token: ${ref}`);
    }
  };
  return {
    providers: () => api.providers(),
    checkProvider: (id) => api.checkProvider(id),
    async sessions(query = {}) {
      const page = await api.sessions(query);
      return { ...page, data: page.data.filter((session) => session.ref === sessionRef) };
    },
    session: (ref) => {
      assert(ref);
      return api.session(ref);
    },
    messages: (ref, query) => {
      assert(ref);
      return api.messages(ref, query);
    },
    question: (ref) => {
      assert(ref);
      return api.question(ref);
    },
    async attention(query = {}) {
      const page = await api.attention({ ...query, sessionRef });
      return {
        ...page,
        data: page.data.filter((item) => item.sessionRef === sessionRef),
      };
    },
    sendMessage: (ref, input, options) => {
      assert(ref);
      return api.sendMessage(ref, input, options);
    },
    createSession: async () => {
      throw new Error("A session-scoped token cannot create sessions");
    },
    interrupt: (ref) => {
      assert(ref);
      return api.interrupt(ref);
    },
    markRead: (ref) => {
      assert(ref);
      return api.markRead(ref);
    },
    async actOnAttention(id, action, input) {
      const page = await api.attention({ sessionRef });
      const item = page.data.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Attention item not found: ${id}`);
      assert(item.sessionRef);
      return api.actOnAttention(id, action, input);
    },
    automation: async () => {
      throw new Error("A session-scoped token cannot read automation");
    },
    automationRuns: async () => {
      throw new Error("A session-scoped token cannot read automation");
    },
    approvals: async () =>
      (await api.approvals()).filter(
        (approval) => approval.sessionRef === sessionRef,
      ),
    setAutomation: async () => {
      throw new Error("A session-scoped token cannot change automation");
    },
    setWatcherPaused: async () => {
      throw new Error("A session-scoped token cannot change automation");
    },
    async actOnApproval(id, action) {
      const approval = (await api.approvals()).find((item) => item.id === id);
      if (!approval) throw new Error(`Approval not found: ${id}`);
      assert(approval.sessionRef);
      return api.actOnApproval(id, action);
    },
  };
}

function filterSessions(
  page: SessionPage,
  allowed: Set<string>,
): SessionPage {
  const data = page.data.filter((session) => allowed.has(session.providerID));
  return { ...page, data };
}

function filterAttention(
  page: AttentionPage,
  allowed: Set<string>,
): AttentionPage {
  const data = page.data.filter((item) =>
    allowed.has(providerOf(item.sessionRef)),
  );
  return { ...page, data };
}
