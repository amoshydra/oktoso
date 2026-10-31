import { describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import { parseQuestion } from "./question-parser";

function message(
  text: string,
  overrides: Partial<Message> = {},
): Message {
  return {
    id: "msg_1",
    sessionRef: "provider:session",
    role: "assistant",
    parts: [{ type: "text", text }],
    createdAt: 1_793_000_000_000,
    ...overrides,
  };
}

function parse(
  text: string,
  overrides: Partial<Message> = {},
): ReturnType<typeof parseQuestion> {
  return parseQuestion([message(text, overrides)], {
    sessionRef: "provider:session",
    now: 1_793_000_001_000,
  });
}

describe("question parser", () => {
  it("synthesizes yes/no for a clean binary question", () => {
    const prompt = parse("Should I squash the three fix commits into one?");
    expect(prompt?.questions[0]?.kind).toBe("boolean");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "Yes",
      "No",
    ]);
  });

  it("extracts an adjacent numbered list as choices", () => {
    const prompt = parse(
      "Which branch should I target?\n1. main\n2. release/2.4",
    );
    expect(prompt?.questions[0]?.kind).toBe("choice");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "main",
      "release/2.4",
    ]);
    expect(prompt?.questions[0]?.confidence).toBe("high");
  });

  it("extracts a lettered list after a colon cue", () => {
    const prompt = parse(
      "Do you want me to:\nA) delete the branch\nB) keep it",
    );
    expect(prompt?.questions[0]?.kind).toBe("choice");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "delete the branch",
      "keep it",
    ]);
    expect(prompt?.questions[0]?.choices[0]?.requiresConfirmation).toBe(true);
  });

  it("uses alternatives from the preceding sentence", () => {
    const prompt = parse(
      "I can proceed or wait. Which do you prefer?",
    );
    expect(prompt?.questions[0]?.kind).toBe("choice");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "proceed",
      "wait",
    ]);
  });

  it("does not turn a plan into choices", () => {
    const prompt = parse(
      "Plan:\n1. Read the file\n2. Fix the bug\n3. Run tests\n\nShould I proceed?",
    );
    expect(prompt?.questions[0]?.kind).toBe("boolean");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "Yes",
      "No",
    ]);
  });

  it("keeps open-ended questions free-form", () => {
    const why = parse("Why did the test fail?");
    const name = parse("What should I name the branch?");
    expect(why?.questions[0]?.kind).toBe("freeform");
    expect(name?.questions[0]?.kind).toBe("freeform");
  });

  it("flags destructive code even when the fence is stripped", () => {
    const prompt = parse(
      "The command is:\n```sh\nrm -rf build\n```\nShould I run it?",
    );
    expect(prompt?.questions[0]?.kind).toBe("boolean");
    expect(prompt?.questions[0]?.risk).toBe("destructive");
    expect(prompt?.questions[0]?.choices[0]?.requiresConfirmation).toBe(true);
  });

  it("ignores quoted questions", () => {
    expect(parse("You asked: “Should I delete it?” I’ll wait.")).toBeNull();
  });

  it("ignores courtesy questions", () => {
    expect(parse("Done. Anything else?")).toBeNull();
  });

  it("strips inline alternatives from a choice cue", () => {
    const prompt = parse("Should I deploy to staging or production?");
    expect(prompt?.questions[0]?.kind).toBe("choice");
    expect(prompt?.questions[0]?.choices.map((choice) => choice.text)).toEqual([
      "staging",
      "production",
    ]);
  });

  it("does not synthesize yes/no for information requests", () => {
    expect(parse("Can you confirm the file path?")?.questions[0]?.kind).toBe(
      "freeform",
    );
  });

  it("does not answer one of several questions", () => {
    expect(parse("Which branch? And should I force push?")).toBeNull();
  });

  it("ignores a streaming message", () => {
    expect(
      parse("Should I proceed?", {
        streaming: true,
      }),
    ).toBeNull();
  });

  it("allows a courtesy closer after a real question", () => {
    const prompt = parse("Should I proceed?\n\nLet me know!");
    expect(prompt?.questions[0]?.kind).toBe("boolean");
  });

  it("ignores a question inside a blockquote", () => {
    expect(
      parse("Here is a quote:\n> Should I proceed?\nThe build is green."),
    ).toBeNull();
  });

  it("returns null when there is no question", () => {
    expect(parse("The build is green.")).toBeNull();
  });
});
