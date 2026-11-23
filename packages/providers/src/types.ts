import type {
  Attention,
  BranchPoint,
  CreateSessionInput,
  ForkInput,
  MessagePage,
  MessagesQuery,
  ProviderCapabilities,
  ProviderHealth,
  ProviderOptions,
  SendInput,
  SendDelivery,
  SendResult,
  Session,
  SessionHistory,
  SessionListQuery,
  SessionPage,
  SessionSelectionInput,
} from "@amoshydra/oktoso-contracts";

export type ProviderEvent =
  | {
      type: "session.updated" | "session.created" | "session.deleted";
      sessionRef: string;
      data: unknown;
      at: number;
    }
  | {
      type: "message.created" | "message.updated" | "message.delta";
      sessionRef: string;
      data: unknown;
      at: number;
    }
  | {
      type: "attention.created" | "attention.updated" | "attention.resolved";
      sessionRef: string;
      attentionID: string;
      data: unknown;
      at: number;
    };

export interface ProviderResource {
  body: Uint8Array<ArrayBuffer>;
  contentType?: string;
  filename?: string;
}

/**
 * A provider resource whose body is still streaming.
 *
 * The hub relays this to the client, so a 100 MB video never passes through a
 * hub-side buffer. `contentRange` is set when the provider honored a `Range`
 * request; otherwise the caller is holding the whole resource.
 */
export interface ProviderResourceStream {
  status: 200 | 206;
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
  filename?: string;
  /** Bytes in this response body, from `Content-Length`. */
  contentLength?: number;
  /** Raw `Content-Range`, e.g. `bytes 0-1023/8192`. */
  contentRange?: string;
  /** Whole-resource size, parsed from `Content-Range`. */
  totalBytes?: number;
}

/** The provider refused a range: the resource is shorter than `totalBytes`. */
export interface ProviderResourceUnsatisfiable {
  status: 416;
  totalBytes?: number;
}

export type ProviderResourceOpen =
  | ProviderResourceStream
  | ProviderResourceUnsatisfiable;

export interface ProviderResourceOptions {
  /** Override the resource cap, e.g. for a video the browser streams. */
  maxBytes?: number;
  /** `bytes=start-end`; forwarded upstream when the provider supports it. */
  range?: string;
  /** Abort a body that is still open after this long. Defaults to ten minutes. */
  streamTimeoutMs?: number;
}

export interface ProviderAttachment {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

/**
 * A file inside a session's working directory.
 *
 * `path` is always relative to `directory` and has already passed
 * `normalizeSessionPath`. The adapter resolves it against the provider's
 * filesystem endpoint, so the hub never touches the provider's disk.
 */
export interface ProviderFileRequest {
  ref: string;
  directory?: string;
  path: string;
  /** Override the resource cap, e.g. for a video the browser streams. */
  maxBytes?: number;
  /** `bytes=start-end`; forwarded upstream when the provider supports it. */
  range?: string;
}

export interface ProviderSendInput extends SendInput {
  files?: ProviderAttachment[];
}

export interface ProviderInboxItem {
  id: string;
  type: string;
  delivery: SendDelivery;
  text: string;
  createdAt: number;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  health(signal: AbortSignal): Promise<ProviderHealth>;
  listSessions(query: SessionListQuery, signal: AbortSignal): Promise<SessionPage>;
  getSession(ref: string, signal: AbortSignal): Promise<Session>;
  getMessages(
    ref: string,
    query: MessagesQuery,
    signal: AbortSignal,
  ): Promise<MessagePage>;
  sendMessage(
    ref: string,
    input: ProviderSendInput,
    signal: AbortSignal,
  ): Promise<SendResult>;
  createSession(input: CreateSessionInput, signal: AbortSignal): Promise<Session>;

  interrupt?(ref: string, signal: AbortSignal): Promise<void>;
  /** Queue a context compaction for the session. */
  compactSession?(ref: string, signal: AbortSignal): Promise<void>;
  listBranches?(ref: string, signal: AbortSignal): Promise<BranchPoint[]>;
  switchBranch?(
    ref: string,
    siblingId: string,
    signal: AbortSignal,
  ): Promise<void>;
  forkSession?(
    ref: string,
    input: ForkInput,
    signal: AbortSignal,
  ): Promise<Session>;
  retryMessage?(
    ref: string,
    messageId: string,
    signal: AbortSignal,
  ): Promise<SendResult>;
  /** Current undo/redo state, including a staged (undone) turn. */
  history?(ref: string, signal: AbortSignal): Promise<SessionHistory>;
  /** Undo the latest turn. Conversation only: files are reported, not restored. */
  undoLastTurn?(ref: string, signal: AbortSignal): Promise<SessionHistory>;
  /** Restore the latest undone turn. */
  redoLastTurn?(ref: string, signal: AbortSignal): Promise<SessionHistory>;
  listInbox?(ref: string, signal: AbortSignal): Promise<ProviderInboxItem[]>;
  updateInbox?(
    ref: string,
    inboxID: string,
    delivery: SendDelivery,
    signal: AbortSignal,
  ): Promise<void>;
  deleteInbox?(ref: string, inboxID: string, signal: AbortSignal): Promise<void>;
  listAttention?(directories: string[], signal: AbortSignal): Promise<Attention[]>;
  actOnAttention?(
    id: string,
    action: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<void>;
  getOptions?(signal: AbortSignal): Promise<ProviderOptions>;
  setSessionOptions?(
    ref: string,
    input: SessionSelectionInput,
    signal: AbortSignal,
  ): Promise<void>;
  markRead?(ref: string, signal: AbortSignal): Promise<void>;
  renameSession?(ref: string, title: string, signal: AbortSignal): Promise<Session>;
  readResource?(
    url: string,
    signal: AbortSignal,
    options?: ProviderResourceOptions,
  ): Promise<ProviderResource>;
  /** Streaming media path; falls back to `readResource` when absent. */
  openResource?(
    url: string,
    signal: AbortSignal,
    options?: ProviderResourceOptions,
  ): Promise<ProviderResourceOpen>;
  readFile?(
    input: ProviderFileRequest,
    signal: AbortSignal,
  ): Promise<ProviderResource>;
  /** Streaming file path; falls back to `readFile` when absent. */
  openFile?(
    input: ProviderFileRequest,
    signal: AbortSignal,
  ): Promise<ProviderResourceOpen>;
  subscribe?(
    onEvent: (event: ProviderEvent) => void,
    signal: AbortSignal,
  ): Promise<() => void>;
}

export const emptyCapabilities: ProviderCapabilities = {
  list: false,
  read: false,
  send: false,
  steer: false,
  queue: false,
  create: false,
  stream: false,
  interrupt: false,
  permissions: false,
  forms: false,
  attachments: false,
  attach: false,
  files: false,
  branches: false,
  fork: false,
  retry: false,
  undo: false,
  redo: false,
  search: false,
  options: false,
  markRead: false,
  rename: false,
};
