import type {
  CreateSessionInput,
  Message,
  MessagePage,
  MessagePart,
  MessagesQuery,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOptions,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
  SessionStatus,
} from "@amoshydra/oktoso-contracts";
import type { ProviderAdapter } from "../types";
import { ProviderError } from "../errors";

export interface OpenWebUIAdapterOptions {
  id: string;
  baseUrl: string;
  token: string;
}

interface OpenWebUIChatSummary {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
  last_read_at?: number | null;
  snippet?: string | null;
  active?: boolean;
}

interface OpenWebUIMessage {
  id: string;
  role?: string;
  content?: unknown;
  parentId?: string | null;
  childrenIds?: string[];
  timestamp?: number;
  model?: string;
  models?: string[];
  done?: boolean;
  error?: unknown;
  files?: unknown[];
  usage?: unknown;
}

interface OpenWebUIChat {
  id: string;
  user_id?: string;
  title: string;
  chat: {
    title?: string;
    models?: string[];
    messages?: unknown;
    history?: {
      currentId?: string | null;
      messages?: Record<string, OpenWebUIMessage>;
    };
  };
  updated_at: number;
  created_at: number;
  folder_id?: string | null;
  meta?: Record<string, unknown>;
}

interface OpenWebUIModel {
  id: string;
  name?: string;
}

interface OpenWebUIConfig {
  version?: string;
  name?: string;
}

const openWebUICapabilities: ProviderCapabilities = {
  list: true,
  read: true,
  send: true,
  create: true,
  stream: true,
  interrupt: true,
  permissions: false,
  forms: false,
  attachments: false,
  search: false,
  options: true,
  markRead: false,
};

export class OpenWebUIAdapter implements ProviderAdapter {
  readonly id: string;
  readonly type = "openwebui";
  readonly capabilities = openWebUICapabilities;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly summaries = new Map<string, OpenWebUIChatSummary>();

  constructor(options: OpenWebUIAdapterOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
  }

  async health(signal: AbortSignal): Promise<ProviderHealth> {
    try {
      await this.request<{ data: OpenWebUIModel[] }>(
        "/api/v1/models",
        {},
        signal,
      );
      const config = await this.request<OpenWebUIConfig>(
        "/api/config",
        {},
        signal,
      ).catch(() => undefined);
      return {
        status: "online",
        ...(config?.version ? { version: config.version } : {}),
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
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 200);
    const search = query.q?.trim();
    const rows: OpenWebUIChatSummary[] = [];
    const pageSize = 60;

    for (let page = 1; rows.length < limit && page <= 4; page += 1) {
      const next = await this.request<OpenWebUIChatSummary[]>(
        search ? "/api/v1/chats/search" : "/api/v1/chats/list",
        search
          ? { text: search, page }
          : { page, sort_by: "updated_at", sort_dir: "desc" },
        signal,
      );
      if (!Array.isArray(next)) {
        throw new ProviderError("internal", "Open WebUI returned an invalid chat list");
      }
      rows.push(...next);
      if (next.length < pageSize) break;
    }

    const unique = new Map<string, OpenWebUIChatSummary>();
    for (const row of rows) {
      if (row?.id) unique.set(row.id, row);
    }
    const sessions = [...unique.values()]
      .slice(0, limit)
      .map((row) => this.toSession(row, signal));
    // The summary endpoint does not expose failures. Check unread/active chats
    // so attention can surface a failed current branch without fetching every
    // chat on every sync.
    const candidateIndexes = new Set<number>();
    if (sessions.length > 0) candidateIndexes.add(0);
    sessions.forEach((session, index) => {
      if (session.unread || session.status === "running") candidateIndexes.add(index);
    });
    const candidates = [...candidateIndexes]
      .slice(0, 12)
      .map((index) => ({ session: sessions[index]!, index }));
    const settled = await Promise.allSettled(
      candidates.map(async ({ session, index }) => {
        const chat = await this.fetchChat(session.nativeID, signal);
        return { index, session: this.toSessionFromDetail(chat) };
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled") {
        const current = sessions[result.value.index];
        if (current) {
          sessions[result.value.index] = {
            ...result.value.session,
            unread: current.unread,
          };
        }
      }
    }

    for (const row of unique.values()) this.summaries.set(row.id, row);
    return { data: sessions, cursor: { next: null, previous: null } };
  }

  async getSession(ref: string, signal: AbortSignal): Promise<Session> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const summary = this.summaries.get(nativeID);
    return {
      ...this.toSessionFromDetail(chat),
      unread: summary ? this.isUnread(summary) : false,
    };
  }

  async getMessages(
    ref: string,
    query: MessagesQuery,
    signal: AbortSignal,
  ): Promise<MessagePage> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const branch = this.currentBranch(chat);
    const ordered = query.order === "desc" ? [...branch].reverse() : branch;
    const offset = decodeCursor(query.cursor);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
    const page = ordered.slice(offset, offset + limit);
    return {
      data: page.map((message) => this.toMessage(chat.id, message)),
      cursor: {
        next:
          offset + limit < ordered.length ? encodeCursor(offset + limit) : null,
        previous: offset > 0 ? encodeCursor(Math.max(0, offset - limit)) : null,
      },
    };
  }

  async createSession(
    input: CreateSessionInput,
    signal: AbortSignal,
  ): Promise<Session> {
    const model = input.model ?? (await this.firstModel(signal));
    if (!model) {
      throw new ProviderError("invalid_request", "Open WebUI has no available models");
    }
    const response = await this.request<OpenWebUIChat>(
      "/api/v1/chats/new",
      {},
      signal,
      "POST",
      {
        chat: {
          title: input.title,
          models: [model],
          messages: [],
          history: { currentId: null, messages: {} },
        },
      },
    );
    const session = this.toSessionFromDetail(response);
    const now = Math.floor(Date.now() / 1000);
    this.summaries.set(response.id, {
      id: response.id,
      title: response.title,
      updated_at: response.updated_at ?? now,
      created_at: response.created_at ?? now,
      last_read_at: response.updated_at ?? now,
      active: false,
    });
    return { ...session, unread: false };
  }

  async sendMessage(
    ref: string,
    input: SendInput,
    signal: AbortSignal,
  ): Promise<SendResult> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const branch = this.currentBranch(chat);
    const current = branch.at(-1);
    if (current?.role === "assistant" && current.done === false) {
      throw new ProviderError(
        "conflict",
        "This Open WebUI chat already has an active response",
      );
    }

    const model =
      chat.chat.models?.[0] ??
      [...branch].reverse().find((message) => message.model)?.model ??
      (await this.firstModel(signal));
    if (!model) {
      throw new ProviderError("invalid_request", "Open WebUI has no available models");
    }

    const userID = crypto.randomUUID();
    const assistantID = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const userMessage: OpenWebUIMessage = {
      id: userID,
      role: "user",
      content: input.text,
      parentId: current?.id ?? null,
      childrenIds: [assistantID],
      timestamp: now,
      models: [model],
      files: [],
    };
    const assistantMessage: OpenWebUIMessage = {
      id: assistantID,
      role: "assistant",
      content: "",
      parentId: userID,
      childrenIds: [],
      timestamp: now + 1,
      model,
      done: false,
    };

    await this.request<OpenWebUIChat>(
      `/api/v1/chats/${encodeURIComponent(nativeID)}`,
      {},
      signal,
      "POST",
      {
        chat: {
          models: [model],
          history: {
            currentId: assistantID,
            messages: {
              [userID]: userMessage,
              [assistantID]: assistantMessage,
            },
          },
        },
      },
    );

    const messages = branch
      .map((message) => ({
        role: message.role,
        content: contentText(message.content),
      }))
      .filter(
        (message): message is { role: string; content: string } =>
          Boolean(message.role && message.content),
      );
    messages.push({ role: "user", content: input.text });

    await this.triggerCompletion(
      {
        chat_id: nativeID,
        id: assistantID,
        user_message: userMessage,
        messages,
        model,
        stream: true,
        session_id: crypto.randomUUID(),
        background_tasks: {
          title_generation: false,
          tags_generation: false,
          follow_up_generation: false,
        },
        features: {
          code_interpreter: false,
          web_search: false,
          image_generation: false,
          memory: false,
        },
      },
      signal,
    );

    await this.waitForCompletion(nativeID, assistantID, signal);
    this.summaries.delete(nativeID);
    return { accepted: true, messageID: assistantID };
  }

  async interrupt(ref: string, signal: AbortSignal): Promise<void> {
    const nativeID = this.nativeID(ref);
    await this.request(
      `/api/tasks/chat/${encodeURIComponent(nativeID)}/stop`,
      {},
      signal,
      "POST",
    );
  }

  async getOptions(signal: AbortSignal): Promise<ProviderOptions> {
    const models = await this.listModels(signal);
    const preferred =
      models.find(
        (model) =>
          model.id !== "arena-model" && model.id !== "even-router-model",
      ) ?? models[0];
    return {
      agents: [],
      models: models.map((model) => ({
        id: model.id,
        label: model.name ?? model.id,
      })),
      directories: [],
      ...(preferred ? { defaults: { model: preferred.id } } : {}),
    };
  }

  private toSession(
    row: OpenWebUIChatSummary,
    _signal: AbortSignal,
  ): Session {
    const updatedAt = row.updated_at * 1_000;
    const createdAt = row.created_at * 1_000;
    return {
      ref: `${this.id}:${row.id}`,
      providerID: this.id,
      nativeID: row.id,
      title: row.title,
      status: row.active ? "running" : "idle",
      unread: this.isUnread(row),
      updatedAt,
      createdAt,
      nativeUrl: `${this.baseUrl}/c/${row.id}`,
    };
  }

  private toSessionFromDetail(chat: OpenWebUIChat): Session {
    const branch = this.currentBranch(chat);
    const last = branch.at(-1);
    const model =
      chat.chat.models?.[0] ??
      [...branch].reverse().find((message) => message.model)?.model;
    return {
      ref: `${this.id}:${chat.id}`,
      providerID: this.id,
      nativeID: chat.id,
      title: chat.title || chat.chat.title || "Untitled chat",
      status: this.statusFor(last, chat),
      unread: false,
      updatedAt: chat.updated_at * 1_000,
      createdAt: chat.created_at * 1_000,
      ...(model ? { model } : {}),
      nativeUrl: `${this.baseUrl}/c/${chat.id}`,
    };
  }

  private statusFor(
    last: OpenWebUIMessage | undefined,
    _chat: OpenWebUIChat,
  ): SessionStatus {
    if (last?.error) return "error";
    if (last?.role === "assistant" && last.done === false) return "running";
    return "idle";
  }

  private toMessage(sessionID: string, message: OpenWebUIMessage): Message {
    const createdAt = (message.timestamp ?? 0) * 1_000;
    const role =
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "system" ||
      message.role === "tool"
        ? message.role
        : "assistant";
    const metadata: Record<string, unknown> = {};
    if (message.error) metadata.error = message.error;
    if (message.usage) metadata.usage = message.usage;
    return {
      id: message.id,
      sessionRef: `${this.id}:${sessionID}`,
      role,
      parts: contentParts(message.content),
      createdAt,
      ...(message.done ? { completedAt: createdAt } : {}),
      ...(message.done === false ? { streaming: true } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  }

  private currentBranch(chat: OpenWebUIChat): OpenWebUIMessage[] {
    const history = chat.chat.history;
    const messages = history?.messages;
    if (messages) {
      const chain: OpenWebUIMessage[] = [];
      const seen = new Set<string>();
      let currentID = history?.currentId ?? chat.chat.history?.currentId ?? undefined;
      while (currentID && messages[currentID] && !seen.has(currentID)) {
        seen.add(currentID);
        const message = messages[currentID];
        if (!message) break;
        chain.push(message);
        currentID = message.parentId ?? undefined;
      }
      if (chain.length > 0) return chain.reverse();
      const all = Object.values(messages).filter(
        (message): message is OpenWebUIMessage => Boolean(message?.id),
      );
      if (all.length > 0) {
        return all.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
      }
    }
    if (Array.isArray(chat.chat.messages)) {
      return (chat.chat.messages as OpenWebUIMessage[]).filter(
        (message) => Boolean(message?.id),
      );
    }
    return [];
  }

  private isUnread(row: OpenWebUIChatSummary): boolean {
    return (row.last_read_at ?? 0) < row.updated_at;
  }

  private nativeID(ref: string): string {
    const separator = ref.indexOf(":");
    if (separator === -1 || ref.slice(0, separator) !== this.id) {
      throw new ProviderError("invalid_request", `Invalid Open WebUI session reference: ${ref}`);
    }
    return ref.slice(separator + 1);
  }

  private async fetchChat(id: string, signal: AbortSignal): Promise<OpenWebUIChat> {
    return this.request<OpenWebUIChat>(
      `/api/v1/chats/${encodeURIComponent(id)}`,
      {},
      signal,
    );
  }

  private async listModels(signal: AbortSignal): Promise<OpenWebUIModel[]> {
    const response = await this.request<{ data: OpenWebUIModel[] }>(
      "/api/v1/models",
      {},
      signal,
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  private async firstModel(signal: AbortSignal): Promise<string | undefined> {
    return (await this.listModels(signal))[0]?.id;
  }

  private async triggerCompletion(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw this.httpError(response.status, message);
    }
    if (response.body) {
      await response.text().catch(() => "");
    }
  }

  private async waitForCompletion(
    chatID: string,
    assistantID: string,
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      const chat = await this.fetchChat(chatID, signal);
      const message = chat.chat.history?.messages?.[assistantID];
      if (message?.error) {
        throw new ProviderError(
          "internal",
          `Open WebUI generation failed: ${errorText(message.error)}`,
        );
      }
      if (message?.done) return;
      await delay(750, signal);
    }
    throw new ProviderError("provider_offline", "Open WebUI completion was cancelled");
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
          Authorization: `Bearer ${this.token}`,
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
        `Unable to reach Open WebUI at ${this.baseUrl}`,
        { cause: error },
      );
    }

    if (response.status === 204) return undefined as T;
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw this.httpError(response.status, message);
    }
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ProviderError("internal", "Open WebUI returned invalid JSON", {
        cause: error,
      });
    }
  }

  private httpError(status: number, raw: string): ProviderError {
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { detail?: unknown; error?: unknown };
      message = String(parsed.detail ?? parsed.error ?? raw);
    } catch {
      // Keep the raw body when the provider did not return JSON.
    }
    if (status === 401 || status === 403) {
      return new ProviderError("provider_auth_error", "Open WebUI rejected the API key", {
        status,
        retryable: false,
      });
    }
    if (status === 404) {
      return new ProviderError("not_found", "Open WebUI resource not found", {
        status,
        retryable: false,
      });
    }
    if (status === 409) {
      return new ProviderError("conflict", "Open WebUI rejected the request because it conflicts with the chat state", {
        status,
        retryable: false,
      });
    }
    if (status === 429) {
      return new ProviderError("rate_limited", "Open WebUI rate limit reached", {
        status,
      });
    }
    return new ProviderError(
      status >= 500 ? "internal" : "invalid_request",
      message || `Open WebUI returned HTTP ${status}`,
      { status },
    );
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function contentParts(content: unknown): MessagePart[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (Array.isArray(content)) {
    const parts: MessagePart[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        if (part) parts.push({ type: "text", text: part });
        continue;
      }
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        const text = String((part as { text?: unknown }).text ?? "");
        if (text) parts.push({ type: "text", text });
        continue;
      }
      parts.push({ type: "unknown", raw: part });
    }
    return parts;
  }
  return content === undefined || content === null
    ? []
    : [{ type: "unknown", raw: content }];
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return JSON.stringify(error);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { v?: unknown; offset?: unknown };
    return parsed.v === 1 && typeof parsed.offset === "number"
      ? Math.max(0, parsed.offset)
      : 0;
  } catch {
    return 0;
  }
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
