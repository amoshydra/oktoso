import { describe, expect, it } from "vitest";
import type {
  Attention,
  HubEvent,
  PendingQuestion,
  QuestionPrompt,
  SendInput,
  Session,
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
import type { SessionService } from "./session-service";
import type { NotificationService } from "./notification-service";

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
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    },
    pollIntervalMs: 30_000,
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
    clock?: { now: number };
    sessions?: Record<string, unknown>;
    notify?: (item: Attention) => Promise<void>;
  } = {},
) {
  const clock = options.clock ?? { now };
  const store = new MemoryStateStore();
  const bus = new EventBus(store, logger, { now: () => clock.now });
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
  const sessions = {
    async list() {
      return { data: [], cursor: { previous: null, next: null } };
    },
    async messages() {
      return { data: [] };
    },
    async get() {
      throw new Error("not found");
    },
    async retryMessage() {
      return { accepted: true };
    },
    ...options.sessions,
  } as unknown as SessionService;
  const notifications = options.notify
    ? ({
        enabled: true,
        notify: options.notify,
      } as unknown as NotificationService)
    : undefined;
  const service = new AutomationService({
    config: config(options.config),
    store,
    eventBus: bus,
    logger,
    questions,
    actions,
    sessions,
    ...(notifications ? { notifications } : {}),
    retryDelayMs: 0,
    now: () => clock.now,
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

    const events: HubEvent[] = [];
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === "automation.approval") events.push(event);
    });
    await publish(bus, attention());
    await service.whenIdle();
    unsubscribe();

    expect(sends).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({
      actionable: true,
      proposed: { label: "Delete everything" },
    });
    expect(events[0]?.data).not.toHaveProperty("plan");
    expect(service.runs()[0]).toMatchObject({
      decision: "escalated",
      reason: "not_low_risk",
    });
    const approval = service.approvals()[0]!;
    expect(approval).toMatchObject({
      attentionID: "att_1",
      reason: "not_low_risk",
      status: "pending",
      actionable: true,
      proposed: { label: "Delete everything", text: "Delete everything" },
    });
    expect(approval).not.toHaveProperty("plan");

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
    const approval = service.approvals()[0]!;
    expect(approval.actionable).toBe(false);
    expect(approval.proposed).toBeUndefined();
    expect(approval).not.toHaveProperty("plan");
  });
});

describe("AutomationService triggers and actions", () => {
  const sessionFixture = (status: Session["status"]): Session => ({
    ref: "desktop-opencode:ses_auth",
    providerID: "desktop-opencode",
    nativeID: "ses_auth",
    title: "Fix auth race in gateway",
    status,
    unread: false,
    updatedAt: now,
    createdAt: now - 1_000,
  });
  const limits = { maxActionsPerHour: 6, maxActionsPerDay: 24 };

  it("escalates instead of answering during quiet hours", async () => {
    const { bus, service, sends } = await setup({
      config: {
        quietHours: {
          enabled: true,
          start: "22:00",
          end: "07:00",
          timezone: "UTC",
        },
      },
      clock: { now: Date.UTC(2026, 10, 14, 23, 30) },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(0);
    expect(service.approvals()[0]).toMatchObject({ reason: "quiet_hours" });
    expect(service.runs()[0]).toMatchObject({
      decision: "escalated",
      reason: "quiet_hours",
    });
  });

  it("retries a failed action once", async () => {
    let calls = 0;
    const { bus, service } = await setup({
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
      },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(calls).toBe(2);
    expect(service.runs()[0]).toMatchObject({ decision: "acted" });
  });

  it("notifies without answering", async () => {
    const notified: Attention[] = [];
    const { bus, service, sends } = await setup({
      notify: async (item) => {
        notified.push(item);
      },
      config: {
        watchers: [
          {
            id: "w1",
            enabled: true,
            trigger: { kind: "attention", types: ["question"] },
            action: { kind: "notify" },
            dryRun: false,
            limits,
          },
        ],
      },
    });

    await publish(bus, attention());
    await service.whenIdle();

    expect(sends).toHaveLength(0);
    expect(notified).toHaveLength(1);
    expect(service.runs()[0]).toMatchObject({
      decision: "acted",
      reason: "notified",
    });
  });

  it("fires once when a session becomes idle and stays idle", async () => {
    const session = sessionFixture("idle");
    const page = { data: [session], cursor: { previous: null, next: null } };
    const { service } = await setup({
      config: {
        watchers: [
          {
            id: "s1",
            enabled: true,
            trigger: { kind: "session", on: "idle", idleMs: 0 },
            action: { kind: "escalate" },
            dryRun: false,
            limits,
          },
        ],
      },
      sessions: {
        list: async () => page,
        get: async () => session,
      },
      clock: { now },
    });

    await service.tickNow();
    await service.tickNow();
    await service.tickNow();

    expect(service.runs()).toHaveLength(1);
    expect(service.runs()[0]).toMatchObject({
      watcherID: "s1",
      decision: "escalated",
    });
  });

  it("retries the failed turn for a session error", async () => {
    const session = sessionFixture("error");
    const retried: string[] = [];
    const { service } = await setup({
      config: {
        watchers: [
          {
            id: "e1",
            enabled: true,
            trigger: { kind: "session", on: "error", idleMs: 0 },
            action: { kind: "retry" },
            dryRun: false,
            limits,
          },
        ],
      },
      sessions: {
        list: async () => ({
          data: [session],
          cursor: { previous: null, next: null },
        }),
        messages: async () => ({
          data: [{ id: "msg_1", metadata: { error: { message: "boom" } } }],
        }),
        retryMessage: async (_ref: string, id: string) => {
          retried.push(id);
          return { accepted: true };
        },
      },
      clock: { now },
    });

    await service.tickNow();
    await service.tickNow();

    expect(retried).toEqual(["msg_1"]);
    expect(service.runs()[0]).toMatchObject({
      decision: "acted",
      reason: "retried",
    });
  });

  it("fires a schedule watcher on its interval", async () => {
    const clock = { now };
    const session = sessionFixture("idle");
    const { service } = await setup({
      config: {
        watchers: [
          {
            id: "t1",
            enabled: true,
            trigger: { kind: "schedule", everyMs: 60_000 },
            condition: { sessionRef: session.ref },
            action: { kind: "escalate" },
            dryRun: false,
            limits,
          },
        ],
      },
      sessions: { get: async () => session },
      clock,
    });

    await service.tickNow();
    expect(service.runs()).toHaveLength(0);

    clock.now += 60_000;
    await service.tickNow();

    expect(service.runs()).toHaveLength(1);
    expect(service.runs()[0]).toMatchObject({
      watcherID: "t1",
      decision: "escalated",
    });
  });
});
