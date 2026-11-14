import { describe, expect, it } from "vitest";
import type {
  Attention,
  PendingQuestion,
  QuestionPrompt,
  SendInput,
} from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import type { AutomationConfig } from "../config/schema";
import { createLogger } from "../lib/logger";
import {
  AutomationService,
  isLowRiskQuestion,
  pickSafeChoice,
} from "./automation-service";
import { EventBus } from "./event-bus";
import type { QuestionService } from "./question-service";
import type { SessionActions } from "./session-actions";

const now = 1_793_000_000_000;
const logger = createLogger({ level: "silent" });

function attention(overrides: Partial<Attention> = {}): Attention {
  return {
    id: "att_1",
    sessionRef: "desktop-opencode:ses_auth",
    type: "question",
    priority: "blocking",
    title: "Fix auth race in gateway",
    summary: "Proceed?",
    createdAt: now,
    actions: [],
    ...overrides,
  };
}

function question(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: "q_1",
    text: "Proceed?",
    kind: "boolean",
    choices: [
      {
        id: "yes",
        label: "Yes",
        text: "Yes",
        kind: "boolean",
        source: "explicit",
      },
      {
        id: "no",
        label: "No",
        text: "No",
        kind: "boolean",
        source: "explicit",
      },
    ],
    allowsFreeText: false,
    allowsVoice: false,
    multiSelect: false,
    risk: "normal",
    confidence: "high",
    source: "explicit",
    ...overrides,
  };
}

function prompt(value = question()): QuestionPrompt {
  return {
    sessionRef: "desktop-opencode:ses_auth",
    messageId: "msg_1",
    revision: "rev_1",
    askedAt: now,
    questions: [value],
    generatedAt: now,
  };
}

function config(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    enabled: true,
    dryRun: false,
    maxActionsPerHour: 6,
    maxActionsPerDay: 24,
    approvalTtlMs: 24 * 60 * 60 * 1_000,
    audit: { maxRuns: 100 },
    watchers: [
      {
        id: "w1",
        enabled: true,
        trigger: { kind: "attention", types: ["question"] },
        action: { kind: "answer", choice: "first-safe" },
        dryRun: false,
        limits: { maxActionsPerHour: 6, maxActionsPerDay: 24 },
      },
    ],
    ...overrides,
  };
}

async function setup(
  options: {
    config?: Partial<AutomationConfig>;
    prompt?: QuestionPrompt | null;
    send?: (input: SendInput) => Promise<void>;
  } = {},
) {
  const store = new MemoryStateStore();
  const bus = new EventBus(store, logger, { now: () => now });
  await bus.init();
  const sends: Array<{ ref: string; input: SendInput; key?: string }> = [];
  const promptValue = "prompt" in options ? options.prompt : prompt();
  const questions = {
    async get() {
      return promptValue;
    },
  } as unknown as QuestionService;
  const actions = {
    async send(ref: string, input: SendInput, key?: string) {
      if (options.send) await options.send(input);
      sends.push({ ref, input, key });
      return { accepted: true };
    },
  } as unknown as SessionActions;
  const service = new AutomationService({
    config: config(options.config),
    store,
    eventBus: bus,
    logger,
    questions,
    actions,
    now: () => now,
  });
  service.start();
  return { store, bus, service, sends };
}

async function publish(bus: EventBus, item: Attention): Promise<void> {
  await bus.publish("attention.created", item, {
    sessionRef: item.sessionRef,
    attentionID: item.id,
  });
}

describe("automation policy", () => {
  it("accepts a normal boolean question", () => {
    expect(isLowRiskQuestion(question())).toBe(true);
    expect(pickSafeChoice(question(), { kind: "answer", choice: "first-safe" }))
      .toMatchObject({ id: "yes" });
  });

  it("rejects free text, destructive choices, and risk", () => {
    expect(isLowRiskQuestion(question({ allowsFreeText: true }))).toBe(false);
    expect(
      isLowRiskQuestion(
        question({
          choices: [
            {
              id: "delete",
              label: "Delete",
              text: "Delete",
              kind: "choice",
              source: "explicit",
              destructive: true,
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(isLowRiskQuestion(question({ risk: "sensitive" }))).toBe(false);
    expect(isLowRiskQuestion(question({ multiSelect: true }))).toBe(false);
  });
});

describe("AutomationService", () => {
  it("records a dry run and sends nothing", async () => {
    const { bus, service, sends } = await setup({
      config: { dryRun: true },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(service.runs()[0]).toMatchObject({
      watcherID: "w1",
      decision: "dry_run",
      detail: "Would answer: Yes",
    });
    expect(sends).toHaveLength(0);
  });

  it("answers a safe question through the shared send path", async () => {
    const { bus, service, sends } = await setup();

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      ref: "desktop-opencode:ses_auth",
      input: {
        text: "Yes",
        answers: [
          {
            questionId: "q_1",
            messageId: "msg_1",
            revision: "rev_1",
            choiceId: "yes",
            source: "choice",
          },
        ],
      },
      key: "automation:w1:att_1",
    });
    expect(service.runs()[0]).toMatchObject({
      decision: "acted",
      detail: "Answered: Yes",
    });
  });

  it("escalates an unsafe question and can execute the approval", async () => {
    const destructive = question({
      choices: [
        {
          id: "delete",
          label: "Delete everything",
          text: "Delete everything",
          kind: "choice",
          source: "explicit",
          destructive: true,
        },
      ],
    });
    const { bus, service, sends } = await setup({
      prompt: prompt(destructive),
      config: {
        watchers: [
          {
            id: "w1",
            enabled: true,
            trigger: { kind: "attention", types: ["question"] },
            action: { kind: "answer", choice: "id", value: "delete" },
            dryRun: false,
            limits: { maxActionsPerHour: 6, maxActionsPerDay: 24 },
          },
        ],
      },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(0);
    expect(service.runs()[0]).toMatchObject({
      decision: "escalated",
      reason: "not_low_risk",
    });
    const approval = service.approvals()[0]!;
    expect(approval).toMatchObject({
      attentionID: "att_1",
      reason: "not_low_risk",
      status: "pending",
      plan: expect.objectContaining({ label: "Delete everything" }),
    });

    await service.actOnApproval(approval.id, "approve");

    expect(sends).toHaveLength(1);
    expect(sends[0]?.input.text).toBe("Delete everything");
    expect(service.approvals()).toHaveLength(0);
    expect(service.runs()[0]).toMatchObject({
      decision: "acted",
      approved: true,
      detail: "Approved: Delete everything",
    });
  });

  it("denies an approval without sending", async () => {
    const { bus, service, sends } = await setup({
      prompt: prompt(question({ allowsFreeText: true })),
    });

    await publish(bus, attention());
    await service.whenIdle();
    const approval = service.approvals()[0]!;

    await service.actOnApproval(approval.id, "deny");

    expect(sends).toHaveLength(0);
    expect(service.approvals()).toHaveLength(0);
    expect(service.runs()[0]).toMatchObject({
      decision: "skipped",
      reason: "denied",
    });
  });

  it("does not act twice for the same attention item", async () => {
    const { bus, service, sends } = await setup();

    await publish(bus, attention());
    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(1);
    expect(service.runs()).toHaveLength(1);
  });

  it("stops when paused", async () => {
    const { bus, service, sends } = await setup();
    await service.updateSettings({ paused: true });

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(0);
    expect(service.runs()).toHaveLength(0);
  });

  it("skips once the global hourly budget is spent", async () => {
    const { bus, service, sends } = await setup({
      config: { maxActionsPerHour: 1 },
    });

    await publish(bus, attention({ id: "att_1" }));
    await publish(bus, attention({ id: "att_2" }));
    await service.whenIdle();

    expect(sends).toHaveLength(1);
    expect(service.runs().map((run) => run.decision)).toEqual([
      "skipped",
      "acted",
    ]);
    expect(service.runs()[0]).toMatchObject({ reason: "budget" });
  });

  it("escalates a multi-question prompt", async () => {
    const { bus, service, sends } = await setup({
      prompt: {
        ...prompt(),
        questions: [question(), question({ id: "q_2", text: "And this?" })],
      },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(0);
    expect(service.runs()[0]).toMatchObject({
      decision: "escalated",
      reason: "multiple_questions",
    });
    expect(service.approvals()[0]?.plan).toBeUndefined();
  });
});
