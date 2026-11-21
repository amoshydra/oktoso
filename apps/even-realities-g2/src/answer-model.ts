import type {
  AnswerChoice,
  AssistantView,
  PendingQuestion,
  QuestionPrompt,
  SendAnswer,
} from "@amoshydra/oktoso-contracts";
import { clampLine, wrapText } from "@amoshydra/oktoso-wearable-core";

export type AnswerAction =
  | "type"
  | "voice"
  | "suggested"
  | "failure"
  | "attention"
  | "batch"
  | "phone"
  | "read"
  | "stop"
  | "send"
  | "cancel"
  | "back";

export type AnswerRow =
  | { kind: "choice"; label: string; choice: AnswerChoice }
  | { kind: "action"; label: string; action: AnswerAction }
  | { kind: "answer"; label: string; questionIndex: number };

export interface AnswerRowOptions {
  /** The hub has a usable transcription endpoint. */
  voice?: boolean;
  /** The hub has a usable reply model for candidate answers. */
  suggested?: boolean;
  /** The chat is showing a recoverable failure the user can inspect. */
  failure?: boolean;
}

/**
 * What the suggestions screen will do with a tapped candidate: send it, or
 * store it as one batch question's answer.
 */
export type SuggestionTarget =
  | { kind: "answer" }
  | { kind: "batch"; questionId: string };

/** The question a suggestions request must target, if any. */
export function suggestionQuestionId(
  target: SuggestionTarget | undefined,
): string | undefined {
  return target?.kind === "batch" ? target.questionId : undefined;
}

/**
 * A provider choice that stands for "none of these": its label is an
 * instruction to type, not an answer. Sending the literal sentinel would tell
 * the agent "Other" instead of what the user meant.
 */
/**
 * Match the whole label, not a prefix: "Other database" is a real choice,
 * "Other" is the free-answer escape.
 */
const FREE_ANSWER_SENTINEL =
  /^(?:other|something else|custom|none of these|type (?:your|an) own(?: answer)?)\s*[.!?…]*$/i;

export function isFreeAnswerSentinel(choice: AnswerChoice): boolean {
  return (
    FREE_ANSWER_SENTINEL.test(choice.label.trim()) ||
    FREE_ANSWER_SENTINEL.test(choice.text.trim())
  );
}

/** Candidate answers are model text; the answer screen hides them when the
 * reply model is disabled or missing a base URL/model. */
export function replyModelConfigured(view: AssistantView | undefined): boolean {
  const reply = view?.reply;
  return Boolean(
    reply?.enabled && reply.baseUrl.trim() && reply.model.trim(),
  );
}

/**
 * Text-only row grammar: numbered values are answers, chevrons open a page or
 * an action. The host gives every row the same chrome, so this is the only
 * distinction available in monochrome.
 */
const ACTION_PREFIX = "›  ";

export function actionRow(action: AnswerAction, label: string): AnswerRow {
  return { kind: "action", action, label: clampLine(`${ACTION_PREFIX}${label}`, 54) };
}

export function buildAnswerRows(
  question: PendingQuestion,
  prompt: QuestionPrompt,
  options: AnswerRowOptions = {},
): AnswerRow[] {
  if (prompt.attentionID) {
    return [
      actionRow("attention", "Answer in Inbox"),
      ...failureRows(options),
    ];
  }

  if (prompt.questions.length > 1) {
    // A batch can be answered one question at a time on the glass, or collected
    // in one phone form. Name both paths; the batch screen keeps the phone as a
    // fallback for the whole batch.
    const count = prompt.questions.length;
    return [
      actionRow("batch", `Answer ${count} questions`),
      actionRow("phone", `Answer ${count} questions on phone`),
      ...failureRows(options),
    ];
  }

  const choices: AnswerRow[] = question.choices
    .filter((choice) => !isFreeAnswerSentinel(choice))
    .slice(0, 6)
    .map((choice, index) => ({
      kind: "choice" as const,
      label: clampLine(`${index + 1}  ${choice.label}`, 54),
      choice,
    }));

  // A sentinel is a free-text escape, not a choice. When it is the only choice
  // the question is effectively free-form.
  const freeRow: AnswerRow | undefined = question.choices.some(
    isFreeAnswerSentinel,
  )
    ? actionRow("type", "Type your own answer")
    : question.allowsFreeText
      ? actionRow("type", "Type answer")
      : undefined;
  const voiceRow: AnswerRow | undefined = options.voice
    ? actionRow("voice", "Speak answer")
    : undefined;
  const suggestedRow: AnswerRow | undefined = options.suggested
    ? actionRow("suggested", "Suggested answers")
    : undefined;

  const rows: AnswerRow[] = [...choices];
  if (choices.length === 0) {
    // Free-form: voice is the fastest path, and no choice sits under the first
    // tap, so it is safe to lead with it.
    if (voiceRow) rows.push(voiceRow);
    if (freeRow) rows.push(freeRow);
  } else {
    // With choices present the first tap must never open the microphone.
    if (freeRow) rows.push(freeRow);
    if (voiceRow) rows.push(voiceRow);
  }
  if (suggestedRow) rows.push(suggestedRow);
  rows.push(...failureRows(options));
  return rows;
}

function failureRows(options: AnswerRowOptions): AnswerRow[] {
  return options.failure ? [actionRow("failure", "Failure")] : [];
}

/**
 * One question of a batch. Choices are numbered from 1 for this question; the
 * action rows below the fold keep the phone fallback and Back reachable on
 * every step. A sentinel is a free-text escape here too, and voice follows the
 * free-text row so the first tap never opens the microphone by accident.
 */
export function buildBatchQuestionRows(
  question: PendingQuestion,
  options: AnswerRowOptions = {},
): AnswerRow[] {
  const choices: AnswerRow[] = question.choices
    .filter((choice) => !isFreeAnswerSentinel(choice))
    .slice(0, 6)
    .map((choice, index) => ({
      kind: "choice" as const,
      label: clampLine(`${index + 1}  ${choice.label}`, 54),
      choice,
    }));

  const rows: AnswerRow[] = [...choices];
  const sentinel = question.choices.some(isFreeAnswerSentinel);
  if (question.allowsFreeText || sentinel) {
    rows.push(actionRow("type", "Type answer"));
  }
  if (options.voice) rows.push(actionRow("voice", "Speak answer"));
  if (options.suggested) {
    rows.push(actionRow("suggested", "Suggested answers"));
  }
  rows.push(actionRow("phone", "Answer on phone"));
  rows.push(actionRow("back", "Back"));
  return rows;
}

export type BatchStep =
  | { screen: "batch"; index: number }
  | { screen: "batch-review" };

/**
 * The step after answering question `index`. The flow only advances after an
 * answer, so the last question lands on review with every entry present.
 */
export function batchStepAfter(index: number, total: number): BatchStep {
  const next = index + 1;
  return next > 0 && next < total
    ? { screen: "batch", index: next }
    : { screen: "batch-review" };
}

/** The first question without an answer, or undefined for a complete batch. */
export function firstMissingBatchAnswer(
  answers: Array<{ text: string; choice?: AnswerChoice } | undefined>,
): number | undefined {
  const index = answers.findIndex(
    (answer) => (answer?.choice?.text ?? answer?.text ?? "").trim() === "",
  );
  return index === -1 ? undefined : index;
}

/**
 * Review rows double as edit targets: the number leads the answer, and the
 * last two rows send the batch or step back into the questions.
 */
export function buildBatchReviewRows(
  answers: Array<{ text: string }>,
): AnswerRow[] {
  const rows: AnswerRow[] = answers.map((answer, index) => ({
    kind: "answer" as const,
    label: clampLine(
      `${index + 1}  ${answer.text.trim() || "No answer yet"}`,
      54,
    ),
    questionIndex: index,
  }));
  rows.push(actionRow("send", "Send all"));
  rows.push(actionRow("back", "Back"));
  return rows;
}

export function buildAnswerSummary(
  question: PendingQuestion,
  prompt?: QuestionPrompt,
): string {
  const multiple = (prompt?.questions.length ?? 0) > 1;
  const prefix = multiple ? "Q1  " : "Q  ";
  const lines = wrapText(`${prefix}${question.text}`, 54, 2);
  if (!multiple && lines.length < 2 && question.context) {
    lines.push(clampLine(question.context, 54));
  }
  if (
    multiple &&
    lines.length < 2 &&
    prompt &&
    prompt.questions.length > 1
  ) {
    lines.push(clampLine(`+${prompt.questions.length - 1} more`, 54));
  }
  return lines.join("\n");
}

export interface BatchAnswerDraft {
  questionId: string;
  text: string;
  choice?: AnswerChoice;
}

export function composeBatchAnswer(drafts: BatchAnswerDraft[]): string {
  return drafts
    .map((draft, index) => `${index + 1}. ${draft.text.trim()}`)
    .join("\n");
}

export function buildBatchAnswerMetadata(
  prompt: QuestionPrompt,
  drafts: BatchAnswerDraft[],
): SendAnswer[] {
  return drafts.map((draft) => ({
    questionId: draft.questionId,
    messageId: prompt.messageId,
    revision: prompt.revision,
    ...(draft.choice ? { choiceId: draft.choice.id } : {}),
    source: draft.choice
      ? draft.choice.kind === "boolean"
        ? "boolean"
        : "choice"
      : "text",
  }));
}

export function buildAnswerMetadata(
  prompt: QuestionPrompt,
  choice?: AnswerChoice,
): SendAnswer | undefined {
  const question = prompt.questions[0];
  if (!question) return undefined;
  return {
    questionId: question.id,
    messageId: prompt.messageId,
    revision: prompt.revision,
    ...(choice ? { choiceId: choice.id } : {}),
    source: choice
      ? choice.kind === "boolean"
        ? "boolean"
        : "choice"
      : "text",
  };
}
