import type { Hono } from "hono";
import type { AttentionService } from "../../services/attention-service";
import type { QuestionService } from "../../services/question-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

const MAX_SUMMARY_REFS = 10;

function summaryRefs(values: string[] | undefined): string[] {
  const refs = (values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

export function registerQuestionRoutes(
  app: Hono<AppEnv>,
  questions: QuestionService,
  attention: AttentionService,
): void {
  app.get("/api/v1/questions", async (c) => {
    const refs = summaryRefs(c.req.queries("ref"));
    if (refs.length === 0) {
      throw badRequest("At least one session ref is required");
    }
    if (refs.length > MAX_SUMMARY_REFS) {
      throw badRequest(`At most ${MAX_SUMMARY_REFS} session refs are allowed`);
    }
    if (refs.some((ref) => ref.length > 256)) {
      throw badRequest("Session ref is too long");
    }

    const [summaryResult, attentionPage] = await Promise.all([
      questions.summaries(refs),
      attention.list({ type: "question" }),
    ]);
    const attentionBySession = new Map(
      attentionPage.data.map((item) => [item.sessionRef, item.id]),
    );
    return c.json({
      data: summaryResult.data.map((summary) => {
        const attentionID = attentionBySession.get(summary.sessionRef);
        return attentionID ? { ...summary, attentionID } : summary;
      }),
      failed: summaryResult.failed,
    });
  });

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
