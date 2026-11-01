import { createHash } from "node:crypto";
import type {
  AnswerChoice,
  Message,
  PendingQuestion,
  QuestionPrompt,
  QuestionRisk,
} from "@amoshydra/oktoso-contracts";
import {
  isDestructiveText,
  isSensitiveText,
} from "../lib/destructive";

const COURTESY =
  /^(anything else|does (that|this) make sense|any questions|all good|sound good|thoughts|let me know|thanks|thank you|cheers)\b/i;
const INFORMATION_REQUEST =
  /^(do you know|can you confirm|can you share|can you provide|can you send|do you have|are you able)\b/i;
const AUXILIARY =
  /^(should|shall|do|does|did|can|could|would|will|is|are|was|were|has|have|may|am|is it okay|is it safe|do you want me to)\b/i;
const IMPERATIVE =
  /^(read|fix|run|add|remove|update|implement|test|check|open|close|create|delete|refactor|port|write|review|install|build|deploy|migrate)\b/i;

interface ListGroup {
  start: number;
  end: number;
  items: string[];
}

function messageText(message: Message): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function stripFencedCode(value: string): string {
  return value.replace(/```[\s\S]*?```/g, "\n");
}

function stripNonProseLines(value: string): string {
  return value
    .split("\n")
    .filter((line) => {
      if (/^\s*>/.test(line)) return false;
      if (/^\s*\|/.test(line)) return false;
      if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) return false;
      return true;
    })
    .join("\n");
}

function splitSentences(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return (normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function cleanQuestion(value: string): string {
  return value
    .trim()
    .replace(/^[“"'‘]+/, "")
    .replace(/[”"'’]+$/, "")
    .replace(/^(?:\d+[.)]|[A-Za-z][.)]|[-*•])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function questionCore(value: string): string {
  return value.replace(/^(?:and|also|then|so)\s+/i, "").trim();
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function isDestructive(value: string): boolean {
  return isDestructiveText(value);
}

function isSensitive(value: string): boolean {
  return isSensitiveText(value);
}

function choiceRisk(value: string): {
  destructive: boolean;
  sensitive: boolean;
} {
  return {
    destructive: isDestructive(value),
    sensitive: isSensitive(value),
  };
}

function riskFor(
  question: string,
  choices: AnswerChoice[],
  rawText: string,
): QuestionRisk {
  if (
    isDestructive(question) ||
    isDestructive(rawText) ||
    choices.some((choice) => choice.destructive === true)
  ) {
    return "destructive";
  }
  if (
    isSensitive(question) ||
    isSensitive(rawText) ||
    choices.some((choice) => choice.sensitive === true)
  ) {
    return "sensitive";
  }
  return "normal";
}

function parseListLine(line: string): string | undefined {
  if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) return undefined;
  const match = line.match(
    /^\s*(?:\d+[.)]|[A-Za-z][.)]|[-*•])\s+(.+?)\s*$/,
  );
  const raw = match?.[1];
  if (!raw) return undefined;
  const text = raw
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 100) return undefined;
  return text;
}

function listGroups(lines: string[]): ListGroup[] {
  const groups: ListGroup[] = [];
  let current: ListGroup | undefined;
  let blankRun = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const item = parseListLine(line);
    const questionItem = item
      ? /\?\s*$/.test(item) && !COURTESY.test(item)
      : false;
    if (item && !questionItem) {
      if (!current) {
        current = { start: index, end: index, items: [] };
      }
      current.items.push(item);
      current.end = index;
      blankRun = 0;
      continue;
    }
    if (!line.trim()) {
      blankRun += 1;
      if (current && blankRun > 1) {
        groups.push(current);
        current = undefined;
        blankRun = 0;
      }
      continue;
    }
    if (current) {
      groups.push(current);
      current = undefined;
      blankRun = 0;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function listItemsNearQuestion(
  lines: string[],
  question: string,
): string[] | undefined {
  const questionLine = lines.findIndex((line) =>
    line.includes(question.slice(0, Math.min(32, question.length))),
  );
  if (questionLine < 0) return undefined;

  const groups = listGroups(lines).filter((group) => {
    const distance =
      group.end < questionLine
        ? questionLine - group.end
        : group.start - questionLine;
    return distance <= 3;
  });
  if (groups.length === 0) return undefined;

  const group = groups[groups.length - 1]!;
  if (group.items.length < 2 || group.items.length > 6) return undefined;
  if (group.items.some((item) => item.length < 2 || item.length > 80)) {
    return undefined;
  }

  const questionWords = question.split(/\s+/).filter(Boolean).length;
  const choiceCue =
    /\b(which|choose|pick|option|prefer|either|one of)\b/i.test(question);
  const leadIn = lines
    .slice(Math.max(0, group.start - 2), group.start)
    .join(" ")
    .toLowerCase();
  const looksLikePlan = /\b(plan|steps|next|todo|tasks)\b/.test(leadIn);

  if (!choiceCue && !/:\s*$/.test(question) && AUXILIARY.test(question)) {
    if (group.items.some((item) => item.split(/\s+/).length > 8)) {
      return undefined;
    }
    if (group.items.some((item) => IMPERATIVE.test(item))) {
      return undefined;
    }
    if (looksLikePlan && questionWords <= 8) return undefined;
  }

  return group.items;
}

function inlineAlternatives(question: string): string[] | undefined {
  const patterns = [
    /\b(?:to|use|choose|pick|prefer)\s+([^?]{2,40}?)\s+or\s+([^?]{2,40}?)\?$/i,
    /\b(?:should|shall|do|would|will|can|could)\s+(?:i|we)\s+([^?]{2,40}?)\s+or\s+([^?]{2,40}?)\?$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    const parts = [match[1], match[2]]
      .map((part) => part.trim().replace(/[.,;:]+$/, ""))
      .filter((part) => part.length >= 2);
    if (
      parts.length === 2 &&
      parts.every(
        (part) => part.split(/\s+/).length <= 6 && part.length <= 40,
      )
    ) {
      return parts;
    }
  }
  return undefined;
}

function contextAlternatives(context: string | undefined): string[] | undefined {
  if (!context) return undefined;
  const match =
    context.match(
      /\b(?:i|we|you)\s+can\s+([^.,?]{2,40}?)\s+or\s+([^.,?]{2,40}?)\s*[.!?]?$/i,
    ) ??
    context.match(/\b([^.,?]{2,40}?)\s+or\s+([^.,?]{2,40}?)\s*[.!?]?$/i);
  if (!match?.[1] || !match[2]) return undefined;
  const parts = [match[1], match[2]]
    .map((part) => part.trim().replace(/^(?:i|we|you)\s+can\s+/i, ""))
    .filter((part) => part.length >= 2 && part.split(/\s+/).length <= 6);
  return parts.length === 2 ? parts : undefined;
}

function makeChoice(
  messageID: string,
  questionIndex: number,
  index: number,
  text: string,
  options: {
    kind: "choice" | "boolean";
    source: "explicit" | "heuristic";
    confirm?: boolean;
  },
): AnswerChoice {
  const risk = choiceRisk(text);
  return {
    id: `${messageID}:q${questionIndex}:c${index}`,
    label: truncate(text, 80),
    text,
    kind: options.kind,
    source: options.source,
    ...(options.confirm || risk.destructive
      ? { requiresConfirmation: true }
      : {}),
    ...(risk.destructive ? { destructive: true } : {}),
    ...(risk.sensitive ? { sensitive: true } : {}),
  };
}

function buildQuestion(
  message: Message,
  questionText: string,
  context: string | undefined,
  items: string[] | undefined,
  rawText: string,
  questionIndex: number,
): PendingQuestion | undefined {
  let choices: AnswerChoice[] = [];
  let kind: PendingQuestion["kind"] = "freeform";
  let source: PendingQuestion["source"] = "heuristic";
  let confidence: PendingQuestion["confidence"] = "high";
  const core = questionCore(questionText);

  if (items) {
    choices = items.map((item, index) =>
      makeChoice(message.id, questionIndex, index, item, {
        kind: "choice",
        source: "explicit",
      }),
    );
    kind = "choice";
    source = "explicit";
    confidence = "high";
  } else {
    const alternatives =
      inlineAlternatives(core) ??
      (/\b(which|what|choose|prefer|option)\b/i.test(core)
        ? contextAlternatives(context)
        : undefined);
    if (alternatives) {
      choices = alternatives.map((item, index) =>
        makeChoice(message.id, questionIndex, index, item, {
          kind: "choice",
          source: "heuristic",
        }),
      );
      kind = "choice";
      source = "heuristic";
      confidence = "medium";
    } else if (
      AUXILIARY.test(core) &&
      !INFORMATION_REQUEST.test(core)
    ) {
      const confirm =
        isDestructive(questionText) || isDestructive(rawText);
      choices = [
        makeChoice(message.id, questionIndex, 0, "Yes", {
          kind: "boolean",
          source: "heuristic",
          confirm,
        }),
        makeChoice(message.id, questionIndex, 1, "No", {
          kind: "boolean",
          source: "heuristic",
        }),
      ];
      kind = "boolean";
      source = "heuristic";
      confidence = "high";
    }
  }

  const risk = riskFor(questionText, choices, rawText);
  return {
    id: `${message.id}:q${questionIndex}`,
    text: questionText,
    ...(context ? { context } : {}),
    kind,
    choices,
    allowsFreeText: true,
    allowsVoice: false,
    multiSelect: false,
    risk,
    confidence,
    source,
  };
}

function choiceCueLine(lines: string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line.endsWith(":")) continue;
    if (!/\b(do you want me to|which|choose|pick|select|prefer|option)\b/i.test(line)) {
      continue;
    }
    const next = lines[index + 1];
    if (next && parseListLine(next)) return line;
  }
  return undefined;
}

interface QuestionEntry {
  text: string;
  line: number;
}

function isQuotedQuestion(sentence: string): boolean {
  return /(?:asked|said|wrote|quoted)\s*[:,]?\s*[“"]/i.test(sentence);
}

function questionEntries(lines: string[]): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  const seen = new Set<string>();
  const add = (text: string, line: number) => {
    if (!text || seen.has(text)) return;
    seen.add(text);
    entries.push({ text, line });
  };

  for (const [index, line] of lines.entries()) {
    const item = parseListLine(line);
    if (!item) continue;
    if (!/\?\s*$/.test(item) || COURTESY.test(item)) continue;
    if (isQuotedQuestion(line)) continue;
    add(cleanQuestion(item), index);
  }

  const prose = lines
    .filter(
      (line) =>
        !parseListLine(line) && !/^\s*[-*]\s+\[[ xX]\]/.test(line),
    )
    .join(" ");
  for (const sentence of splitSentences(prose)) {
    const trimmed = sentence.trim();
    if (!/\?\s*$/.test(trimmed) || COURTESY.test(trimmed)) continue;
    if (isQuotedQuestion(trimmed)) continue;
    const text = cleanQuestion(trimmed);
    if (!text) continue;
    const prefix = text.slice(0, Math.min(24, text.length)).toLowerCase();
    const line = lines.findIndex((value) =>
      value.toLowerCase().includes(prefix),
    );
    add(text, line >= 0 ? line : 0);
  }

  return entries.sort((left, right) => left.line - right.line);
}

function multipleChoiceItems(
  lines: string[],
  entry: QuestionEntry,
  nextLine: number,
  previousLine: number,
  groups: ListGroup[],
  used: Set<number>,
): string[] | undefined {
  const after = groups.find(
    (group) =>
      !used.has(group.start) &&
      group.start > entry.line &&
      group.start <= entry.line + 3 &&
      group.end < nextLine,
  );
  const before = groups.find(
    (group) =>
      !used.has(group.start) &&
      group.end < entry.line &&
      entry.line - group.end <= 3 &&
      group.start > previousLine,
  );
  const group = after ?? before;
  if (!group) return undefined;
  if (group.items.length < 2 || group.items.length > 6) return undefined;
  if (group.items.some((item) => item.length < 2 || item.length > 80)) {
    return undefined;
  }
  if (
    group.items.some(
      (item) => /\?\s*$/.test(item) && !COURTESY.test(item),
    )
  ) {
    return undefined;
  }

  const core = questionCore(entry.text);
  const cue =
    /\b(which|choose|pick|prefer|option|one of)\b/i.test(core) ||
    /:\s*$/.test(entry.text);
  if (!cue && AUXILIARY.test(core)) {
    if (group.items.some((item) => IMPERATIVE.test(item))) return undefined;
    if (group.items.some((item) => item.split(/\s+/).length > 8)) {
      return undefined;
    }
  }

  used.add(group.start);
  return group.items;
}

export interface ParseQuestionOptions {
  sessionRef: string;
  now?: number;
  attentionID?: string;
}

export function parseQuestion(
  messages: Message[],
  options: ParseQuestionOptions,
): QuestionPrompt | null {
  const latest = messages[0];
  if (!latest || latest.role !== "assistant" || latest.streaming === true) {
    return null;
  }

  const raw = messageText(latest);
  if (!raw.trim()) return null;

  const forQuestion = stripNonProseLines(stripFencedCode(raw));
  const paragraphs = forQuestion
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  let paragraphIndex = paragraphs.length - 1;
  while (paragraphIndex > 0 && COURTESY.test(paragraphs[paragraphIndex] ?? "")) {
    paragraphIndex -= 1;
  }
  const paragraph = paragraphs[paragraphIndex];
  if (!paragraph) return null;

  const localLines = stripNonProseLines(stripFencedCode(raw)).split("\n");
  const paragraphLines = paragraph.split("\n");
  const entries = questionEntries(paragraphLines);
  const proseParagraph = paragraphLines
    .filter(
      (line) =>
        !parseListLine(line) && !/^\s*[-*]\s+\[[ xX]\]/.test(line),
    )
    .join("\n")
    .trim();
  const sentences = splitSentences(proseParagraph || paragraph);

  let questions: PendingQuestion[];
  if (entries.length > 1) {
    if (entries.length > 20) return null;
    const groups = listGroups(paragraphLines);
    const used = new Set<number>();
    questions = [];
    for (const [index, entry] of entries.entries()) {
      const nextLine = entries[index + 1]?.line ?? paragraphLines.length;
      const previousLine = entries[index - 1]?.line ?? -1;
      const items = multipleChoiceItems(
        paragraphLines,
        entry,
        nextLine,
        previousLine,
        groups,
        used,
      );
      const pending = buildQuestion(
        latest,
        entry.text,
        undefined,
        items,
        raw,
        index,
      );
      if (!pending) return null;
      questions.push(pending);
    }
  } else if (entries.length === 1) {
    const entry = entries[0]!;
    const questionIndex = sentences.findIndex(
      (sentence) => cleanQuestion(sentence) === entry.text,
    );
    const trailing =
      questionIndex >= 0
        ? sentences
            .slice(questionIndex + 1)
            .filter(
              (sentence) =>
                !/^(let me know|thanks|thank you|cheers|please let me know)\b/i.test(
                  sentence,
                ),
            )
        : [];
    if (trailing.length > 2) return null;

    const previous =
      questionIndex > 0 ? sentences[questionIndex - 1]?.trim() : undefined;
    const context =
      previous && previous.length <= 120 && !COURTESY.test(previous)
        ? previous
        : undefined;
    const pending = buildQuestion(
      latest,
      entry.text,
      context,
      listItemsNearQuestion(localLines, entry.text),
      raw,
      0,
    );
    if (!pending) return null;
    questions = [pending];
  } else {
    const question = choiceCueLine(localLines) ?? "";
    if (!question) return null;
    const pending = buildQuestion(
      latest,
      question,
      undefined,
      listItemsNearQuestion(localLines, question),
      raw,
      0,
    );
    if (!pending) return null;
    questions = [pending];
  }

  const hash = createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 8);

  return {
    sessionRef: options.sessionRef,
    messageId: latest.id,
    revision: `${latest.id}:${hash}`,
    askedAt: latest.createdAt,
    questions,
    ...(options.attentionID ? { attentionID: options.attentionID } : {}),
    generatedAt: options.now ?? Date.now(),
  };
}
