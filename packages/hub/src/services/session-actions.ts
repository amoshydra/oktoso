import { createHash } from "node:crypto";
import type { SendInput, SendResult } from "@amoshydra/oktoso-contracts";
import { badRequest, conflict } from "../domain/errors";
import type { IdempotencyService } from "./idempotency";
import type { QuestionService } from "./question-service";
import type { SessionService } from "./session-service";

function requestHash(input: SendInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: input.text,
        attachments: input.attachments ?? [],
        answer: input.answer ?? null,
        answers: input.answers ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Shared send path for the REST route and the MCP surface. It owns answer
 * validation and idempotency so both transports behave the same.
 */
export class SessionActions {
  constructor(
    private readonly sessions: SessionService,
    private readonly questions: QuestionService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async send(
    ref: string,
    input: SendInput,
    idempotencyKey?: string,
  ): Promise<SendResult> {
    const cacheKey = idempotencyKey ? `${ref}:${idempotencyKey}` : undefined;
    const hash = requestHash(input);
    if (cacheKey) {
      const cached = await this.idempotency.get(cacheKey, hash);
      if (cached !== undefined) return cached as SendResult;
    }

    const answer = input.answer;
    const answers = input.answers;
    if (answer && answers) {
      throw badRequest("Use either answer or answers, not both");
    }
    if (answers) {
      const prompt = await this.questions.get(ref);
      if (!prompt) {
        throw conflict("This question is no longer pending", {
          reason: "question_resolved",
        });
      }
      if (
        answers.some(
          (item) =>
            item.messageId !== prompt.messageId ||
            item.revision !== prompt.revision,
        )
      ) {
        throw conflict("Question changed", {
          reason: "question_changed",
          current: prompt,
        });
      }
      const known = new Set(prompt.questions.map((question) => question.id));
      const seen = new Set<string>();
      for (const item of answers) {
        if (!known.has(item.questionId)) {
          throw conflict("Question changed", {
            reason: "question_changed",
            current: prompt,
          });
        }
        if (seen.has(item.questionId)) {
          throw badRequest("Duplicate question in answer batch");
        }
        seen.add(item.questionId);
      }
      const missing = prompt.questions.filter(
        (question) => !seen.has(question.id),
      );
      if (missing.length > 0) {
        throw conflict("Answer every question in this batch", {
          reason: "question_incomplete",
          current: prompt,
        });
      }
    } else if (answer) {
      const prompt = await this.questions.get(ref);
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
    const send = () =>
      this.sessions.sendMessage(ref, {
        text: input.text,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });
    const result = cacheKey
      ? await this.idempotency.run(cacheKey, hash, send)
      : await send();
    this.questions.invalidate(ref);
    return result;
  }
}
