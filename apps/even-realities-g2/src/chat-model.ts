import type { Message } from "@agent-hub/contracts";
import { plainTextForGlass, wrapText } from "@agent-hub/wearable-core";

export interface ChatBuild {
  lines: string[];
  lineMessages: number[];
  messageStarts: Record<string, number>;
  messageCount: number;
  latestMessageStart: number;
}

export interface ChatViewport {
  offset: number;
  newBelow: boolean;
}

export function buildChat(messages: Message[]): ChatBuild {
  if (messages.length === 0) {
    return {
      lines: ["No messages yet."],
      lineMessages: [0],
      messageStarts: {},
      messageCount: 0,
      latestMessageStart: 0,
    };
  }

  const lines: string[] = [];
  const lineMessages: number[] = [];
  const messageStarts: Record<string, number> = {};
  let messageCount = 0;
  let latestMessageStart = 0;

  for (const message of messages) {
    const text = plainTextForGlass(
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    ).trim();
    if (!text) continue;
    const messageIndex = messageCount;
    messageCount += 1;
    const messageStart = lines.length;
    messageStarts[message.id] = messageStart;
    latestMessageStart = messageStart;
    const push = (line: string) => {
      lines.push(line);
      lineMessages.push(messageIndex);
    };
    push(message.role.toUpperCase());
    for (const line of wrapText(text, 52, Number.MAX_SAFE_INTEGER)) push(line);
    push("");
  }

  if (lines.length === 0) {
    return {
      lines: ["No readable text."],
      lineMessages: [0],
      messageStarts: {},
      messageCount: 0,
      latestMessageStart: 0,
    };
  }

  return {
    lines,
    lineMessages,
    messageStarts,
    messageCount,
    latestMessageStart,
  };
}

export function mergeChatMessages(
  current: Message[],
  incoming: Message[],
): Message[] {
  const byID = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
}

export function activityForMessages(messages: Message[]): string {
  const last = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!last) return "";
  if (last.metadata?.error) return "Error";
  const tools = last.parts.filter((part) => part.type === "tool");
  if (tools.some((part) => part.type === "tool" && part.status === "error")) {
    return "Tool error";
  }
  if (last.streaming) {
    return tools.length > 0
      ? `Working · ${tools.length} step${tools.length === 1 ? "" : "s"}`
      : "Working";
  }
  if (tools.length > 0) {
    return `${tools.length} tool step${tools.length === 1 ? "" : "s"}`;
  }
  return last.parts.some((part) => part.type === "reasoning") ? "Reasoning" : "";
}

export function initialViewport(
  build: ChatBuild,
  visibleLines: number,
): ChatViewport {
  const maxOffset = Math.max(0, build.lines.length - visibleLines);
  return {
    offset: Math.min(build.latestMessageStart, maxOffset),
    newBelow: false,
  };
}

export function nextViewport(options: {
  previousOffset: number;
  previousLineCount: number;
  newBelow: boolean;
  build: ChatBuild;
  visibleLines: number;
  newMessageID?: string;
}): ChatViewport {
  const previousMax = Math.max(0, options.previousLineCount - options.visibleLines);
  const nextMax = Math.max(0, options.build.lines.length - options.visibleLines);
  const wasAtBottom = options.previousOffset >= previousMax;

  if (options.newMessageID !== undefined) {
    const start = options.build.messageStarts[options.newMessageID];
    if (start === undefined) {
      return {
        offset: Math.min(options.previousOffset, nextMax),
        newBelow: options.newBelow,
      };
    }
    if (wasAtBottom) {
      return { offset: Math.min(start, nextMax), newBelow: false };
    }
    return {
      offset: Math.min(options.previousOffset, nextMax),
      newBelow: true,
    };
  }

  return {
    offset: Math.min(options.previousOffset, nextMax),
    newBelow: options.newBelow,
  };
}
