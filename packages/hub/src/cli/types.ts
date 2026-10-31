import type { LogRecord } from "../lib/logger";

export interface PairingLinkInfo {
  code: string;
  expiresAt: number;
}

export type ActivityTone =
  | "normal"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export interface ActivityItem {
  at: number;
  label: string;
  detail?: string;
  tone?: ActivityTone;
}

export interface ProviderView {
  id: string;
  status: string;
}

export interface UiSnapshot {
  version: string;
  host: string;
  port: number;
  urls: string[];
  startedAt: number;
  storage: string;
  providers: ProviderView[];
  sessions: number;
  attention: number;
  subscribers: number;
  eventSeq: number;
  requests: number;
  errors: number;
  hasWebRoot: boolean;
  webUrl?: string;
}

export type CliLogRecord = LogRecord;
