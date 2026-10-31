import type { Hono } from "hono";
import {
  zCreateSessionInput,
  zMessagesQuery,
  zReplyMode,
  zSendInput,
  zSessionListQuery,
} from "@agent-hub/contracts";
import type { SendResult } from "@agent-hub/contracts";
import type { SessionService } from "../../services/session-service";
import type { ReplyService } from "../../services/reply-service";
import type { QuestionService } from "../../services/question-service";
import type { IdempotencyService } from "../../services/idempotency";
import type { AppEnv } from "../types";
import { badRequest, conflict, notFound } from "../../domain/errors";

export function registerSessionRoutes(
  app: Hono<AppEnv>,
  sessions: SessionService,
  replies: ReplyService,
  questions: QuestionService,
  idempotency: IdempotencyService,
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
    const cacheKey = idempotencyKey ? `${ref}:${idempotencyKey}` : undefined;

    if (cacheKey) {
      const cached = await idempotency.get(cacheKey);
      if (cached !== undefined) {
        return c.json(cached as SendResult, 202);
      }
    }

    const answer = parsed.data.answer;
    if (answer) {
      const prompt = await questions.get(ref);
      if (!prompt) {
        throw conflict("This question is no longer pending", {
          reason: "question_resolved",
        });
      }
      const current = prompt.questions.find(
        (question) => question.id === answer.questionId,
      );
      if (
        !current ||
        prompt.messageId !== answer.messageId ||
        prompt.revision !== answer.revision
      ) {
        throw conflict("Question changed", {
          reason: "question_changed",
          current: prompt,
        });
      }
    }

    // `answer` is hub-only metadata; providers receive the plain message.
    const result = await sessions.sendMessage(ref, { text: parsed.data.text });
    if (cacheKey) await idempotency.set(cacheKey, result);
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
