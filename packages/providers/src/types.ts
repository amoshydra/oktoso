import type {
  Attention,
  CreateSessionInput,
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
} from "@agent-hub/contracts";

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
  sendMessage(ref: string, input: SendInput, signal: AbortSignal): Promise<SendResult>;
  createSession(input: CreateSessionInput, signal: AbortSignal): Promise<Session>;

  interrupt?(ref: string, signal: AbortSignal): Promise<void>;
  listAttention?(directories: string[], signal: AbortSignal): Promise<Attention[]>;
  actOnAttention?(
    id: string,
    action: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<void>;
  getOptions?(signal: AbortSignal): Promise<ProviderOptions>;
  markRead?(ref: string, signal: AbortSignal): Promise<void>;
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
  search: false,
  options: false,
  markRead: false,
};
