import type { Hono } from "hono";
import {
  zBranchSwitchInput,
  zCreateSessionInput,
  zForkInput,
  zMessagesQuery,
  zReplyMode,
  zRetryInput,
  zSendInput,
  zSessionListQuery,
  zSessionSelectionInput,
} from "@amoshydra/oktoso-contracts";
import type { SessionService } from "../../services/session-service";
import type { ReplyService } from "../../services/reply-service";
import type { SessionActions } from "../../services/session-actions";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

export function registerSessionRoutes(
  app: Hono<AppEnv>,
  sessions: SessionService,
  replies: ReplyService,
  actions: SessionActions,
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

  app.get("/api/v1/sessions/:ref/reply-options", async (c) => {
    const ref = c.req.param("ref");
    const mode = zReplyMode.safeParse(c.req.query("mode") ?? "reply");
    if (!mode.success) throw badRequest("Invalid reply-option mode");
    return c.json(await replies.list(ref, mode.data));
  });

  app.get("/api/v1/sessions/:ref/branches", async (c) => {
    const ref = c.req.param("ref");
    return c.json({ data: await sessions.listBranches(ref) });
  });

  app.post("/api/v1/sessions/:ref/branches", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zBranchSwitchInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid branch switch input", {
        issues: parsed.error.issues,
      });
    }
    const ref = c.req.param("ref");
    await sessions.switchBranch(ref, parsed.data.siblingId);
    return c.json({ accepted: true });
  });

  app.post("/api/v1/sessions/:ref/retry", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zRetryInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid retry input", { issues: parsed.error.issues });
    }
    const result = await sessions.retryMessage(
      c.req.param("ref"),
      parsed.data.messageId,
    );
    return c.json(result, 202);
  });

  app.post("/api/v1/sessions/:ref/fork", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zForkInput.safeParse(body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid fork input", { issues: parsed.error.issues });
    }
    const session = await sessions.fork(c.req.param("ref"), parsed.data);
    return c.json({ data: session });
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
    const ref = c.req.param("ref");
    const idempotencyKey = c.req.header("Idempotency-Key")?.trim();
    const result = await actions.send(ref, parsed.data, idempotencyKey);
    return c.json(result, 202);
  });

  app.post("/api/v1/sessions/:ref/selection", async (c) => {
    const ref = c.req.param("ref");
    if (!ref) throw notFound("Session not found");
    const body = await c.req.json().catch(() => undefined);
    const parsed = zSessionSelectionInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid session selection", {
        issues: parsed.error.issues,
      });
    }
    if (!parsed.data.model && !parsed.data.agent) {
      throw badRequest("A model or agent is required");
    }
    return c.json(await sessions.setSessionOptions(ref, parsed.data));
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
