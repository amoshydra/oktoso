import type { Hono } from "hono";
import { z } from "zod";
import {
  zBranchSwitchInput,
  zCreateSessionInput,
  zForkInput,
  zInboxDeliveryInput,
  zMessagesQuery,
  zReplyMode,
  zRetryInput,
  zSendInput,
  zSessionListQuery,
  zSessionRenameInput,
  zSessionSelectionInput,
  type Message,
  type ReplyAuditQuestion,
} from "@amoshydra/oktoso-contracts";
import type { SessionService } from "../../services/session-service";
import type { QuestionService } from "../../services/question-service";
import {
  replyAuditQuestion,
  type ReplyService,
} from "../../services/reply-service";
import type { SessionActions } from "../../services/session-actions";
import {
  exportFilename,
  exportJson,
  exportMarkdown,
} from "../../services/session-export";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

export function registerSessionRoutes(
  app: Hono<AppEnv>,
  sessions: SessionService,
  replies: ReplyService,
  actions: SessionActions,
  questions: QuestionService,
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

  app.get("/api/v1/sessions/:ref/export", async (c) => {
    const ref = c.req.param("ref");
    const format = c.req.query("format") === "json" ? "json" : "md";
    const session = await sessions.get(ref);

    const collected: Message[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await sessions.messages(ref, {
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      collected.push(...result.data);
      cursor = result.cursor.next ?? undefined;
      if (!cursor) break;
    }
    // Pages arrive newest-first; the export reads oldest-first.
    const messages = [...collected].reverse();
    const input = { session, messages, exportedAt: Date.now() };
    const body = format === "json" ? exportJson(input) : exportMarkdown(input);

    c.header(
      "Content-Disposition",
      `attachment; filename="${exportFilename(session, format)}"`,
    );
    return c.body(body, 200, {
      "Content-Type":
        format === "json"
          ? "application/json; charset=utf-8"
          : "text/markdown; charset=utf-8",
    });
  });

  app.get("/api/v1/sessions/:ref", async (c) => {
    return c.json(await sessions.get(c.req.param("ref")));
  });

  app.patch("/api/v1/sessions/:ref", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zSessionRenameInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid session rename input", {
        issues: parsed.error.issues,
      });
    }
    return c.json(await sessions.rename(c.req.param("ref"), parsed.data.title));
  });

  app.get("/api/v1/sessions/:ref/reply-options", async (c) => {
    const ref = c.req.param("ref");
    const mode = zReplyMode.safeParse(c.req.query("mode") ?? "reply");
    if (!mode.success) throw badRequest("Invalid reply-option mode");
    const questionId = z
      .string()
      .min(1)
      .optional()
      .safeParse(c.req.query("questionId"));
    if (!questionId.success) {
      throw badRequest("Invalid reply-option question id");
    }
    const surface = c.req.query("surface") === "g2" ? "g2" : "web";
    let questionOverride: ReplyAuditQuestion | undefined;
    if (questionId.data !== undefined) {
      const prompt = await questions.get(ref);
      const pending = prompt?.questions.find(
        (question) => question.id === questionId.data,
      );
      if (!pending) {
        throw badRequest("Unknown question id for the pending prompt");
      }
      questionOverride = replyAuditQuestion(pending);
    }
    return c.json(
      await replies.list(ref, mode.data, surface, questionOverride),
    );
  });

  app.get("/api/v1/sessions/:ref/lineage", async (c) =>
    c.json({ data: await sessions.lineage(c.req.param("ref")) }),
  );

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

  app.get("/api/v1/sessions/:ref/inbox", async (c) => {
    return c.json({ data: await sessions.listInbox(c.req.param("ref")) });
  });

  app.patch("/api/v1/sessions/:ref/inbox/:itemId", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zInboxDeliveryInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid inbox delivery", { issues: parsed.error.issues });
    }
    await sessions.updateInbox(
      c.req.param("ref"),
      c.req.param("itemId"),
      parsed.data.delivery,
    );
    return c.body(null, 204);
  });

  app.delete("/api/v1/sessions/:ref/inbox/:itemId", async (c) => {
    await sessions.deleteInbox(c.req.param("ref"), c.req.param("itemId"));
    return c.body(null, 204);
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
