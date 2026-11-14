import { useEffect, useState } from "react";
import type { ConnectionStatus, HubClient } from "@amoshydra/oktoso-client";
import {
  flushSendQueue,
  queueLength,
  subscribeQueue,
} from "./send-queue";

/**
 * Replays queued prompts when the browser reconnects and exposes the count for
 * the topbar. Safe to call once at the app root.
 */
export function useSendQueue(
  client: HubClient | null,
  connection: ConnectionStatus,
): number {
  const [count, setCount] = useState(() => queueLength());

  useEffect(() => subscribeQueue(() => setCount(queueLength())), []);

  useEffect(() => {
    if (!client) return;
    const flush = () => {
      void flushSendQueue(client).catch(() => undefined);
    };
    flush();
    window.addEventListener("online", flush);
    const unsubscribe = subscribeQueue(flush);
    return () => {
      window.removeEventListener("online", flush);
      unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!client || connection !== "open") return;
    void flushSendQueue(client).catch(() => undefined);
  }, [client, connection]);

  return count;
}
