import type { Message, MessagePart } from "@amoshydra/oktoso-contracts";
import {
  formatBytes,
  formatChars,
  formatDiff,
  formatDuration,
  formatExit,
  formatFiles,
  formatHits,
  formatLines,
} from "./metrics";
import { toolOutputText } from "./tool-images";

export type StepKind =
  | "think"
  | "shell"
  | "execute"
  | "read"
  | "write"
  | "edit"
  | "search"
  | "fetch"
  | "subagent"
  | "image"
  | "other";

export type StepStatus = "completed" | "running" | "error";

export type ToolPart = Extract<MessagePart, { type: "tool" }>;
export type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
export type CompactionPart = Extract<MessagePart, { type: "compaction" }>;

export interface ActivityStep {
  key: string;
  kind: StepKind;
  label: string;
  status: StepStatus;
  /** Short value under the icon; always paired with an exact `title`. */
  metric?: string;
  title?: string;
  part: ToolPart | ReasoningPart;
  startedAt?: number;
  /** Present on running steps; used to keep their duration live. */
  running?: boolean;
}

const TOOL_KINDS: Record<string, StepKind> = {
  shell: "shell",
  bash: "shell",
  execute: "execute",
  read: "read",
  write: "write",
  edit: "edit",
  editor: "edit",
  apply_patch: "edit",
  grep: "search",
  glob: "search",
  webfetch: "fetch",
  websearch: "fetch",
  task: "subagent",
  subagent: "subagent",
  image: "image",
};

const TOOL_LABELS: Record<StepKind, string> = {
  think: "Reasoning",
  shell: "Shell",
  execute: "Execute",
  read: "Read",
  write: "Write",
  edit: "Edit",
  search: "Search files",
  fetch: "Fetch",
  subagent: "Subagent",
  image: "Image",
  other: "Tool",
};

const LABEL_OVERRIDES: Record<string, string> = {
  grep: "Grep",
  glob: "Glob",
  webfetch: "Fetch",
  websearch: "Web search",
  apply_patch: "Patch",
};

export function toolKind(name: string): StepKind {
  return TOOL_KINDS[name.toLowerCase()] ?? "other";
}

export function stepLabel(name: string, kind: StepKind): string {
  return LABEL_OVERRIDES[name.toLowerCase()] ?? TOOL_LABELS[kind];
}

export function isCompactionPart(part: MessagePart): part is CompactionPart {
  return part.type === "compaction";
}

export function compactionPart(message: Message): CompactionPart | undefined {
  return message.parts.find(isCompactionPart);
}

export function stepStatus(part: ToolPart): StepStatus {
  const status = part.status.toLowerCase();
  if (status === "error" || status === "failed") return "error";
  if (status === "running" || status === "pending" || status === "streaming") {
    return "running";
  }
  return "completed";
}

export function stepsFromParts(parts: MessagePart[], keyPrefix = ""): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const part of parts) {
    if (part.type === "reasoning") {
      const chars = part.text.length;
      steps.push({
        key: `${keyPrefix}${steps.length}:think`,
        kind: "think",
        label: TOOL_LABELS.think,
        status: "completed",
        metric: formatChars(chars),
        title: `${chars.toLocaleString()} characters`,
        part,
      });
      continue;
    }
    if (part.type !== "tool") continue;

    const kind = toolKind(part.name);
    const status = stepStatus(part);
    const metric = stepMetric(part, kind, status);
    steps.push({
      key: `${keyPrefix}${part.id || steps.length}`,
      kind,
      label: stepLabel(part.name, kind),
      status,
      part,
      startedAt: part.startedAt,
      ...(status === "running" ? { running: true } : {}),
      ...(metric ? { metric: metric.label, title: metric.title } : {}),
    });
  }
  return steps;
}

export function stepsFromMessages(messages: Message[]): ActivityStep[] {
  return messages.flatMap((message) =>
    stepsFromParts(message.parts, `${message.id}:`),
  );
}

export function stepMetric(
  part: ToolPart,
  kind: StepKind,
  status: StepStatus,
): { label: string; title: string } | undefined {
  // Reserved for status-specific metrics ("timed out", "cancelled").
  void status;
  const metadata = part.metadata ?? {};

  switch (kind) {
    case "think":
      return undefined;
    case "shell": {
      const signal = numberOrString(metadata.signal);
      const exit = numberValue(metadata.exit);
      if (signal !== undefined && signal !== 0) {
        return { label: formatExit(0, signal), title: `killed by signal ${signal}` };
      }
      if (exit !== undefined) {
        return { label: formatExit(exit), title: `exit code ${exit}` };
      }
      return durationMetric(part);
    }
    case "execute": {
      const calls = Array.isArray(metadata.toolCalls) ? metadata.toolCalls.length : undefined;
      if (calls !== undefined) {
        return {
          label: `${calls} ${calls === 1 ? "call" : "calls"}`,
          title: `${calls} tool ${calls === 1 ? "call" : "calls"}`,
        };
      }
      return durationMetric(part);
    }
    case "read": {
      const text = toolOutputText(part.output);
      if (!text) return durationMetric(part);
      const lines = text.split("\n").length;
      return { label: formatLines(lines), title: `${lines.toLocaleString()} lines` };
    }
    case "write": {
      const content = inputString(part.input, ["content", "text", "body"]);
      if (content !== undefined) {
        const bytes = new TextEncoder().encode(content).byteLength;
        return { label: formatBytes(bytes), title: `${bytes.toLocaleString()} bytes` };
      }
      return durationMetric(part);
    }
    case "edit": {
      const diff = diffStats(metadata);
      if (diff) {
        return {
          label: formatDiff(diff.adds, diff.removes),
          title: `+${diff.adds.toLocaleString()} −${diff.removes.toLocaleString()} lines`,
        };
      }
      return durationMetric(part);
    }
    case "search": {
      const matches = numberValue(metadata.matches);
      if (matches !== undefined) {
        return { label: formatHits(matches), title: `${matches.toLocaleString()} matches` };
      }
      const count = numberValue(metadata.count);
      if (count !== undefined) {
        return { label: formatFiles(count), title: `${count.toLocaleString()} files` };
      }
      return durationMetric(part);
    }
    case "subagent":
      return { label: "launched", title: "child session launched" };
    default:
      return durationMetric(part);
  }
}

export function stepDuration(part: ToolPart): number | undefined {
  if (part.startedAt === undefined) return undefined;
  const end = part.completedAt ?? (stepStatus(part) === "running" ? Date.now() : undefined);
  if (end === undefined || end < part.startedAt) return undefined;
  return end - part.startedAt;
}

function durationMetric(part: ToolPart): { label: string; title: string } | undefined {
  const duration = stepDuration(part);
  if (duration === undefined) return undefined;
  return {
    label: formatDuration(duration),
    title: `${duration.toLocaleString()} ms`,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrString(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function inputString(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function diffStats(
  metadata: Record<string, unknown>,
): { adds: number; removes: number } | undefined {
  const files = metadata.files;
  if (!Array.isArray(files)) return undefined;
  let adds = 0;
  let removes = 0;
  let found = false;
  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const patch = (file as Record<string, unknown>).patch;
    if (typeof patch !== "string") continue;
    found = true;
    for (const line of patch.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) adds += 1;
      else if (line.startsWith("-")) removes += 1;
    }
  }
  return found ? { adds, removes } : undefined;
}
