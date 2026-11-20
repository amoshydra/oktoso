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
  | "phone"
  | "read"
  | "stop"
  | "send"
  | "cancel";

export type AnswerRow =
  | { kind: "choice"; label: string; choice: AnswerChoice }
  | { kind: "action"; label: string; action: AnswerAction };

export interface AnswerRowOptions {
  /** The hub has a usable transcription endpoint. */
  voice?: boolean;
  /** The hub has a usable reply model for candidate answers. */
  suggested?: boolean;
  /** The chat is showing a recoverable failure the user can inspect. */
  failure?: boolean;
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

export function buildAnswerRows(
  question: PendingQuestion,
  prompt: QuestionPrompt,
  options: AnswerRowOptions = {},
): AnswerRow[] {
  if (prompt.attentionID) {
    return [
      { kind: "action", action: "attention", label: "Answer in Inbox" },
      ...failureRows(options),
      { kind: "action", action: "read", label: "Read chat" },
      { kind: "action", action: "stop", label: "Stop agent" },
    ];
  }

  if (prompt.questions.length > 1) {
    return [
      { kind: "action", action: "phone", label: "Answer on phone" },
      ...failureRows(options),
      { kind: "action", action: "read", label: "Read chat" },
      { kind: "action", action: "stop", label: "Stop agent" },
    ];
  }

  const choices: AnswerRow[] = question.choices
    .filter((choice) => !isFreeAnswerSentinel(choice))
    .slice(0, 6)
    .map((choice) => ({
      kind: "choice" as const,
      label: clampLine(choice.label, 54),
      choice,
    }));

  // A sentinel is a free-text escape, not a choice. When it is the only choice
  // the question is effectively free-form.
  const freeRow: AnswerRow | undefined = question.choices.some(
    isFreeAnswerSentinel,
  )
    ? { kind: "action", action: "type", label: "Type your own answer" }
    : question.allowsFreeText
      ? { kind: "action", action: "type", label: "Type answer" }
      : undefined;
  const voiceRow: AnswerRow | undefined = options.voice
    ? { kind: "action", action: "voice", label: "Speak answer" }
    : undefined;
  const suggestedRow: AnswerRow | undefined = options.suggested
    ? { kind: "action", action: "suggested", label: "Suggested answers" }
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
  rows.push({ kind: "action", action: "read", label: "Read chat" });
  rows.push({ kind: "action", action: "stop", label: "Stop agent" });
  return rows;
}

function failureRows(options: AnswerRowOptions): AnswerRow[] {
  return options.failure
    ? [{ kind: "action", action: "failure", label: "Failure ›" }]
    : [];
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
    lines.push(
      clampLine(`+${prompt.questions.length - 1} more on phone`, 54),
    );
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
