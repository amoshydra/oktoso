import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HubEvent } from "@amoshydra/oktoso-contracts";
import type { EventBus } from "../../services/event-bus";
import type { AppEnv } from "../types";
import { badRequest } from "../../domain/errors";

const MAX_CLIENT_BACKLOG = 256;

function resyncEvent(seq: number, reason: string): HubEvent {
  return {
    seq,
    type: "resync",
    data: { reason, latestSeq: seq },
    at: Date.now(),
  };
}

export function registerEventRoutes(
  app: Hono<AppEnv>,
  eventBus: EventBus,
): void {
  app.get("/api/v1/events", (c) => {
    const rawAfter = c.req.query("after");
    const after = rawAfter === undefined ? 0 : Number(rawAfter);
    if (!Number.isInteger(after) || after < 0) {
      throw badRequest("after must be a non-negative integer");
    }

    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      await stream.write("retry: 3000\n\n");

      const replay = eventBus.replay(after);
      if (replay.gap) {
        const event = resyncEvent(replay.latestSeq, "cursor_gap");
        await stream.writeSSE({
          id: String(event.seq),
          event: event.type,
          data: JSON.stringify(event),
        });
      } else {
        for (const event of replay.events) {
          await stream.writeSSE({
            id: String(event.seq),
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      }

      const queue: HubEvent[] = [];
      let overflow = false;
      const unsubscribe = eventBus.subscribe((event) => {
        if (queue.length >= MAX_CLIENT_BACKLOG) {
          overflow = true;
          return;
        }
        queue.push(event);
      });

      stream.onAbort(unsubscribe);
      let lastHeartbeat = Date.now();

      try {
        while (!stream.aborted && !stream.closed) {
          if (overflow) {
            const event = resyncEvent(eventBus.lastSeq, "client_backlog");
            await stream.writeSSE({
              id: String(event.seq),
              event: event.type,
              data: JSON.stringify(event),
            });
            break;
          }

          const event = queue.shift();
          if (event) {
            await stream.writeSSE({
              id: String(event.seq),
              event: event.type,
              data: JSON.stringify(event),
            });
            lastHeartbeat = Date.now();
            continue;
          }

          if (Date.now() - lastHeartbeat >= eventBus.heartbeatIntervalMs) {
            await stream.write(": heartbeat\n\n");
            lastHeartbeat = Date.now();
          }

          await stream.sleep(100);
        }
      } finally {
        unsubscribe();
        await stream.close().catch(() => undefined);
      }
    });
  });
}
