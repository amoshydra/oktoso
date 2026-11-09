import type { Message } from "@amoshydra/oktoso-contracts";

export interface ToolQuestionChoice {
  label: string;
  description?: string;
}

export interface ToolQuestion {
  header?: string;
  text: string;
  choices: ToolQuestionChoice[];
}

/**
 * A provider `question` tool call is a blocking ask. It is not a text question,
 * so the text question parser cannot see it. Scan newest-first and ignore
 * completed or failed calls.
 */
export interface ToolQuestionMatch {
  message: Message;
  question: ToolQuestion;
}

export function findToolQuestion(
  messages: Message[],
): ToolQuestionMatch | undefined {
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type !== "tool" || part.name !== "question") continue;
      if (part.status === "completed" || part.status === "error") continue;
      const question = parseQuestionToolInput(part.input);
      if (question) return { message, question };
    }
  }
  return undefined;
}

export function extractToolQuestion(
  messages: Message[],
): ToolQuestion | undefined {
  return findToolQuestion(messages)?.question;
}

export function parseQuestionToolInput(
  input: unknown,
): ToolQuestion | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const questions = Array.isArray(record.questions) ? record.questions : [];
  const first = questions[0];
  const source =
    first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : record;
  const text =
    typeof source.question === "string"
      ? source.question
      : typeof record.question === "string"
        ? record.question
        : "";
  if (!text.trim()) return undefined;
  const header =
    typeof source.header === "string" && source.header.trim()
      ? source.header.trim()
      : undefined;
  const rawOptions = Array.isArray(source.options)
    ? source.options
    : Array.isArray(record.options)
      ? record.options
      : [];
  const choices = rawOptions
    .map((option) => {
      if (!option || typeof option !== "object") return undefined;
      const item = option as Record<string, unknown>;
      const label =
        typeof item.label === "string"
          ? item.label
          : typeof item.value === "string"
            ? item.value
            : "";
      if (!label.trim()) return undefined;
      const description =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim()
          : undefined;
      return {
        label: label.trim(),
        ...(description ? { description } : {}),
      };
    })
    .filter(
      (choice): choice is ToolQuestionChoice => Boolean(choice),
    );
  return { text: text.trim(), ...(header ? { header } : {}), choices };
}
