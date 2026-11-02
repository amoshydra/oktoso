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
