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
  SendResult,
  Session,
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
}

export interface ProviderSendInput extends SendInput {
  files?: ProviderAttachment[];
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
  readResource?(url: string, signal: AbortSignal): Promise<ProviderResource>;
  readFile?(
    input: ProviderFileRequest,
    signal: AbortSignal,
  ): Promise<ProviderResource>;
  subscribe?(
    onEvent: (event: ProviderEvent) => void,
    signal: AbortSignal,
  ): Promise<() => void>;
}

export const emptyCapabilities: ProviderCapabilities = {
  list: false,
  read: false,
  send: false,
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
  search: false,
  options: false,
  markRead: false,
};
