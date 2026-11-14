import { describe, expect, it } from "vitest";
import {
  compactionPart,
  stepStatus,
  stepsFromParts,
  toolKind,
} from "./activity";
import type { MessagePart } from "@amoshydra/oktoso-contracts";

function tool(
  name: string,
  extra: Partial<Extract<MessagePart, { type: "tool" }>> = {},
): Extract<MessagePart, { type: "tool" }> {
  return {
    type: "tool",
    id: `tool_${name}`,
    name,
    status: "completed",
    ...extra,
  };
}

describe("toolKind", () => {
  it("maps provider tool names to step families", () => {
    expect(toolKind("shell")).toBe("shell");
    expect(toolKind("bash")).toBe("shell");
    expect(toolKind("execute")).toBe("execute");
    expect(toolKind("read")).toBe("read");
    expect(toolKind("write")).toBe("write");
    expect(toolKind("apply_patch")).toBe("edit");
    expect(toolKind("grep")).toBe("search");
    expect(toolKind("glob")).toBe("search");
    expect(toolKind("webfetch")).toBe("fetch");
    expect(toolKind("websearch")).toBe("fetch");
    expect(toolKind("subagent")).toBe("subagent");
    expect(toolKind("task")).toBe("subagent");
    expect(toolKind("mystery")).toBe("other");
  });
});

describe("stepStatus", () => {
  it("normalizes provider statuses", () => {
    expect(stepStatus(tool("read"))).toBe("completed");
    expect(stepStatus(tool("read", { status: "running" }))).toBe("running");
    expect(stepStatus(tool("read", { status: "pending" }))).toBe("running");
    expect(stepStatus(tool("read", { status: "error" }))).toBe("error");
    expect(stepStatus(tool("read", { status: "failed" }))).toBe("error");
  });
});

describe("stepsFromParts", () => {
  it("turns reasoning into a step with a character metric", () => {
    const [step] = stepsFromParts([{ type: "reasoning", text: "x".repeat(1300) }]);
    expect(step).toMatchObject({
      kind: "think",
      label: "Reasoning",
      metric: "1.3k ch",
      status: "completed",
    });
    expect(step?.title).toBe("1,300 characters");
  });

  it("reads shell exit codes and signals", () => {
    const [step] = stepsFromParts([
      tool("shell", { metadata: { exit: 128 } }),
    ]);
    expect(step?.metric).toBe("exit 128");
    expect(step?.title).toBe("exit code 128");

    const [signalled] = stepsFromParts([
      tool("shell", { metadata: { signal: 9 } }),
    ]);
    expect(signalled?.metric).toBe("sig 9");
  });

  it("falls back to duration when a tool has no better number", () => {
    const [step] = stepsFromParts([
      tool("shell", { startedAt: 1000, completedAt: 1576 }),
    ]);
    expect(step?.metric).toBe("576 ms");
    expect(step?.title).toBe("576 ms");
  });

  it("reads search and glob counts", () => {
    const [matches] = stepsFromParts([tool("grep", { metadata: { matches: 49 } })]);
    expect(matches?.metric).toBe("49 hits");

    const [count] = stepsFromParts([tool("glob", { metadata: { count: 12 } })]);
    expect(count?.metric).toBe("12 files");
  });

  it("computes edit line deltas from the patch", () => {
    const [step] = stepsFromParts([
      tool("edit", {
        metadata: {
          files: [{ file: "a.ts", patch: "@@\n--- a\n+++ b\n-one\n+two\n+three" }],
        },
      }),
    ]);
    expect(step?.metric).toBe("+2 −1");
  });

  it("measures write bytes and read lines", () => {
    const [write] = stepsFromParts([tool("write", { input: { content: "abc" } })]);
    expect(write?.metric).toBe("3 B");

    const [read] = stepsFromParts([
      tool("read", { output: "one\ntwo\nthree" }),
    ]);
    expect(read?.metric).toBe("3 ln");
  });

  it("marks subagents as launched", () => {
    const [step] = stepsFromParts([
      tool("subagent", {
        status: "running",
        metadata: { sessionID: "ses_child", status: "running" },
      }),
    ]);
    expect(step).toMatchObject({
      kind: "subagent",
      status: "running",
      metric: "launched",
      running: true,
    });
  });

  it("keeps reading order across mixed parts", () => {
    const steps = stepsFromParts([
      { type: "reasoning", text: "thinking" },
      tool("read", { id: "r1" }),
      { type: "text", text: "not a step" },
      tool("shell", { id: "s1", metadata: { exit: 0 } }),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["think", "read", "shell"]);
  });
});

describe("compactionPart", () => {
  it("finds the compaction part on a message", () => {
    const part = {
      type: "compaction" as const,
      reason: "auto",
      status: "completed",
      summary: "## Objective",
    };
    expect(
      compactionPart({ id: "m", sessionRef: "s", role: "system", parts: [part], createdAt: 0 }),
    ).toBe(part);
    expect(
      compactionPart({ id: "m", sessionRef: "s", role: "assistant", parts: [], createdAt: 0 }),
    ).toBeUndefined();
  });
});
