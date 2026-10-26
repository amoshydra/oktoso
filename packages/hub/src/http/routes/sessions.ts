import type { Hono } from "hono";
import { zMessagesQuery, zSessionListQuery } from "@agent-hub/contracts";
import type { SessionService } from "../../services/session-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

export function registerSessionRoutes(
  app: Hono<AppEnv>,
  sessions: SessionService,
): void {
  app.get("/api/v1/sessions", async (c) => {
    const parsed = zSessionListQuery.safeParse(c.req.query());
    if (!parsed.success) {
      throw badRequest("Invalid session query", {
        issues: parsed.error.issues,
      });
    }
    return c.json(await sessions.list(parsed.data));
  });

  app.get("/api/v1/sessions/:ref", async (c) => {
    return c.json(await sessions.get(c.req.param("ref")));
  });

  app.get("/api/v1/sessions/:ref/messages", async (c) => {
    const parsed = zMessagesQuery.safeParse(c.req.query());
    if (!parsed.success) {
      throw badRequest("Invalid message query", {
        issues: parsed.error.issues,
      });
    }
    return c.json(await sessions.messages(c.req.param("ref"), parsed.data));
  });

  app.post("/api/v1/sessions/:ref/read", async (c) => {
    const ref = c.req.param("ref");
    if (!ref) throw notFound("Session not found");
    await sessions.markRead(ref);
    return c.body(null, 204);
  });
}
