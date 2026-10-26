import type { Hono } from "hono";
import {
  zCreateSessionInput,
  zMessagesQuery,
  zSendInput,
  zSessionListQuery,
} from "@agent-hub/contracts";
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

  app.post("/api/v1/sessions", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zCreateSessionInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid create-session input", {
        issues: parsed.error.issues,
      });
    }
    const session = await sessions.create(parsed.data);
    return c.json(session, 201);
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

  app.post("/api/v1/sessions/:ref/messages", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zSendInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid message input", {
        issues: parsed.error.issues,
      });
    }
    const result = await sessions.sendMessage(c.req.param("ref"), parsed.data);
    return c.json(result, 202);
  });

  app.post("/api/v1/sessions/:ref/interrupt", async (c) => {
    await sessions.interrupt(c.req.param("ref"));
    return c.body(null, 204);
  });

  app.post("/api/v1/sessions/:ref/read", async (c) => {
    const ref = c.req.param("ref");
    if (!ref) throw notFound("Session not found");
    await sessions.markRead(ref);
    return c.body(null, 204);
  });

  app.get("/api/v1/providers/:providerID/options", async (c) => {
    return c.json(await sessions.options(c.req.param("providerID")));
  });
}
