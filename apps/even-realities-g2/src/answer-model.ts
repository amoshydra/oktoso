import type {
  AnswerChoice,
  PendingQuestion,
  QuestionPrompt,
  SendAnswer,
} from "@amoshydra/oktoso-contracts";
import { clampLine, wrapText } from "@amoshydra/oktoso-wearable-core";

export type AnswerAction =
  | "type"
  | "more"
  | "read"
  | "attention"
  | "phone"
  | "send"
  | "cancel";

export type AnswerRow =
  | { kind: "choice"; label: string; choice: AnswerChoice }
  | { kind: "action"; label: string; action: AnswerAction };

export function buildAnswerRows(
  question: PendingQuestion,
  prompt: QuestionPrompt,
): AnswerRow[] {
  if (prompt.attentionID) {
    return [
      { kind: "action", action: "attention", label: "Answer in Inbox" },
      { kind: "action", action: "read", label: "Read chat" },
    ];
  }

  if (prompt.questions.length > 1) {
    return [
      { kind: "action", action: "phone", label: "Answer on phone" },
      { kind: "action", action: "more", label: "More" },
      { kind: "action", action: "read", label: "Read chat" },
    ];
  }

  const rows: AnswerRow[] = question.choices
    .slice(0, 6)
    .map((choice) => ({
      kind: "choice" as const,
      label: clampLine(choice.label, 54),
      choice,
    }));

  if (question.allowsFreeText) {
    rows.push({ kind: "action", action: "type", label: "Type answer" });
  }
  rows.push({ kind: "action", action: "more", label: "More" });
  rows.push({ kind: "action", action: "read", label: "Read chat" });
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
