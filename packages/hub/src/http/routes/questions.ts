import type { Hono } from "hono";
import type { AttentionService } from "../../services/attention-service";
import type { QuestionService } from "../../services/question-service";
import type { AppEnv } from "../types";
import { notFound } from "../../domain/errors";

export function registerQuestionRoutes(
  app: Hono<AppEnv>,
  questions: QuestionService,
  attention: AttentionService,
): void {
  app.get("/api/v1/sessions/:ref/question", async (c) => {
    const ref = c.req.param("ref");
    if (!ref) throw notFound("Session not found");
    const prompt = await questions.get(ref);
    if (!prompt) return c.json({ data: null });

    // A provider-native question form is authoritative. If one exists for the
    // session, the glasses route to the inbox form instead of answering text.
    const attentionPage = await attention.list({
      sessionRef: ref,
      type: "question",
    });
    const attentionID = attentionPage.data[0]?.id;
    return c.json({
      data: attentionID ? { ...prompt, attentionID } : prompt,
    });
  });
}
