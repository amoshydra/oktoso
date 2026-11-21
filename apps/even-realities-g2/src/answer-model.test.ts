import { describe, expect, it } from "vitest";
import type {
  AnswerChoice,
  AssistantView,
  PendingQuestion,
  QuestionPrompt,
} from "@amoshydra/oktoso-contracts";
import {
  batchStepAfter,
  buildAnswerMetadata,
  buildAnswerRows,
  buildAnswerSummary,
  buildBatchAnswerMetadata,
  buildBatchQuestionRows,
  buildBatchReviewRows,
  composeBatchAnswer,
  firstMissingBatchAnswer,
  isFreeAnswerSentinel,
  replyModelConfigured,
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

function labels(rows: ReturnType<typeof buildAnswerRows>): string[] {
  return rows.map((row) => row.label);
}

describe("G2 answer model", () => {
  it("puts choices before the action rows", () => {
    expect(labels(buildAnswerRows(question(), prompt()))).toEqual([
      "1 Yes",
      "2 No",
      "› Type answer",
    ]);
  });

  it("omits Type answer when free text is disabled", () => {
    const rows = buildAnswerRows(
      question({ allowsFreeText: false }),
      prompt(),
    );
    expect(labels(rows)).toEqual(["1 Yes", "2 No"]);
  });

  it("routes provider-native questions to the inbox form", () => {
    expect(
      labels(buildAnswerRows(question(), prompt({ attentionID: "attention-1" }))),
    ).toEqual(["› Answer in Inbox"]);
  });

  it("offers the glass batch and the phone fallback", () => {
    const promptWithTwo = prompt({
      questions: [question(), question({ id: "msg_1:q1" })],
    });
    expect(
      labels(
        buildAnswerRows(promptWithTwo.questions[0]!, promptWithTwo),
      ),
    ).toEqual([
      "› Answer 2 questions",
      "› Answer 2 questions on phone",
    ]);
    expect(buildAnswerSummary(promptWithTwo.questions[0]!, promptWithTwo)).toContain(
      "+1 more",
    );
  });

  it("detects free-answer sentinel choices regardless of case", () => {
    for (const label of [
      "Other",
      "other",
      "Type your own",
      "Something else",
      "Custom",
      "Other…",
    ]) {
      expect(isFreeAnswerSentinel(choice("c", label))).toBe(true);
    }
    for (const label of [
      "Yes",
      "Another branch",
      "Others welcome",
      "Customize",
      "Other database",
    ]) {
      expect(isFreeAnswerSentinel(choice("c", label))).toBe(false);
    }
  });

  it("maps a sentinel to Type your own answer, never to a literal choice", () => {
    const rows = buildAnswerRows(
      question({
        kind: "choice",
        choices: [choice("c0", "Use the mirror"), choice("c1", "Other")],
      }),
      prompt(),
    );
    expect(labels(rows)).toEqual([
      "1 Use the mirror",
      "› Type your own answer",
    ]);
    expect(
      rows.some((row) => row.kind === "choice" && row.choice.id === "c1"),
    ).toBe(false);
    expect(
      rows.some((row) => row.label.toLowerCase() === "other"),
    ).toBe(false);
  });

  it("treats a sentinel-only question as free-form", () => {
    const rows = buildAnswerRows(
      question({
        kind: "freeform",
        choices: [choice("c0", "Other")],
      }),
      prompt(),
      { voice: true, suggested: true },
    );
    // No real choice sits under the first tap, so voice may lead.
    expect(labels(rows)).toEqual([
      "› Speak answer",
      "› Type your own answer",
      "› Suggested answers",
    ]);
  });

  it("never puts voice before a real choice", () => {
    const rows = buildAnswerRows(question(), prompt(), {
      voice: true,
      suggested: true,
      failure: true,
    });
    expect(labels(rows)).toEqual([
      "1 Yes",
      "2 No",
      "› Type answer",
      "› Speak answer",
      "› Suggested answers",
      "› Failure",
    ]);
    expect(rows[0]?.kind).toBe("choice");
  });

  it("places voice and suggestions in the free-form order", () => {
    const rows = buildAnswerRows(
      question({ kind: "freeform", choices: [] }),
      prompt(),
      { voice: true, suggested: true },
    );
    expect(labels(rows)).toEqual([
      "› Speak answer",
      "› Type answer",
      "› Suggested answers",
    ]);
  });

  it("keeps the batch failure reachable", () => {
    const promptWithTwo = prompt({
      questions: [question(), question({ id: "msg_1:q1" })],
    });
    expect(
      labels(
        buildAnswerRows(promptWithTwo.questions[0]!, promptWithTwo, {
          failure: true,
        }),
      ),
    ).toEqual([
      "› Answer 2 questions",
      "› Answer 2 questions on phone",
      "› Failure",
    ]);
  });

  it("builds one batch question with numbered choices and escapes", () => {
    const rows = buildBatchQuestionRows(question(), { voice: true });
    expect(labels(rows)).toEqual([
      "1 Yes",
      "2 No",
      "› Type answer",
      "› Speak answer",
      "› Answer on phone",
      "› Back",
    ]);
    expect(rows[0]?.kind).toBe("choice");
    expect(rows.filter((row) => row.kind === "action").map((row) => row.action)).toEqual([
      "type",
      "voice",
      "phone",
      "back",
    ]);
  });

  it("turns a batch sentinel into a free-text row and never numbers it", () => {
    const rows = buildBatchQuestionRows(
      question({
        kind: "choice",
        allowsFreeText: false,
        choices: [choice("c0", "Use the mirror"), choice("c1", "Other")],
      }),
    );
    expect(labels(rows)).toEqual([
      "1 Use the mirror",
      "› Type answer",
      "› Answer on phone",
      "› Back",
    ]);
    expect(
      rows.some((row) => row.kind === "choice" && row.choice.id === "c1"),
    ).toBe(false);
  });

  it("omits the type row when a batch question forbids free text", () => {
    expect(
      labels(
        buildBatchQuestionRows(question({ allowsFreeText: false })),
      ),
    ).toEqual(["1 Yes", "2 No", "› Answer on phone", "› Back"]);
  });

  it("numbers a batch review and offers Send all and Back", () => {
    const rows = buildBatchReviewRows([
      { text: "Yes" },
      { text: "Postgres" },
    ]);
    expect(labels(rows)).toEqual([
      "1 Yes",
      "2 Postgres",
      "› Send all",
      "› Back",
    ]);
    expect(rows[1]).toEqual({
      kind: "answer",
      label: "2 Postgres",
      questionIndex: 1,
    });
  });

  it("shows an unanswered batch review row instead of an empty row", () => {
    expect(labels(buildBatchReviewRows([{ text: " " }]))[0]).toBe(
      "1 No answer yet",
    );
  });

  it("advances a batch and lands on review after the last question", () => {
    expect(batchStepAfter(0, 3)).toEqual({ screen: "batch", index: 1 });
    expect(batchStepAfter(1, 3)).toEqual({ screen: "batch", index: 2 });
    expect(batchStepAfter(2, 3)).toEqual({ screen: "batch-review" });
    expect(batchStepAfter(0, 1)).toEqual({ screen: "batch-review" });
  });

  it("finds the first unanswered batch question", () => {
    expect(
      firstMissingBatchAnswer([
        { text: "Yes", choice: choice("c0", "Yes", "boolean") },
        { text: "" },
        { text: "Postgres" },
      ]),
    ).toBe(1);
    expect(
      firstMissingBatchAnswer([{ text: "Yes" }, { text: "Postgres" }]),
    ).toBeUndefined();
    expect(firstMissingBatchAnswer([])).toBeUndefined();
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

  it("hides suggestions when the reply model is unavailable", () => {
    const view = (overrides: Partial<AssistantView["reply"]> = {}) =>
      ({
        reply: {
          enabled: true,
          baseUrl: "http://model.test/v1",
          model: "small",
          timeoutMs: 1_000,
          hasApiKey: false,
          disableThinking: true,
          ...overrides,
        },
        transcription: {
          enabled: false,
          baseUrl: "",
          model: "",
          timeoutMs: 1_000,
          hasApiKey: false,
        },
      }) satisfies AssistantView;

    expect(replyModelConfigured(view())).toBe(true);
    expect(replyModelConfigured(view({ enabled: false }))).toBe(false);
    expect(replyModelConfigured(view({ baseUrl: " " }))).toBe(false);
    expect(replyModelConfigured(view({ model: "" }))).toBe(false);
    expect(replyModelConfigured(undefined)).toBe(false);
  });
});
