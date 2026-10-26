import type {
  CreateSessionInput,
  Message,
  MessagePage,
  MessagePart,
  MessagesQuery,
  ProviderCapabilities,
  ProviderHealth,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
  SessionStatus,
} from "@agent-hub/contracts";
import type { ProviderAdapter } from "../types";
import { ProviderError } from "../errors";

export interface OpenCodeAdapterOptions {
  id: string;
  baseUrl: string;
  username?: string;
  password: string;
}

interface OpenCodeSessionRaw {
  id: string;
  projectID?: string;
  parentID?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
  };
  outcome?: "succeeded" | "failed" | "interrupted";
  time: {
    created: number;
    updated: number;
    idle?: number;
    viewed?: number;
  };
  title: string;
  location?: { directory?: string };
}

interface OpenCodeSessionResponse {
  data: OpenCodeSessionRaw;
}

interface OpenCodeSessionsResponse {
  data: OpenCodeSessionRaw[];
  cursor: { previous?: string | null; next?: string | null };
}

interface OpenCodeMessageRaw {
  id: string;
  type: string;
  time?: { created?: number; completed?: number };
  text?: string;
  content?: Array<Record<string, unknown>>;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  error?: unknown;
}

interface OpenCodeMessagesResponse {
  data: OpenCodeMessageRaw[];
  cursor: { previous?: string | null; next?: string | null };
}

const openCodeCapabilities: ProviderCapabilities = {
  list: true,
  read: true,
  send: false,
  create: false,
  stream: false,
  interrupt: false,
  permissions: false,
  forms: false,
  attachments: false,
  search: false,
  options: false,
  markRead: true,
};

export class OpenCodeAdapter implements ProviderAdapter {
  readonly id: string;
  readonly type = "opencode";
  readonly capabilities = openCodeCapabilities;
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(options: OpenCodeAdapterOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.authorization = `Basic ${Buffer.from(
      `${options.username ?? "opencode"}:${options.password}`,
    ).toString("base64")}`;
  }

  async health(signal: AbortSignal): Promise<ProviderHealth> {
    try {
      const info = await this.request<{ version?: string }>("/api/info", {}, signal);
      return {
        status: "online",
        ...(info.version ? { version: info.version } : {}),
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === "provider_auth_error") {
        return { status: "auth-error", message: error.message };
      }
      return {
        status: "offline",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listSessions(
    query: SessionListQuery,
    signal: AbortSignal,
  ): Promise<SessionPage> {
    const response = await this.request<OpenCodeSessionsResponse>(
      "/api/session",
      {
        limit: query.limit ?? 100,
        order: "desc",
        cursor: query.cursor,
        search: query.q,
      },
      signal,
    );
    return {
      data: response.data.map((item) => this.toSession(item)),
      cursor: {
        next: response.cursor.next ?? null,
        previous: response.cursor.previous ?? null,
      },
    };
  }

  async getSession(ref: string, signal: AbortSignal): Promise<Session> {
    const nativeID = this.nativeID(ref);
    const response = await this.request<OpenCodeSessionResponse>(
      `/api/session/${encodeURIComponent(nativeID)}`,
      {},
      signal,
    );
    return this.toSession(response.data);
  }

  async getMessages(
    ref: string,
    query: MessagesQuery,
    signal: AbortSignal,
  ): Promise<MessagePage> {
    const nativeID = this.nativeID(ref);
    const response = await this.request<OpenCodeMessagesResponse>(
      `/api/session/${encodeURIComponent(nativeID)}/message`,
      {
        limit: query.limit ?? 50,
        order: query.order ?? "asc",
        cursor: query.cursor,
      },
      signal,
    );
    return {
      data: response.data
        .map((item) => this.toMessage(ref, item))
        .filter((item): item is Message => Boolean(item)),
      cursor: {
        next: response.cursor.next ?? null,
        previous: response.cursor.previous ?? null,
      },
    };
  }

  async sendMessage(
    _ref: string,
    _input: SendInput,
    _signal: AbortSignal,
  ): Promise<SendResult> {
    throw new ProviderError("unsupported", "OpenCode prompt sending is not enabled yet");
  }

  async createSession(
    _input: CreateSessionInput,
    _signal: AbortSignal,
  ): Promise<Session> {
    throw new ProviderError("unsupported", "OpenCode session creation is not enabled yet");
  }

  async markRead(ref: string, signal: AbortSignal): Promise<void> {
    const nativeID = this.nativeID(ref);
    const raw = await this.request<OpenCodeSessionResponse>(
      `/api/session/${encodeURIComponent(nativeID)}`,
      {},
      signal,
    );
    const idle = raw.data.time.idle ?? raw.data.time.updated;
    await this.request(
      `/api/session/${encodeURIComponent(nativeID)}/view`,
      {},
      signal,
      "POST",
      { idle },
    );
  }

  private nativeID(ref: string): string {
    const separator = ref.indexOf(":");
    if (separator === -1 || ref.slice(0, separator) !== this.id) {
      throw new ProviderError("invalid_request", `Invalid OpenCode session reference: ${ref}`);
    }
    return ref.slice(separator + 1);
  }

  private toSession(raw: OpenCodeSessionRaw): Session {
    const directory = raw.location?.directory;
    return {
      ref: `${this.id}:${raw.id}`,
      providerID: this.id,
      nativeID: raw.id,
      title: raw.title,
      ...(directory ? { directory, project: projectName(directory) } : {}),
      ...(raw.parentID ? { parentRef: `${this.id}:${raw.parentID}` } : {}),
      ...(raw.agent ? { agent: raw.agent } : {}),
      ...(raw.model ? { model: modelRef(raw.model) } : {}),
      status: sessionStatus(raw),
      unread: sessionUnread(raw),
      updatedAt: raw.time.updated,
      createdAt: raw.time.created,
      ...(typeof raw.cost === "number" ? { cost: raw.cost } : {}),
      ...(raw.tokens
        ? {
            tokens: {
              input: raw.tokens.input,
              output: raw.tokens.output,
              total:
                (raw.tokens.input ?? 0) +
                (raw.tokens.output ?? 0) +
                (raw.tokens.reasoning ?? 0),
            },
          }
        : {}),
    };
  }

  private toMessage(sessionRef: string, raw: OpenCodeMessageRaw): Message | undefined {
    if (raw.type === "user") {
      return {
        id: raw.id,
        sessionRef,
        role: "user",
        parts: raw.text ? [{ type: "text", text: raw.text }] : [],
        createdAt: raw.time?.created ?? 0,
      };
    }

    if (raw.type !== "assistant") return undefined;

    const parts: MessagePart[] = (raw.content ?? []).map((part) => {
      const type = part.type;
      if (type === "text") {
        return { type: "text", text: String(part.text ?? "") };
      }
      if (type === "reasoning") {
        return { type: "reasoning", text: String(part.text ?? "") };
      }
      if (type === "tool") {
        const state =
          part.state && typeof part.state === "object"
            ? (part.state as Record<string, unknown>)
            : {};
        return {
          type: "tool",
          id: String(part.id ?? ""),
          name: String(part.name ?? "tool"),
          status: String(state.status ?? "unknown"),
          input: state.input,
          output: state.content ?? state.error,
        };
      }
      return { type: "unknown", raw: part };
    });

    return {
      id: raw.id,
      sessionRef,
      role: "assistant",
      parts,
      createdAt: raw.time?.created ?? 0,
      ...(raw.time?.completed ? { completedAt: raw.time.completed } : {}),
      ...(raw.time?.created && !raw.time?.completed ? { streaming: true } : {}),
      ...(raw.error ? { metadata: { error: raw.error } } : {}),
    };
  }

  private async request<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    signal: AbortSignal,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: this.authorization,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError(
        "provider_offline",
        `Unable to reach OpenCode at ${this.baseUrl}`,
        { cause: error },
      );
    }

    if (response.status === 204) return undefined as T;
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError("provider_auth_error", "OpenCode rejected the credentials", {
          status: response.status,
          retryable: false,
        });
      }
      if (response.status === 404) {
        throw new ProviderError("not_found", "OpenCode resource not found", {
          status: 404,
          retryable: false,
        });
      }
      if (response.status === 429) {
        throw new ProviderError("rate_limited", "OpenCode rate limit reached", {
          status: 429,
        });
      }
      throw new ProviderError(
        response.status >= 500 ? "internal" : "invalid_request",
        message || `OpenCode returned HTTP ${response.status}`,
        { status: response.status },
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ProviderError("internal", "OpenCode returned invalid JSON", {
        cause: error,
      });
    }
  }
}

function projectName(directory: string): string {
  const clean = directory.replace(/\/+$/, "");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function modelRef(model: { id: string; providerID: string; variant?: string }): string {
  return `${model.providerID}/${model.id}${model.variant ? `#${model.variant}` : ""}`;
}

function sessionStatus(raw: OpenCodeSessionRaw): SessionStatus {
  if (raw.outcome === "failed") return "error";
  if (raw.time.idle !== undefined || raw.outcome === "interrupted") return "idle";
  return "running";
}

function sessionUnread(raw: OpenCodeSessionRaw): boolean {
  if (raw.time.viewed === undefined) return true;
  return raw.time.idle !== undefined && raw.time.viewed < raw.time.idle;
}
