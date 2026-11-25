import { describe, expect, it } from "vitest";
import type { MessagePart } from "@amoshydra/oktoso-contracts";
import { messageSegments } from "./activity";
import { answeredQuestions, type QuestionToolPart } from "./question-answer";

function questionPart(
  input: unknown,
  answers?: unknown,
  extra: Partial<QuestionToolPart> = {},
): QuestionToolPart {
  return {
    type: "tool",
    id: "call_question",
    name: "question",
    status: "completed",
    input,
    ...(answers === undefined ? {} : { metadata: { answers } }),
    ...extra,
  };
}

const single = {
  questions: [
    {
      header: "GPG unlock",
      question: "The signed commit needs the GPG passphrase. How should I proceed?",
      options: [
        { label: "Unlock in the terminal", description: "Run gpg --clearsign." },
        { label: "Trigger the desktop prompt" },
      ],
    },
  ],
};

describe("answeredQuestions", () => {
  it("reads one selected answer for a single question", () => {
    const result = answeredQuestions(
      questionPart(single, [["Unlock in the terminal"]], {
        completedAt: 1_000,
      }),
    );
    expect(result).toEqual({
      questions: [
        {
          header: "GPG unlock",
          question: single.questions[0]!.question,
          answers: ["Unlock in the terminal"],
        },
      ],
      completedAt: 1_000,
    });
  });

  it("reads every question and multi-select answers", () => {
    const result = answeredQuestions(
      questionPart(
        {
          questions: [
            { header: "Scope", question: "Which changes should I keep?" },
            { header: "Files", question: "Restore the changed files?" },
          ],
        },
        [["Composer", "G2 bridge"], ["No"]],
      ),
    );
    expect(result?.questions).toEqual([
      {
        header: "Scope",
        question: "Which changes should I keep?",
        answers: ["Composer", "G2 bridge"],
      },
      {
        header: "Files",
        question: "Restore the changed files?",
        answers: ["No"],
      },
    ]);
  });

  it("normalizes a flat answer list for a single question", () => {
    expect(
      answeredQuestions(
        questionPart(
          { question: "Pick one", header: "Choice" },
          ["One", "Two"],
        ),
      )?.questions[0]?.answers,
    ).toEqual(["One", "Two"]);
  });

  it("keeps a partially answered multi-question form visible", () => {
    const result = answeredQuestions(
      questionPart(
        {
          questions: [
            { question: "First" },
            { question: "Second" },
          ],
        },
        [["Yes"], []],
      ),
    );
    expect(result?.questions[0]?.answers).toEqual(["Yes"]);
    expect(result?.questions[1]?.answers).toEqual([]);
  });

  it("ignores pending questions and other tools", () => {
    expect(answeredQuestions(questionPart(single))).toBeUndefined();
    expect(
      answeredQuestions({
        type: "tool",
        id: "call",
        name: "shell",
        status: "completed",
        input: { questions: single.questions },
        metadata: { answers: [["Yes"]] },
      }),
    ).toBeUndefined();
  });
});

describe("messageSegments with answered questions", () => {
  const answered = questionPart(single, [["Unlock in the terminal"]]);
  const pending = questionPart(single);
  const reasoning: MessagePart = { type: "reasoning", text: "thinking" };

  it("renders an answered question as content between activity runs", () => {
    const segments = messageSegments([
      reasoning,
      answered,
      { type: "reasoning", text: "after" },
      { type: "text", text: "Done." },
    ]);
    expect(segments.map((segment) => segment.kind)).toEqual([
      "steps",
      "content",
      "steps",
      "content",
    ]);
    expect(segments[1]?.parts).toEqual([answered]);
  });

  it("keeps a pending question in the activity run", () => {
    const segments = messageSegments([reasoning, pending]);
    expect(segments.map((segment) => segment.kind)).toEqual(["steps"]);
    expect(segments[0]?.parts).toEqual([reasoning, pending]);
  });
});
