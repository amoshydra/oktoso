import type {
  AuthCheck,
  ProviderHealth,
  Diagnostics,
  ErrorResponse,
  CreateSessionInput,
  Health,
  MessagePage,
  MessagesQuery,
  Provider,
  ProviderOptions,
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
  token: string;
  fetchImpl?: typeof fetch;
}

export class HubClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: string;

  constructor(options: HubClientOptions) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  setToken(token: string): void {
    this.token = token;
  }

  async health(): Promise<Health> {
    return this.request<Health>("/api/v1/health", { auth: false });
  }

  async authCheck(): Promise<AuthCheck> {
    return this.request<AuthCheck>("/api/v1/auth/check");
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

  async markRead(ref: string): Promise<void> {
    await this.request<void>(`/api/v1/sessions/${encodeURIComponent(ref)}/read`, {
      method: "POST",
    });
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

  startEvents(options: {
    after?: number;
    signal: AbortSignal;
    onEvent: Parameters<typeof runEventStream>[0]["onEvent"];
    onStatus?: (status: ConnectionStatus) => void;
  }): Promise<void> {
    return runEventStream({
      baseUrl: this.baseUrl,
      token: this.token,
      after: options.after,
      signal: options.signal,
      onEvent: options.onEvent,
      onStatus: options.onStatus,
      fetchImpl: this.fetchImpl,
    });
  }

  private async request<T>(
    path: string,
    options: { auth?: boolean; method?: string; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.auth !== false) headers.Authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers,
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

