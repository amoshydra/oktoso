import type {
  BranchPoint,
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
import type {
  ProviderAdapter,
  ProviderAttachment,
  ProviderResource,
  ProviderSendInput,
} from "../types";
import { ProviderError } from "../errors";
import { readProviderResource } from "../http/resource";

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
  folder_id?: string | null;
}

interface OpenWebUIFolder {
  id: string;
  name: string;
  parent_id?: string | null;
}

interface OpenWebUIFile {
  id: string;
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
  attachments: true,
  attach: true,
  branches: true,
  fork: false,
  retry: true,
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
  private folderCache:
    | { at: number; folders: Map<string, OpenWebUIFolder> }
    | undefined;
  private folderChatCache:
    | { at: number; byChat: Map<string, string> }
    | undefined;

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
    const folders = await this.folders(signal).catch(() => new Map());
    const folderChats = await this.folderChats(folders, signal).catch(
      () => new Map(),
    );
    const sessions = [...unique.values()]
      .slice(0, limit)
      .map((row) =>
        this.toSession(
          row,
          folders,
          row.folder_id ?? folderChats.get(row.id),
        ),
      );
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
        return {
          index,
          session: this.toSessionFromDetail(
            chat,
            folders,
            folderChats.get(chat.id),
          ),
        };
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
    const folders = await this.folders(signal).catch(() => new Map());
    return {
      ...this.toSessionFromDetail(chat, folders),
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
    const folders = await this.folders(signal).catch(() => new Map());
    const session = this.toSessionFromDetail(response, folders);
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
    input: ProviderSendInput,
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
    const uploads = await Promise.all(
      (input.files ?? []).map(async (file) => ({
        file,
        uploaded: await this.uploadFile(file, signal),
      })),
    );
    await Promise.all(
      uploads.map(({ uploaded }) => this.waitForFile(uploaded.id, signal)),
    );
    const fileRefs = uploads.map(({ file, uploaded }) => ({
      type: "file",
      id: uploaded.id,
      name: file.name,
      mime_type: file.mimeType,
    }));
    const userMessage: OpenWebUIMessage = {
      id: userID,
      role: "user",
      content: input.text,
      parentId: current?.id ?? null,
      childrenIds: [assistantID],
      timestamp: now,
      models: [model],
      files: fileRefs,
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
        ...(fileRefs.length > 0 ? { files: fileRefs } : {}),
      },
      signal,
    );

    await this.waitForCompletion(nativeID, assistantID, signal);
    this.summaries.delete(nativeID);
    return { accepted: true, messageID: assistantID };
  }

  async listBranches(
    ref: string,
    signal: AbortSignal,
  ): Promise<BranchPoint[]> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const messages = chat.chat.history?.messages ?? {};
    const points: BranchPoint[] = [];

    for (const message of this.currentBranch(chat)) {
      const parent = message.parentId ? messages[message.parentId] : undefined;
      const siblingIds = parent?.childrenIds ?? [];
      const index = siblingIds.indexOf(message.id);
      if (siblingIds.length < 2 || index < 0) continue;
      points.push({
        messageId: message.id,
        parentId: message.parentId ?? null,
        role:
          message.role === "user"
            ? "user"
            : message.role === "assistant"
              ? "assistant"
              : "system",
        siblingIds,
        index,
        count: siblingIds.length,
      });
    }

    return points;
  }

  async switchBranch(
    ref: string,
    siblingId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const messages = chat.chat.history?.messages;
    if (!messages?.[siblingId]) {
      throw new ProviderError("not_found", "Open WebUI branch message not found");
    }

    let leaf = messages[siblingId]!;
    const seen = new Set<string>([leaf.id]);
    for (;;) {
      const children = (leaf.childrenIds ?? [])
        .map((id) => messages[id])
        .filter((message): message is OpenWebUIMessage => Boolean(message));
      if (children.length === 0) break;
      const next = children.sort(
        (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0),
      )[0]!;
      if (seen.has(next.id)) break;
      seen.add(next.id);
      leaf = next;
    }

    await this.request<OpenWebUIChat>(
      `/api/v1/chats/${encodeURIComponent(nativeID)}`,
      {},
      signal,
      "POST",
      { chat: { history: { currentId: leaf.id } } },
    );
  }

  async retryMessage(
    ref: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<SendResult> {
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    const messages = chat.chat.history?.messages;
    const target = messages?.[messageId];
    if (!target || target.role !== "assistant") {
      throw new ProviderError(
        "invalid_request",
        "Retry needs an assistant message",
      );
    }
    const user = target.parentId ? messages?.[target.parentId] : undefined;
    if (!user || user.role !== "user") {
      throw new ProviderError(
        "invalid_request",
        "Retry needs the assistant's user message",
      );
    }

    const retryFiles = Array.isArray(user.files) ? user.files : [];
    const model =
      chat.chat.models?.[0] ??
      target.model ??
      user.models?.[0] ??
      (await this.firstModel(signal));
    if (!model) {
      throw new ProviderError("invalid_request", "Open WebUI has no available models");
    }

    const assistantID = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const assistant: OpenWebUIMessage = {
      id: assistantID,
      role: "assistant",
      content: "",
      parentId: user.id,
      childrenIds: [],
      timestamp: now,
      model,
      done: false,
    };
    user.childrenIds = [...(user.childrenIds ?? []), assistantID];

    await this.request<OpenWebUIChat>(
      `/api/v1/chats/${encodeURIComponent(nativeID)}`,
      {},
      signal,
      "POST",
      {
        chat: {
          history: {
            currentId: assistantID,
            messages: {
              [user.id]: user,
              [assistantID]: assistant,
            },
          },
        },
      },
    );

    const branch = this.currentBranch(chat);
    const userIndex = branch.findIndex((message) => message.id === user.id);
    const context = (userIndex >= 0 ? branch.slice(0, userIndex + 1) : branch)
      .map((message) => ({
        role: message.role,
        content: contentText(message.content),
      }))
      .filter(
        (message): message is { role: string; content: string } =>
          Boolean(message.role && message.content),
      );

    await this.triggerCompletion(
      {
        chat_id: nativeID,
        id: assistantID,
        user_message: user,
        messages: context,
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
        ...(retryFiles.length > 0 ? { files: retryFiles } : {}),
      },
      signal,
    );

    await this.waitForCompletion(nativeID, assistantID, signal);
    this.summaries.delete(nativeID);
    return { accepted: true, messageID: assistantID };
  }

  async setSessionOptions(
    ref: string,
    input: { model?: string; agent?: string },
    signal: AbortSignal,
  ): Promise<void> {
    if (input.agent) {
      throw new ProviderError(
        "unsupported",
        "Open WebUI does not support changing the session agent",
      );
    }
    if (!input.model) return;
    const nativeID = this.nativeID(ref);
    const chat = await this.fetchChat(nativeID, signal);
    await this.request(
      `/api/v1/chats/${encodeURIComponent(nativeID)}`,
      {},
      signal,
      "POST",
      { chat: { ...chat.chat, models: [input.model] } },
    );
  }

  async readResource(url: string, signal: AbortSignal): Promise<ProviderResource> {
    return readProviderResource({
      url,
      baseUrl: this.baseUrl,
      headers: { Authorization: `Bearer ${this.token}` },
      signal,
      providerLabel: "Open WebUI",
    });
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
    folders: Map<string, OpenWebUIFolder>,
    folderID?: string | null,
  ): Session {
    const updatedAt = row.updated_at * 1_000;
    const createdAt = row.created_at * 1_000;
    const project = this.folderPath(folderID ?? row.folder_id, folders);
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
      ...(project ? { project } : {}),
    };
  }

  private toSessionFromDetail(
    chat: OpenWebUIChat,
    folders: Map<string, OpenWebUIFolder>,
    folderID?: string | null,
  ): Session {
    const branch = this.currentBranch(chat);
    const last = branch.at(-1);
    const model =
      chat.chat.models?.[0] ??
      [...branch].reverse().find((message) => message.model)?.model;
    const project = this.folderPath(folderID ?? chat.folder_id, folders);
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
      ...(project ? { project } : {}),
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
      parts: [...contentParts(message.content), ...fileParts(message.files)],
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

  private async waitForFile(
    fileID: string,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const status = await this.request<{
          status?: string;
          error?: unknown;
        }>(
          `/api/v1/files/${encodeURIComponent(fileID)}/process/status`,
          {},
          signal,
        );
        if (status.status === "completed") return;
        if (status.status === "failed") {
          throw new ProviderError(
            "internal",
            `Open WebUI could not process the attachment: ${errorText(status.error)}`,
          );
        }
      } catch (error) {
        if (error instanceof ProviderError && error.code === "not_found") return;
        throw error;
      }
      await delay(500, signal);
    }
  }

  private async folders(
    signal: AbortSignal,
  ): Promise<Map<string, OpenWebUIFolder>> {
    const cached = this.folderCache;
    if (cached && Date.now() - cached.at < 60_000) return cached.folders;
    const response = await this.request<
      OpenWebUIFolder[] | { data?: OpenWebUIFolder[] }
    >("/api/v1/folders/", {}, signal);
    const rows = Array.isArray(response)
      ? response
      : Array.isArray(response.data)
        ? response.data
        : [];
    const folders = new Map(
      rows
        .filter((folder): folder is OpenWebUIFolder => Boolean(folder?.id))
        .map((folder) => [folder.id, folder]),
    );
    this.folderCache = { at: Date.now(), folders };
    return folders;
  }

  private async folderChats(
    folders: Map<string, OpenWebUIFolder>,
    signal: AbortSignal,
  ): Promise<Map<string, string>> {
    const cached = this.folderChatCache;
    if (cached && Date.now() - cached.at < 300_000) return cached.byChat;
    if (folders.size === 0) {
      const empty = new Map<string, string>();
      this.folderChatCache = { at: Date.now(), byChat: empty };
      return empty;
    }
    const entries = await Promise.all(
      [...folders.keys()].map(async (folderID) => {
        try {
          const rows = await this.request<OpenWebUIChatSummary[]>(
            `/api/v1/chats/folder/${encodeURIComponent(folderID)}/list`,
            { page: 1 },
            signal,
          );
          return Array.isArray(rows)
            ? rows
                .filter((row): row is OpenWebUIChatSummary => Boolean(row?.id))
                .map((row) => [row.id, folderID] as const)
            : [];
        } catch {
          return [];
        }
      }),
    );
    const byChat = new Map(entries.flat());
    this.folderChatCache = { at: Date.now(), byChat };
    return byChat;
  }

  private folderPath(
    folderID: string | null | undefined,
    folders: Map<string, OpenWebUIFolder>,
  ): string | undefined {
    if (!folderID) return undefined;
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null | undefined = folderID;
    while (current && !seen.has(current)) {
      seen.add(current);
      const folder = folders.get(current);
      if (!folder) break;
      if (folder.name) names.unshift(folder.name);
      current = folder.parent_id;
    }
    return names.length > 0 ? names.join(" / ") : undefined;
  }

  private async uploadFile(
    file: ProviderAttachment,
    signal: AbortSignal,
  ): Promise<OpenWebUIFile> {
    const form = new FormData();
    form.set(
      "file",
      new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
      file.name,
    );
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/v1/files/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        body: form,
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError(
        "provider_offline",
        `Unable to reach Open WebUI at ${this.baseUrl}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw this.httpError(response.status, await response.text().catch(() => ""));
    }
    const payload = (await response.json().catch(() => undefined)) as
      | { id?: unknown }
      | undefined;
    if (!payload || typeof payload.id !== "string" || !payload.id) {
      throw new ProviderError(
        "internal",
        "Open WebUI did not return a file id",
      );
    }
    return { id: payload.id };
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
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        if (record.type === "image_url" || record.type === "input_image") {
          const image = record.image_url;
          const url =
            typeof image === "string"
              ? image
              : image && typeof image === "object" && "url" in image
                ? String((image as { url?: unknown }).url ?? "")
                : typeof record.url === "string"
                  ? record.url
                  : "";
          if (url) {
            parts.push({ type: "file", name: "Image", mimeType: "image/*", url });
            continue;
          }
        }
        if (record.type === "file") {
          const file =
            record.file && typeof record.file === "object"
              ? (record.file as Record<string, unknown>)
              : record;
          const url =
            typeof file.url === "string"
              ? file.url
              : typeof file.path === "string"
                ? file.path
                : undefined;
          const name =
            typeof file.filename === "string"
              ? file.filename
              : typeof file.name === "string"
                ? file.name
                : "File";
          const mimeType =
            typeof file.mime_type === "string"
              ? file.mime_type
              : typeof file.mimeType === "string"
                ? file.mimeType
                : undefined;
          parts.push({
            type: "file",
            name,
            ...(mimeType ? { mimeType } : {}),
            ...(url ? { url } : {}),
          });
          continue;
        }
      }
      parts.push({ type: "unknown", raw: part });
    }
    return parts;
  }
  return content === undefined || content === null
    ? []
    : [{ type: "unknown", raw: content }];
}

function fileParts(files: unknown): MessagePart[] {
  if (!Array.isArray(files)) return [];
  const parts: MessagePart[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;
    const name =
      typeof file.name === "string"
        ? file.name
        : typeof file.filename === "string"
          ? file.filename
          : "File";
    const url =
      typeof file.url === "string"
        ? file.url
        : typeof file.path === "string"
          ? file.path
          : undefined;
    const mimeType =
      typeof file.mime_type === "string"
        ? file.mime_type
        : typeof file.type === "string" && file.type.includes("/")
          ? file.type
          : typeof file.mimeType === "string"
            ? file.mimeType
            : file.type === "image"
              ? "image/*"
              : undefined;
    if (!url && name === "File") continue;
    parts.push({
      type: "file",
      name,
      ...(mimeType ? { mimeType } : {}),
      ...(url ? { url } : {}),
    });
  }
  return parts;
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
