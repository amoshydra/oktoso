import type {
  Attention,
  AttentionField,
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
} from "@agent-hub/contracts";
import type { ProviderAdapter } from "../types";
import { ProviderError } from "../errors";
import { readSse } from "../http/sse";

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

interface OpenCodePermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  message?: string;
  metadata?: Record<string, unknown>;
}

interface OpenCodeFormField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  options?: Array<{ value: string; label: string; description?: string }>;
  placeholder?: string;
  default?: unknown;
}

interface OpenCodeFormInfo {
  id: string;
  sessionID: string;
  title: string;
  fields: OpenCodeFormField[];
}

interface OpenCodeAgent {
  id: string;
  name: string;
}

interface OpenCodeModel {
  id: string;
  modelID: string;
  providerID: string;
  name: string;
}

const openCodeCapabilities: ProviderCapabilities = {
  list: true,
  read: true,
  send: true,
  create: true,
  stream: true,
  interrupt: true,
  permissions: true,
  forms: true,
  attachments: false,
  search: false,
  options: true,
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
    ref: string,
    input: SendInput,
    signal: AbortSignal,
  ): Promise<SendResult> {
    const nativeID = this.nativeID(ref);
    const response = await this.request<{ data?: { id?: string } }>(
      `/api/session/${encodeURIComponent(nativeID)}/prompt`,
      {},
      signal,
      "POST",
      { text: input.text },
    );
    return {
      accepted: true,
      ...(response.data?.id ? { messageID: response.data.id } : {}),
    };
  }

  async createSession(
    input: CreateSessionInput,
    signal: AbortSignal,
  ): Promise<Session> {
    const model = parseModel(input.model);
    const response = await this.request<OpenCodeSessionResponse>(
      "/api/session",
      {},
      signal,
      "POST",
      {
        title: input.title,
        ...(input.agent ? { agent: input.agent } : {}),
        ...(model ? { model } : {}),
        ...(input.directory ? { location: { directory: input.directory } } : {}),
      },
    );
    return this.toSession(response.data);
  }

  async interrupt(ref: string, signal: AbortSignal): Promise<void> {
    const nativeID = this.nativeID(ref);
    await this.request(
      `/api/session/${encodeURIComponent(nativeID)}/interrupt`,
      {},
      signal,
      "POST",
    );
  }

  async getOptions(signal: AbortSignal): Promise<ProviderOptions> {
    const [agents, models] = await Promise.all([
      this.request<{ data: OpenCodeAgent[] }>("/api/agent", {}, signal),
      this.request<{ data: OpenCodeModel[] }>("/api/model", {}, signal),
    ]);
    return {
      agents: agents.data.map((agent) => ({ id: agent.id, label: agent.name })),
      models: models.data.map((model) => ({
        id: `${model.providerID}/${model.modelID}`,
        label: model.name,
        provider: model.providerID,
      })),
      directories: [],
    };
  }

  async listAttention(
    directories: string[],
    signal: AbortSignal,
  ): Promise<Attention[]> {
    const locations = [...new Set(directories.filter(Boolean))];
    const scope: Array<string | undefined> = locations.length > 0 ? locations : [undefined];
    const results = await Promise.allSettled(
      scope.map(async (directory) => {
        const query = directory ? { "location[directory]": directory } : {};
        const [permissions, forms] = await Promise.all([
          this.request<{ data: OpenCodePermissionRequest[] }>(
            "/api/permission/request",
            query,
            signal,
          ),
          this.request<{ data: OpenCodeFormInfo[] }>("/api/form", query, signal),
        ]);
        return [
          ...permissions.data.map((request) => this.permissionAttention(request)),
          ...forms.data.map((form) => this.formAttention(form)),
        ];
      }),
    );
    const byID = new Map<string, Attention>();
    let failures = 0;
    let firstFailure: unknown;
    for (const result of results) {
      if (result.status === "rejected") {
        failures += 1;
        firstFailure ??= result.reason;
        continue;
      }
      for (const item of result.value) byID.set(item.id, item);
    }
    if (results.length > 0 && failures === results.length) {
      throw firstFailure instanceof Error
        ? firstFailure
        : new Error(String(firstFailure));
    }
    return [...byID.values()];
  }

  async actOnAttention(
    id: string,
    action: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    const [providerID, kind, sessionID, nativeID] = id.split(":");
    if (providerID !== this.id || !sessionID || !nativeID) {
      throw new ProviderError("invalid_request", `Invalid OpenCode attention ID: ${id}`);
    }

    if (kind === "permission") {
      const decision =
        action === "approve_once"
          ? "once"
          : action === "approve_always"
            ? "always"
            : action === "deny"
              ? "reject"
              : undefined;
      if (!decision) {
        throw new ProviderError("unsupported", `Unsupported permission action: ${action}`);
      }
      await this.request(
        `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(nativeID)}/reply`,
        {},
        signal,
        "POST",
        { decision },
      );
      return;
    }

    if (kind === "form") {
      if (action === "answer") {
        const fields =
          payload && typeof payload === "object" && "fields" in payload
            ? (payload as { fields?: unknown }).fields
            : undefined;
        if (!fields || typeof fields !== "object") {
          throw new ProviderError("invalid_request", "Form answer fields are required");
        }
        const answer = Object.fromEntries(
          Object.entries(fields as Record<string, unknown>).filter(
            ([, value]) =>
              value !== undefined &&
              value !== "" &&
              !(Array.isArray(value) && value.length === 0),
          ),
        );
        await this.request(
          `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(nativeID)}/reply`,
          {},
          signal,
          "POST",
          { answer },
        );
        return;
      }
      if (action === "dismiss") {
        await this.request(
          `/api/session/${encodeURIComponent(sessionID)}/form/${encodeURIComponent(nativeID)}`,
          {},
          signal,
          "DELETE",
        );
        return;
      }
      throw new ProviderError("unsupported", `Unsupported form action: ${action}`);
    }

    throw new ProviderError("unsupported", `Unsupported attention kind: ${kind}`);
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

  async subscribe(
    onEvent: Parameters<NonNullable<ProviderAdapter["subscribe"]>>[0],
    signal: AbortSignal,
  ): Promise<() => void> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    void this.consumeEvents(onEvent, controller.signal).catch(() => undefined);
    return () => {
      controller.abort();
      signal.removeEventListener("abort", abort);
    };
  }

  private async consumeEvents(
    onEvent: Parameters<NonNullable<ProviderAdapter["subscribe"]>>[0],
    signal: AbortSignal,
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(`${this.baseUrl}/api/event`, {
          headers: {
            Authorization: this.authorization,
            Accept: "text/event-stream",
          },
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`OpenCode event stream returned HTTP ${response.status}`);
        }

        await readSse(
          response.body,
          (message) => {
            let parsed: { type?: unknown; data?: unknown };
            try {
              parsed = JSON.parse(message.data) as { type?: unknown; data?: unknown };
            } catch {
              return;
            }
            if (typeof parsed.type !== "string") return;
            const sessionID = findSessionID(parsed.data);
            if (!sessionID) return;
            onEvent({
              type: "session.updated",
              sessionRef: `${this.id}:${sessionID}`,
              data: { eventType: parsed.type },
              at: Date.now(),
            });
          },
          signal,
        );
      } catch {
        if (signal.aborted) return;
      }

      await delay(2_000, signal);
    }
  }

  private permissionAttention(request: OpenCodePermissionRequest): Attention {
    const summary =
      request.message ??
      `${request.action}: ${request.resources.join(", ")}`;
    return {
      id: `${this.id}:permission:${request.sessionID}:${request.id}`,
      sessionRef: `${this.id}:${request.sessionID}`,
      type: "permission",
      priority: "blocking",
      title: `Permission: ${request.action}`,
      summary,
      createdAt: Date.now(),
      actions: [
        { id: "approve_once", label: "Allow once", style: "primary" },
        { id: "approve_always", label: "Always allow" },
        { id: "deny", label: "Deny", style: "danger" },
      ],
      payload: request,
    };
  }

  private formAttention(form: OpenCodeFormInfo): Attention {
    const fields: AttentionField[] = [];
    let supported = true;
    for (const field of form.fields) {
      if (field.hidden) continue;
      const base = {
        id: field.key,
        label: field.title ?? field.key,
        required: field.required,
        ...(field.description ? { description: field.description } : {}),
      };
      if (field.type === "string") {
        if (field.options && field.options.length > 0) {
          fields.push({
            ...base,
            type: "select",
            defaultValue: field.default,
            options: field.options.map((option) => ({
              value: option.value,
              label: option.label,
            })),
          });
        } else {
          fields.push({
            ...base,
            type: "text",
            defaultValue: field.default,
            placeholder: field.placeholder,
          });
        }
      } else if (field.type === "number" || field.type === "integer") {
        fields.push({
          ...base,
          type: "number",
          defaultValue: field.default,
          placeholder: field.placeholder,
        });
      } else if (field.type === "boolean") {
        fields.push({
          ...base,
          type: "boolean",
          defaultValue: field.default,
        });
      } else if (field.type === "multiselect") {
        fields.push({
          ...base,
          type: "multiselect",
          defaultValue: field.default,
          options: field.options?.map((option) => ({
            value: option.value,
            label: option.label,
          })),
        });
      } else {
        supported = false;
      }
    }

    return {
      id: `${this.id}:form:${form.sessionID}:${form.id}`,
      sessionRef: `${this.id}:${form.sessionID}`,
      type: "question",
      priority: "blocking",
      title: form.title,
      summary: supported
        ? `${fields.length} field${fields.length === 1 ? "" : "s"} need an answer`
        : "This form needs the provider UI",
      createdAt: Date.now(),
      actions: [
        ...(supported
          ? [{ id: "answer", label: "Submit answer", style: "primary" as const }]
          : []),
        { id: "dismiss", label: "Cancel request", style: "danger" as const },
      ],
      ...(fields.length > 0 ? { fields } : {}),
      payload: form,
    };
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
      if (response.status === 409) {
        throw new ProviderError("conflict", "OpenCode rejected the request because it conflicts with the current session state", {
          status: 409,
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
  const value = model.id.startsWith(`${model.providerID}/`)
    ? model.id
    : `${model.providerID}/${model.id}`;
  return model.variant ? `${value}#${model.variant}` : value;
}

function parseModel(
  model: string | undefined,
): { providerID: string; id: string; variant?: string } | undefined {
  if (!model) return undefined;
  const [value, variant] = model.split("#", 2);
  const slash = value?.indexOf("/") ?? -1;
  if (!value || slash <= 0 || slash === value.length - 1) return undefined;
  return {
    providerID: value.slice(0, slash),
    id: value.slice(slash + 1),
    ...(variant ? { variant } : {}),
  };
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

function findSessionID(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || !value || typeof value !== "object") return undefined;
  if (
    "sessionID" in value &&
    typeof (value as { sessionID?: unknown }).sessionID === "string"
  ) {
    const id = (value as { sessionID: string }).sessionID;
    if (id.startsWith("ses")) return id;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findSessionID(child, depth + 1);
    if (found) return found;
  }
  return undefined;
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
