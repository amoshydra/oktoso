import { describe, expect, it } from "vitest";
import type {
  AnswerChoice,
  PendingQuestion,
  QuestionPrompt,
} from "@amoshydra/oktoso-contracts";
import {
  buildAnswerMetadata,
  buildAnswerRows,
  buildAnswerSummary,
  buildBatchAnswerMetadata,
  composeBatchAnswer,
} from "./answer-model";

function choice(
  id: string,
  text: string,
  kind: "choice" | "boolean" = "choice",
): AnswerChoice {
  return { id, label: text, text, kind, source: "explicit" };
}

function question(
  overrides: Partial<PendingQuestion> = {},
): PendingQuestion {
  return {
    id: "msg_1:q0",
    text: "Should I squash the commits?",
    kind: "boolean",
    choices: [choice("c0", "Yes", "boolean"), choice("c1", "No", "boolean")],
    allowsFreeText: true,
    allowsVoice: false,
    multiSelect: false,
    risk: "normal",
    confidence: "high",
    source: "heuristic",
    ...overrides,
  };
}

function prompt(
  overrides: Partial<QuestionPrompt> = {},
): QuestionPrompt {
  return {
    sessionRef: "provider:session",
    messageId: "msg_1",
    revision: "msg_1:abc123",
    askedAt: 1,
    questions: [question()],
    generatedAt: 2,
    ...overrides,
  };
}

describe("G2 answer model", () => {
  it("puts choices before the action rows", () => {
    expect(buildAnswerRows(question(), prompt()).map((row) => row.label)).toEqual([
      "Yes",
      "No",
      "Type answer",
      "More",
      "Read chat",
    ]);
  });

  it("omits Type answer when free text is disabled", () => {
    const rows = buildAnswerRows(
      question({ allowsFreeText: false }),
      prompt(),
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Yes",
      "No",
      "More",
      "Read chat",
    ]);
  });

  it("routes provider-native questions to the inbox form", () => {
    expect(
      buildAnswerRows(question(), prompt({ attentionID: "attention-1" })).map(
        (row) => row.label,
      ),
    ).toEqual(["Answer in Inbox", "Read chat"]);
  });

  it("routes multiple questions to the phone", () => {
    const promptWithTwo = prompt({
      questions: [question(), question({ id: "msg_1:q1" })],
    });
    expect(
      buildAnswerRows(promptWithTwo.questions[0]!, promptWithTwo).map(
        (row) => row.label,
      ),
    ).toEqual(["Answer on phone", "More", "Read chat"]);
    expect(buildAnswerSummary(promptWithTwo.questions[0]!, promptWithTwo)).toContain(
      "+1 more on phone",
    );
  });

  it("builds batch metadata and a numbered message", () => {
    const promptWithTwo = prompt({
      questions: [
        question(),
        question({
          id: "msg_1:q1",
          text: "Which database?",
          kind: "freeform",
          choices: [],
        }),
      ],
    });
    const drafts = [
      {
        questionId: "msg_1:q0",
        text: "Yes",
        choice: choice("c0", "Yes", "boolean"),
      },
      { questionId: "msg_1:q1", text: "Postgres" },
    ];
    expect(composeBatchAnswer(drafts)).toBe("1. Yes\n2. Postgres");
    expect(buildBatchAnswerMetadata(promptWithTwo, drafts)).toEqual([
      {
        questionId: "msg_1:q0",
        messageId: "msg_1",
        revision: "msg_1:abc123",
        choiceId: "c0",
        source: "boolean",
      },
      {
        questionId: "msg_1:q1",
        messageId: "msg_1",
        revision: "msg_1:abc123",
        source: "text",
      },
    ]);
  });

  it("keeps the question and context within two lines", () => {
    const summary = buildAnswerSummary(
      question({
        text: "Which branch should I target for the release?",
        context: "The migration will drop legacy_users.",
      }),
    );
    expect(summary.split("\n")).toHaveLength(2);
    expect(summary).toContain("Which branch");
    expect(summary).toContain("migration");
  });

  it("builds answer metadata for a choice", () => {
    expect(
      buildAnswerMetadata(prompt(), choice("c0", "Yes", "boolean")),
    ).toEqual({
      questionId: "msg_1:q0",
      messageId: "msg_1",
      revision: "msg_1:abc123",
      choiceId: "c0",
      source: "boolean",
    });
  });

  it("marks a free-form answer as text", () => {
    expect(buildAnswerMetadata(prompt())?.source).toBe("text");
  });
});
