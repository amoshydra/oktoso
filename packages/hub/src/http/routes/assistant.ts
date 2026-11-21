import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AssistantEvent } from "@amoshydra/oktoso-contracts";
import {
  zAssistantActionDecision,
  zAssistantMessageInput,
  zAssistantThreadInput,
  zAssistantThreadUpdate,
} from "@amoshydra/oktoso-contracts";
import type { AssistantService } from "../../services/assistant-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

const HEARTBEAT_MS = 15_000;

export function registerAssistantRoutes(
  app: Hono<AppEnv>,
  assistant: AssistantService,
): void {
  app.get("/api/v1/assistant/status", (c) =>
    c.json({ data: assistant.status() }),
  );

  app.post("/api/v1/assistant/threads", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAssistantThreadInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid thread input", { issues: parsed.error.issues });
    }
    return c.json({ data: await assistant.createThread(parsed.data) }, 201);
  });

  app.get("/api/v1/assistant/threads", (c) => {
    const sessionRef = c.req.query("sessionRef")?.trim();
    return c.json(assistant.listThreads(sessionRef ? { sessionRef } : {}));
  });

  app.get("/api/v1/assistant/threads/:id", (c) => {
    return c.json({ data: assistant.getThread(c.req.param("id")) });
  });

  app.patch("/api/v1/assistant/threads/:id", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAssistantThreadUpdate.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid thread update", { issues: parsed.error.issues });
    }
    return c.json({
      data: await assistant.setThreadModel(c.req.param("id"), parsed.data.model),
    });
  });

  app.get("/api/v1/assistant/models", async (c) => {
    return c.json({ data: await assistant.listModels() });
  });

  app.delete("/api/v1/assistant/threads/:id", async (c) => {
    await assistant.deleteThread(c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/v1/assistant/threads/:id/messages", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAssistantMessageInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid message input", { issues: parsed.error.issues });
    }
    const result = await assistant.postMessage(c.req.param("id"), parsed.data);
    return c.json({ data: result }, 202);
  });

  app.post("/api/v1/assistant/threads/:id/turns/:turnId/action", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAssistantActionDecision.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid action decision", { issues: parsed.error.issues });
    }
    const turn = await assistant.decide(
      c.req.param("id"),
      c.req.param("turnId"),
      parsed.data,
    );
    return c.json({ data: turn });
  });

  app.post("/api/v1/assistant/runs/:id/stop", (c) => {
    return c.json({ data: assistant.stop(c.req.param("id")) });
  });

  app.get("/api/v1/assistant/runs/:id/events", (c) => {
    const runId = c.req.param("id");
    const rawSince = c.req.query("since");
    const since = rawSince === undefined ? 0 : Number(rawSince);
    if (!Number.isInteger(since) || since < 0) {
      throw badRequest("since must be a non-negative integer");
    }
    if (!assistant.getRun(runId)) throw notFound("Run not found");

    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    return streamSSE(c, async (stream) => {
      await stream.write("retry: 3000\n\n");

      const queue: AssistantEvent[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = assistant.subscribe(runId, since, (event) => {
        queue.push(event);
        wake?.();
      });
      if (!unsubscribe) return;

      stream.onAbort(unsubscribe);
      try {
        while (!stream.aborted && !stream.closed) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            });
            if (
              event.type === "done" ||
              event.type === "error" ||
              event.type === "action"
            ) {
              break;
            }
            continue;
          }
          const waited = new Promise<void>((resolve) => {
            wake = resolve;
          });
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            wake?.();
          }, HEARTBEAT_MS);
          await waited;
          clearTimeout(timer);
          wake = undefined;
          if (timedOut && queue.length === 0 && !stream.aborted) {
            await stream.write(": keep-alive\n\n");
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
