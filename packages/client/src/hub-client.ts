import type {
  AssistantInput,
  AssistantView,
  Attachment,
  AttentionActionInput,
  AttentionPage,
  AttentionType,
  AuthCheck,
  BranchPoint,
  ForkInput,
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
  ProviderInput,
  ProviderOptions,
  ProviderUpdateInput,
  QuestionPrompt,
  QuestionSummaryPage,
  ReplyMode,
  ReplyAudit,
  ReplyFeedbackEntry,
  ReplyFeedbackInput,
  ReplyFeedbackPage,
  ReplyOptions,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
  SessionSelectionInput,
  TranscriptionResult,
} from "@amoshydra/oktoso-contracts";
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

  async addProvider(input: ProviderInput): Promise<Provider> {
    const response = await this.request<{ data: Provider }>("/api/v1/providers", {
      method: "POST",
      body: input,
    });
    return response.data;
  }

  async updateProvider(
    id: string,
    input: ProviderUpdateInput,
  ): Promise<Provider> {
    const response = await this.request<{ data: Provider }>(
      `/api/v1/providers/${encodeURIComponent(id)}`,
      { method: "PUT", body: input },
    );
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
    if (query.scope) params.set("scope", query.scope);
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

  async attachment(providerID: string, url: string): Promise<Blob> {
    const params = new URLSearchParams({ provider: providerID, url });
    return this.blob(`/api/v1/attachments?${params.toString()}`);
  }

  /**
   * Read a file from a session's working directory.
   *
   * The hub jails the path and asks the provider, so the browser never needs
   * the provider address or credentials.
   */
  async sessionFile(ref: string, path: string): Promise<Blob> {
    const params = new URLSearchParams({ path });
    return this.blob(
      `/api/v1/sessions/${encodeURIComponent(ref)}/files?${params.toString()}`,
    );
  }

  private async blob(suffix: string): Promise<Blob> {
    const headers: Record<string, string> = { Accept: "*/*" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${suffix}`, {
        headers,
        credentials: this.credentials,
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

    return response.blob();
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

  async questionSummaries(refs: string[]): Promise<QuestionSummaryPage> {
    const params = new URLSearchParams();
    for (const ref of refs) params.append("ref", ref);
    return this.request<QuestionSummaryPage>(
      `/api/v1/questions?${params.toString()}`,
    );
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

  async sendMessage(
    ref: string,
    input: SendInput,
    options: { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<SendResult> {
    return this.request<SendResult>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/messages`,
      {
        method: "POST",
        body: input,
        signal: options.signal,
        ...(options.idempotencyKey
          ? { headers: { "Idempotency-Key": options.idempotencyKey } }
          : {}),
      },
    );
  }

  async setSessionSelection(
    ref: string,
    input: SessionSelectionInput,
  ): Promise<Session> {
    return this.request<Session>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/selection`,
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

  async transcribe(
    audio: Blob,
    options: {
      filename?: string;
      language?: string;
      prompt?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set(
      "audio",
      audio,
      options.filename ?? `audio.${audioExtension(audio.type)}`,
    );
    if (options.language) form.set("language", options.language);
    if (options.prompt) form.set("prompt", options.prompt);
    const payload = await this.requestForm<{ data: TranscriptionResult }>(
      "/api/v1/transcribe",
      form,
      options.signal,
    );
    return payload.data;
  }

  async uploadAttachment(
    file: File,
    options: { signal?: AbortSignal } = {},
  ): Promise<Attachment> {
    const form = new FormData();
    form.set("file", file, file.name);
    const payload = await this.requestForm<{ data: Attachment }>(
      "/api/v1/attachments",
      form,
      options.signal,
    );
    return payload.data;
  }

  async deleteAttachment(id: string): Promise<void> {
    await this.request<void>(
      `/api/v1/attachments/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  async branches(ref: string): Promise<BranchPoint[]> {
    const response = await this.request<{ data: BranchPoint[] }>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/branches`,
    );
    return response.data;
  }

  async switchBranch(ref: string, siblingId: string): Promise<void> {
    await this.request<void>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/branches`,
      { method: "POST", body: { siblingId } },
    );
  }

  async retryMessage(ref: string, messageId: string): Promise<SendResult> {
    return this.request<SendResult>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/retry`,
      { method: "POST", body: { messageId } },
    );
  }

  async forkSession(
    ref: string,
    input: ForkInput = {},
  ): Promise<Session> {
    const response = await this.request<{ data: Session }>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/fork`,
      { method: "POST", body: input },
    );
    return response.data;
  }

  async replyOptions(ref: string, mode: ReplyMode = "reply"): Promise<ReplyOptions> {
    return this.request<ReplyOptions>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/reply-options?mode=${mode}`,
    );
  }

  async replyAudit(
    ref: string,
    mode: ReplyMode = "reply",
  ): Promise<ReplyAudit> {
    return this.request<ReplyAudit>(
      `/api/v1/sessions/${encodeURIComponent(ref)}/reply-audit?mode=${mode}`,
    );
  }

  async replyFeedback(limit = 100): Promise<ReplyFeedbackPage> {
    return this.request<ReplyFeedbackPage>(
      `/api/v1/reply-feedback?limit=${limit}`,
    );
  }

  async saveReplyFeedback(
    input: ReplyFeedbackInput,
  ): Promise<ReplyFeedbackEntry> {
    return this.request<ReplyFeedbackEntry>("/api/v1/reply-feedback", {
      method: "POST",
      body: input,
    });
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

  private async requestForm<T>(
    path: string,
    form: FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        credentials: this.credentials,
        body: form,
        signal,
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

  private async request<T>(
    path: string,
    options: {
      auth?: boolean;
      method?: string;
      body?: unknown;
      keepalive?: boolean;
      headers?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers ?? {}),
    };
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
        signal: options.signal,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      const reason = options.signal?.reason as { name?: string } | undefined;
      if (
        (error as { name?: string } | undefined)?.name === "TimeoutError" ||
        reason?.name === "TimeoutError"
      ) {
        throw new HubError("timeout", "The request timed out", {
          retryable: true,
          cause: error,
        });
      }
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

function audioExtension(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("flac")) return "flac";
  return "webm";
}

