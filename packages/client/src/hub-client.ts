import type {
  AssistantInput,
  AssistantView,
  AttentionActionInput,
  AttentionPage,
  AttentionType,
  AuthCheck,
  ProviderHealth,
  Diagnostics,
  ErrorResponse,
  CreateSessionInput,
  Draft,
  Health,
  MessagePage,
  MessagesQuery,
  PairingCode,
  PairingSession,
  SessionRefresh,
  Provider,
  ProviderOptions,
  QuestionPrompt,
  ReplyMode,
  ReplyOptions,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
} from "@agent-hub/contracts";
import { HubError } from "./errors";
import {
  runEventStream,
  type ConnectionStatus,
} from "./event-stream";

export interface HubClientOptions {
  baseUrl?: string;
  token?: string;
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export class HubClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly credentials: RequestCredentials;
  private token: string | undefined;

  constructor(options: HubClientOptions) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.token = options.token?.trim() || undefined;
    this.credentials = options.credentials ?? "same-origin";
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  setToken(token: string | undefined): void {
    this.token = token?.trim() || undefined;
  }

  async health(): Promise<Health> {
    return this.request<Health>("/api/v1/health", { auth: false });
  }

  async authCheck(): Promise<AuthCheck> {
    return this.request<AuthCheck>("/api/v1/auth/check");
  }

  async pair(): Promise<PairingCode> {
    return this.request<PairingCode>("/api/v1/auth/pair", { method: "POST" });
  }

  async connect(code: string): Promise<PairingSession> {
    return this.request<PairingSession>("/api/v1/auth/connect", {
      method: "POST",
      body: { code },
    });
  }

  async refresh(): Promise<SessionRefresh> {
    return this.request<SessionRefresh>("/api/v1/auth/refresh", {
      method: "POST",
    });
  }

  async signOut(): Promise<void> {
    await this.request<void>("/api/v1/auth/signout", {
      method: "POST",
      auth: false,
      keepalive: true,
    });
  }

  async providers(): Promise<Provider[]> {
    const response = await this.request<{ data: Provider[] }>("/api/v1/providers");
    return response.data;
  }

  async diagnostics(): Promise<Diagnostics> {
    return this.request<Diagnostics>("/api/v1/diagnostics");
  }

  async checkProvider(id: string): Promise<ProviderHealth> {
    return this.request<ProviderHealth>(
      `/api/v1/providers/${encodeURIComponent(id)}/check`,
      { method: "POST" },
    );
  }

  async sessions(query: SessionListQuery = {}): Promise<SessionPage> {
    const params = new URLSearchParams();
    if (query.provider) params.set("provider", query.provider);
    if (query.status) params.set("status", query.status);
    if (query.q) params.set("q", query.q);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<SessionPage>(`/api/v1/sessions${suffix}`);
  }

  async session(ref: string): Promise<Session> {
    return this.request<Session>(`/api/v1/sessions/${encodeURIComponent(ref)}`);
  }

  async messages(ref: string, query: MessagesQuery = {}): Promise<MessagePage> {
    const params = new URLSearchParams();
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.order) params.set("order", query.order);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<MessagePage>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/messages${suffix}`,
    );
  }

  async question(ref: string): Promise<QuestionPrompt | null> {
    const response = await this.request<{ data: QuestionPrompt | null }>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/question`,
    );
    return response.data;
  }

  async markRead(ref: string): Promise<void> {
    await this.request<void>(`/api/v1/sessions/${encodeURIComponent(ref)}/read`, {
      method: "POST",
    });
  }

  async draft(ref: string): Promise<Draft | null> {
    const response = await this.request<{ data: Draft | null }>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/draft`,
    );
    return response.data;
  }

  async saveDraft(ref: string, text: string): Promise<Draft> {
    const response = await this.request<{ data: Draft }>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/draft`,
      { method: "PUT", body: { text } },
    );
    return response.data;
  }

  async deleteDraft(ref: string): Promise<void> {
    await this.request<void>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/draft`,
      { method: "DELETE" },
    );
  }

  async sendMessage(ref: string, input: SendInput): Promise<SendResult> {
    return this.request<SendResult>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/messages`,
      { method: "POST", body: input },
    );
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    return this.request<Session>("/api/v1/sessions", {
      method: "POST",
      body: input,
    });
  }

  async interrupt(ref: string): Promise<void> {
    await this.request<void>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/interrupt`,
      { method: "POST" },
    );
  }

  async options(providerID: string): Promise<ProviderOptions> {
    return this.request<ProviderOptions>(
      `/api/v1/providers/${encodeURIComponent(providerID)}/options`,
    );
  }

  async assistantSettings(): Promise<AssistantView> {
    const response = await this.request<{ data: AssistantView }>(
      "/api/v1/settings/assistant",
    );
    return response.data;
  }

  async saveAssistantSettings(input: AssistantInput): Promise<AssistantView> {
    const response = await this.request<{ data: AssistantView }>(
      "/api/v1/settings/assistant",
      { method: "PUT", body: input },
    );
    return response.data;
  }

  async assistantModels(
    target: "reply" | "transcription",
  ): Promise<{ data: string[]; baseUrl: string }> {
    const response = await this.request<{
      data: { data: string[]; baseUrl: string };
    }>(`/api/v1/settings/assistant/${target}/models`);
    return response.data;
  }

  async replyOptions(ref: string, mode: ReplyMode = "reply"): Promise<ReplyOptions> {
    return this.request<ReplyOptions>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/reply-options?mode=${mode}`,
    );
  }

  async attention(query: { type?: AttentionType; sessionRef?: string } = {}): Promise<AttentionPage> {
    const params = new URLSearchParams();
    if (query.type) params.set("type", query.type);
    if (query.sessionRef) params.set("sessionRef", query.sessionRef);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request<AttentionPage>(`/api/v1/attention${suffix}`);
  }

  async actOnAttention(
    id: string,
    action: string,
    input: AttentionActionInput = {},
  ): Promise<void> {
    await this.request<void>(
      `/api/v1/attention/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`,
      { method: "POST", body: input },
    );
  }

  startEvents(options: {
    after?: number;
    signal: AbortSignal;
    onEvent: Parameters<typeof runEventStream>[0]["onEvent"];
    onStatus?: (status: ConnectionStatus) => void;
  }): Promise<void> {
    return runEventStream({
      baseUrl: this.baseUrl,
      token: this.token,
      credentials: this.credentials,
      after: options.after,
      signal: options.signal,
      onEvent: options.onEvent,
      onStatus: options.onStatus,
      fetchImpl: this.fetchImpl,
    });
  }

  private async request<T>(
    path: string,
    options: {
      auth?: boolean;
      method?: string;
      body?: unknown;
      keepalive?: boolean;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.auth !== false && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
        credentials: this.credentials,
        keepalive: options.keepalive,
        method: options.method ?? "GET",
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      throw new HubError("network_error", "Unable to reach the hub", {
        retryable: true,
        cause: error,
      });
    }

    if (!response.ok) {
      let payload: ErrorResponse | undefined;
      try {
        payload = (await response.json()) as ErrorResponse;
      } catch {
        payload = undefined;
      }
      throw new HubError(
        payload?.error.code ?? "http_error",
        payload?.error.message ?? `Hub returned HTTP ${response.status}`,
        {
          status: response.status,
          retryable: payload?.error.retryable ?? response.status >= 500,
          requestId: payload?.error.requestId,
          details: payload?.error.details,
        },
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

