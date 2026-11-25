import type { MessagePart } from "@amoshydra/oktoso-contracts";

export type QuestionToolPart = Extract<MessagePart, { type: "tool" }>;

export interface AnsweredQuestion {
  /** Short label the provider shows above the prompt, when it gives one. */
  header?: string;
  question: string;
  /** Selected option labels or typed answers; empty when the provider skipped it. */
  answers: string[];
}

export interface AnsweredQuestionPart {
  questions: AnsweredQuestion[];
  /** When the user answered, from the tool's completion time. */
  completedAt?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function answerList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function questionsFromInput(input: unknown): Array<{ header?: string; question: string }> {
  const raw = record(input);
  if (!raw) return [];
  const items = Array.isArray(raw.questions)
    ? raw.questions
    : typeof raw.question === "string"
      ? [raw]
      : [];
  return items
    .map((item) => record(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const question = text(item.question);
      const header = text(item.header);
      if (!question) return undefined;
      return { ...(header ? { header } : {}), question };
    })
    .filter((item): item is { header?: string; question: string } => Boolean(item));
}

/**
 * Read the answer a provider recorded on a `question` tool call.
 *
 * OpenCode stores the prompt in the tool input and the selections in
 * `metadata.answers`: one inner array per question, so a single question with
 * multiple selections is `[["A", "B"]]` and two single answers are
 * `[["A"], ["B"]]`. Older providers may send a flat string array or a single
 * `question` object, which are normalized here.
 *
 * Returns undefined for pending questions and for every other tool, so they
 * keep their existing activity-step rendering.
 */
export function answeredQuestions(
  part: QuestionToolPart,
): AnsweredQuestionPart | undefined {
  if (part.name.trim().toLowerCase() !== "question") return undefined;
  const questions = questionsFromInput(part.input);
  if (questions.length === 0) return undefined;

  const raw = record(part.metadata)?.answers;
  let answers: string[][];
  if (Array.isArray(raw) && raw.length === questions.length) {
    answers = raw.map((value) => answerList(value));
  } else if (questions.length === 1) {
    answers = [answerList(raw)];
  } else {
    answers = questions.map(() => []);
  }
  if (answers.every((list) => list.length === 0)) return undefined;

  return {
    questions: questions.map((question, index) => ({
      ...question,
      answers: answers[index] ?? [],
    })),
    ...(part.completedAt !== undefined ? { completedAt: part.completedAt } : {}),
  };
}
