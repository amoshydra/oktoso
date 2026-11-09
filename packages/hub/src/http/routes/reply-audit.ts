import type { Hono } from "hono";
import {
  zReplyFeedbackInput,
  zReplyMode,
} from "@amoshydra/oktoso-contracts";
import type { ReplyFeedbackStore } from "../../services/reply-feedback-store";
import type { ReplyService } from "../../services/reply-service";
import { badRequest } from "../../domain/errors";
import type { AppEnv } from "../types";

export function registerReplyAuditRoutes(
  app: Hono<AppEnv>,
  replies: ReplyService,
  feedback: ReplyFeedbackStore,
): void {
  app.get("/api/v1/sessions/:ref/reply-audit", async (c) => {
    const mode = zReplyMode.safeParse(c.req.query("mode") ?? "reply");
    if (!mode.success) throw badRequest("Invalid reply-audit mode");
    return c.json(await replies.audit(c.req.param("ref"), mode.data));
  });

  app.get("/api/v1/reply-feedback", async (c) => {
    const raw = c.req.query("limit");
    const limit = raw === undefined ? undefined : Number(raw);
    if (limit !== undefined && !Number.isFinite(limit)) {
      throw badRequest("Invalid feedback limit");
    }
    return c.json({ data: await feedback.list(limit) });
  });

  app.post("/api/v1/reply-feedback", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zReplyFeedbackInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid reply feedback", {
        issues: parsed.error.issues,
      });
    }
    return c.json(await feedback.append(parsed.data), 201);
  });

  app.get("/api/v1/reply-feedback/export", async (c) => {
    const payload = await feedback.export();
    return c.body(payload, 200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reply-feedback.jsonl"',
    });
  });
}
