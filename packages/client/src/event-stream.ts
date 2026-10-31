import type { HubEvent } from "@agent-hub/contracts";
import { HubError } from "./errors";
import { SseParser } from "./sse-parser";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface EventStreamOptions {
  baseUrl?: string;
  token?: string;
  credentials?: RequestCredentials;
  after?: number;
  signal: AbortSignal;
  onEvent: (event: HubEvent) => void;
  onStatus?: (status: ConnectionStatus) => void;
  fetchImpl?: typeof fetch;
  minReconnectMs?: number;
  maxReconnectMs?: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function parseHubEvent(event: string): HubEvent | undefined {
  try {
    const parsed = JSON.parse(event) as HubEvent;
    if (!parsed || typeof parsed.seq !== "number" || typeof parsed.type !== "string") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Run an authenticated SSE stream until the caller's signal is aborted. */
export async function runEventStream(options: EventStreamOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  let cursor = options.after ?? 0;
  let attempt = 0;
  const minReconnectMs = options.minReconnectMs ?? 500;
  const maxReconnectMs = options.maxReconnectMs ?? 15_000;

  while (!options.signal.aborted) {
    try {
      options.onStatus?.(attempt === 0 ? "connecting" : "reconnecting");
      const headers: Record<string, string> = { Accept: "text/event-stream" };
      if (options.token) headers.Authorization = `Bearer ${options.token}`;

      const response = await fetchImpl(`${baseUrl}/api/v1/events?after=${cursor}`, {
        headers,
        credentials: options.credentials ?? "same-origin",
        signal: options.signal,
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        const error = body as
          | { error?: { code?: string; message?: string; retryable?: boolean; requestId?: string } }
          | undefined;
        throw new HubError(
          error?.error?.code ?? "event_stream_failed",
          error?.error?.message ?? `Event stream failed with HTTP ${response.status}`,
          {
            status: response.status,
            retryable: error?.error?.retryable ?? response.status >= 500,
            requestId: error?.error?.requestId,
          },
        );
      }

      options.onStatus?.("open");
      attempt = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Event stream has no body");

      const parser = new SseParser();
      const decoder = new TextDecoder();
      try {
        while (!options.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const sse of parser.push(chunk)) {
            if (sse.id && /^\d+$/.test(sse.id)) cursor = Number(sse.id);
            if (!sse.data) continue;
            const hubEvent = parseHubEvent(sse.data);
            if (hubEvent) options.onEvent(hubEvent);
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (options.signal.aborted) break;
    } catch (error) {
      if (options.signal.aborted) break;
      if (error instanceof HubError && error.status === 401) throw error;
      if (error instanceof HubError && !error.retryable) throw error;
    }

    if (options.signal.aborted) break;
    const delay = Math.min(maxReconnectMs, minReconnectMs * 2 ** attempt);
    attempt += 1;
    options.onStatus?.("reconnecting");
    try {
      await sleep(delay + Math.floor(Math.random() * 250), options.signal);
    } catch {
      break;
    }
  }

  options.onStatus?.("closed");
}
