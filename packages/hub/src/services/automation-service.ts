import { randomUUID } from "node:crypto";
import {
  zAttention,
  type AnswerChoice,
  type Attention,
  type AutomationAction,
  type AutomationApproval,
  type AutomationRun,
  type AutomationSettingsInput,
  type AutomationView,
  type AutomationWatcher,
  type PendingQuestion,
  type SendAnswer,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { AutomationConfig } from "../config/schema";
import { conflict, notFound } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { EventBus } from "./event-bus";
import type { QuestionService } from "./question-service";
import type { SessionActions } from "./session-actions";

export interface AutomationServiceOptions {
  config: AutomationConfig;
  store: StateStore;
  eventBus: EventBus;
  logger: Logger;
  questions: QuestionService;
  actions: SessionActions;
  now?: () => number;
  leaseTtlMs?: number;
}

interface AnswerPlan {
  ok: true;
  question: PendingQuestion;
  choice: AnswerChoice;
  answer: SendAnswer;
}

interface PlanFailure {
  ok: false;
  reason: string;
}

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_APPROVALS = 200;

/**
 * Watches attention events and applies declarative policies.
 *
 * The first slice reacts to `attention.created` only. Every action is gated by
 * a lease, the global pause, the watcher pause, dry-run, and per-watcher and
 * global budgets. Anything outside the low-risk answer allowlist becomes an
 * approval instead of an action.
 */
export class AutomationService {
  private readonly config: AutomationConfig;
  private readonly store: StateStore;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly questions: QuestionService;
  private readonly actions: SessionActions;
  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private stopListening?: () => void;
  private work: Promise<void> = Promise.resolve();

  constructor(options: AutomationServiceOptions) {
    this.config = options.config;
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.questions = options.questions;
    this.actions = options.actions;
    this.now = options.now ?? Date.now;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  }

  get paused(): boolean {
    return this.store.getState().automationPaused;
  }

  get dryRun(): boolean {
    return this.store.getState().automationDryRun ?? this.config.dryRun;
  }

  start(): () => void {
    if (this.stopListening) return this.stopListening;
    const unsubscribe = this.eventBus.subscribe((event) => {
      if (event.type !== "attention.created") return;
      const parsed = zAttention.safeParse(event.data);
      if (!parsed.success) {
        this.logger.warn("Ignoring malformed automation attention event", {
          attentionID: event.attentionID,
        });
        return;
      }
      this.work = this.work
        .then(() => this.handleAttention(parsed.data))
        .catch((error) => {
          this.logger.error("Automation handling failed", {
            attentionID: parsed.data.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
    this.stopListening = () => {
      unsubscribe();
      this.stopListening = undefined;
    };
    return this.stopListening;
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = undefined;
  }

  /** Await every handler queued so far. Tests use this. */
  async whenIdle(): Promise<void> {
    await this.work;
  }

  view(): AutomationView {
    const state = this.store.getState();
    const now = this.now();
    return {
      enabled: this.config.enabled,
      paused: state.automationPaused,
      dryRun: state.automationDryRun ?? this.config.dryRun,
      watchers: this.config.watchers,
      pausedWatchers: Object.entries(state.automationWatcherPause)
        .filter(([, paused]) => paused)
        .map(([id]) => id),
      runs: state.automationRuns.slice(-50).reverse(),
      approvals: state.automationApprovals.filter(
        (approval) =>
          approval.status === "pending" && approval.expiresAt > now,
      ),
    };
  }

  runs(limit = 50): AutomationRun[] {
    return this.store
      .getState()
      .automationRuns.slice(-Math.max(1, limit))
      .reverse();
  }

  approvals(): AutomationApproval[] {
    const now = this.now();
    return this.store
      .getState()
      .automationApprovals.filter(
        (approval) =>
          approval.status === "pending" && approval.expiresAt > now,
      );
  }

  async updateSettings(input: AutomationSettingsInput): Promise<AutomationView> {
    await this.store.update((state) => {
      if (input.paused !== undefined) state.automationPaused = input.paused;
      if (input.dryRun !== undefined) state.automationDryRun = input.dryRun;
    });
    return this.view();
  }

  async setWatcherPaused(id: string, paused: boolean): Promise<AutomationView> {
    if (!this.config.watchers.some((watcher) => watcher.id === id)) {
      throw notFound("Watcher not found");
    }
    await this.store.update((state) => {
      if (paused) state.automationWatcherPause[id] = true;
      else delete state.automationWatcherPause[id];
    });
    return this.view();
  }

  async actOnApproval(
    id: string,
    action: "approve" | "deny",
  ): Promise<void> {
    const approval = this.store
      .getState()
      .automationApprovals.find((item) => item.id === id);
    if (!approval) throw notFound("Approval not found");
    if (approval.status !== "pending") {
      throw conflict("Approval is not pending");
    }
    const now = this.now();
    if (approval.expiresAt <= now) {
      await this.updateApproval(id, "expired", now);
      throw conflict("Approval expired");
    }

    if (action === "deny") {
      await this.updateApproval(id, "denied", now);
      await this.recordApprovalRun(
        approval,
        "skipped",
        "denied",
        "Denied by a human",
      );
      return;
    }

    if (this.paused) throw conflict("Automation is paused");

    const plan = approval.plan as
      | { text?: unknown; answers?: unknown; label?: unknown }
      | undefined;
    const text = typeof plan?.text === "string" ? plan.text : undefined;
    const answers = Array.isArray(plan?.answers)
      ? (plan.answers as SendAnswer[])
      : undefined;

    if (!text || !answers) {
      // An escalation approval has no executable plan; approving it records
      // that a human handled the item elsewhere.
      await this.updateApproval(id, "approved", now);
      await this.recordApprovalRun(
        approval,
        "skipped",
        "no_plan",
        "Approved without an automated action",
      );
      return;
    }

    try {
      await this.actions.send(
        approval.sessionRef,
        { text, answers },
        `approval:${approval.id}`,
      );
    } catch (error) {
      if (error instanceof Error && (error as { status?: number }).status === 409) {
        await this.updateApproval(id, "expired", now);
        await this.recordApprovalRun(
          approval,
          "failed",
          "question_changed",
          error.message,
        );
        throw conflict("The question changed; refresh and try again");
      }
      await this.recordApprovalRun(
        approval,
        "failed",
        "send_failed",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    await this.updateApproval(id, "approved", now);
    await this.recordApprovalRun(
      approval,
      "acted",
      "approved",
      typeof plan?.label === "string"
        ? `Approved: ${plan.label}`
        : "Approved by a human",
      true,
    );
  }

  private async handleAttention(item: Attention): Promise<void> {
    if (!this.config.enabled || this.paused) return;

    const state = this.store.getState();
    const watchers = this.config.watchers.filter(
      (watcher) =>
        watcher.enabled &&
        !state.automationWatcherPause[watcher.id] &&
        matches(watcher, item),
    );

    for (const watcher of watchers) {
      if (!(await this.acquire(`${watcher.id}:${item.id}`))) continue;
      await this.evaluate(watcher, item);
    }
  }

  private async evaluate(
    watcher: AutomationWatcher,
    item: Attention,
  ): Promise<void> {
    const dryRun = this.dryRun || watcher.dryRun;

    if (watcher.action.kind === "answer") {
      const plan = await this.planAnswer(watcher, item);
      if (!plan.ok) {
        if (plan.reason === "question_resolved") {
          await this.record(watcher, item, "skipped", plan.reason);
          return;
        }
        const proposal = await this.proposal(watcher, item);
        if (dryRun) {
          await this.record(
            watcher,
            item,
            "dry_run",
            `would_escalate:${plan.reason}`,
            proposal ? `Would propose: ${proposal.choice.label}` : undefined,
          );
          return;
        }
        await this.escalate(watcher, item, plan.reason, proposal);
        return;
      }

      if (dryRun) {
        await this.record(
          watcher,
          item,
          "dry_run",
          "dry_run",
          `Would answer: ${plan.choice.label}`,
        );
        return;
      }

      if (!this.withinBudget(watcher)) {
        await this.record(watcher, item, "skipped", "budget");
        return;
      }

      try {
        await this.actions.send(
          item.sessionRef,
          { text: plan.choice.text, answers: [plan.answer] },
          `automation:${watcher.id}:${item.id}`,
        );
        await this.record(
          watcher,
          item,
          "acted",
          "answered",
          `Answered: ${plan.choice.label}`,
        );
      } catch (error) {
        await this.record(
          watcher,
          item,
          "failed",
          "send_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }

    if (dryRun) {
      await this.record(watcher, item, "dry_run", "dry_run", "Would escalate");
      return;
    }
    await this.escalate(watcher, item, "watcher_action");
  }

  private async planAnswer(
    watcher: AutomationWatcher,
    item: Attention,
  ): Promise<AnswerPlan | PlanFailure> {
    let prompt;
    try {
      prompt = await this.questions.get(item.sessionRef);
    } catch {
      return { ok: false, reason: "question_unavailable" };
    }
    if (!prompt) return { ok: false, reason: "question_resolved" };
    if (prompt.questions.length !== 1) {
      return { ok: false, reason: "multiple_questions" };
    }

    const question = prompt.questions[0]!;
    if (!isLowRiskQuestion(question)) {
      return { ok: false, reason: "not_low_risk" };
    }

    const action =
      watcher.action.kind === "answer" ? watcher.action : undefined;
    if (!action) return { ok: false, reason: "not_an_answer_watcher" };

    const choice = pickSafeChoice(question, action);
    if (!choice) return { ok: false, reason: "no_safe_choice" };

    return {
      ok: true,
      question,
      choice,
      answer: {
        questionId: question.id,
        messageId: prompt.messageId,
        revision: prompt.revision,
        choiceId: choice.id,
        source: "choice",
      },
    };
  }

  /** A concrete answer to offer in the approval queue, ignoring risk gates. */
  private async proposal(
    watcher: AutomationWatcher,
    item: Attention,
  ): Promise<AnswerPlan | undefined> {
    if (watcher.action.kind !== "answer") return undefined;
    let prompt;
    try {
      prompt = await this.questions.get(item.sessionRef);
    } catch {
      return undefined;
    }
    if (!prompt || prompt.questions.length !== 1) return undefined;
    const question = prompt.questions[0]!;
    const choice = pickProposalChoice(question, watcher.action);
    if (!choice) return undefined;
    return {
      ok: true,
      question,
      choice,
      answer: {
        questionId: question.id,
        messageId: prompt.messageId,
        revision: prompt.revision,
        choiceId: choice.id,
        source: "choice",
      },
    };
  }

  private async escalate(
    watcher: AutomationWatcher,
    item: Attention,
    reason: string,
    plan?: AnswerPlan,
  ): Promise<void> {
    const existing = this.store
      .getState()
      .automationApprovals.find(
        (approval) =>
          approval.attentionID === item.id && approval.status === "pending",
      );
    if (existing) {
      await this.record(watcher, item, "skipped", "approval_pending");
      return;
    }

    const now = this.now();
    const approval: AutomationApproval = {
      id: randomUUID(),
      watcherID: watcher.id,
      attentionID: item.id,
      sessionRef: item.sessionRef,
      title: item.title,
      summary: item.summary,
      action: watcher.action,
      reason,
      status: "pending",
      createdAt: now,
      expiresAt: now + this.config.approvalTtlMs,
      ...(plan
        ? {
            plan: {
              text: plan.choice.text,
              answers: [plan.answer],
              label: plan.choice.label,
            },
          }
        : {}),
    };

    await this.store.update((state) => {
      state.automationApprovals.push(approval);
      const overflow = state.automationApprovals.length - MAX_APPROVALS;
      if (overflow > 0) state.automationApprovals.splice(0, overflow);
    });
    await this.eventBus.publish("automation.approval", approval, {
      sessionRef: item.sessionRef,
      attentionID: item.id,
    });
    await this.record(watcher, item, "escalated", reason);
  }

  private withinBudget(watcher: AutomationWatcher): boolean {
    const now = this.now();
    const acted = this.store
      .getState()
      .automationRuns.filter((run) => run.decision === "acted");
    const hour = acted.filter((run) => run.at >= now - HOUR_MS).length;
    const day = acted.filter((run) => run.at >= now - DAY_MS).length;
    const watcherHour = acted.filter(
      (run) => run.watcherID === watcher.id && run.at >= now - HOUR_MS,
    ).length;
    const watcherDay = acted.filter(
      (run) => run.watcherID === watcher.id && run.at >= now - DAY_MS,
    ).length;

    return (
      hour < this.config.maxActionsPerHour &&
      day < this.config.maxActionsPerDay &&
      watcherHour < watcher.limits.maxActionsPerHour &&
      watcherDay < watcher.limits.maxActionsPerDay
    );
  }

  private async record(
    watcher: AutomationWatcher,
    item: Attention,
    decision: AutomationRun["decision"],
    reason: string,
    detail?: string,
  ): Promise<void> {
    const run: AutomationRun = {
      id: randomUUID(),
      watcherID: watcher.id,
      trigger: `attention:${item.type}`,
      decision,
      reason,
      sessionRef: item.sessionRef,
      attentionID: item.id,
      action: watcher.action.kind,
      ...(detail ? { detail } : {}),
      at: this.now(),
    };
    await this.store.update((state) => {
      state.automationRuns.push(run);
      const overflow = state.automationRuns.length - this.config.audit.maxRuns;
      if (overflow > 0) state.automationRuns.splice(0, overflow);
    });
    await this.eventBus.publish("automation.run", run, {
      ...(item.sessionRef ? { sessionRef: item.sessionRef } : {}),
      attentionID: item.id,
    });
  }

  private async recordApprovalRun(
    approval: AutomationApproval,
    decision: AutomationRun["decision"],
    reason: string,
    detail: string,
    approved = false,
  ): Promise<void> {
    const run: AutomationRun = {
      id: randomUUID(),
      watcherID: approval.watcherID,
      trigger: "approval",
      decision,
      reason,
      sessionRef: approval.sessionRef,
      attentionID: approval.attentionID,
      action: approval.action.kind,
      detail,
      at: this.now(),
      ...(approved ? { approved: true } : {}),
    };
    await this.store.update((state) => {
      state.automationRuns.push(run);
      const overflow = state.automationRuns.length - this.config.audit.maxRuns;
      if (overflow > 0) state.automationRuns.splice(0, overflow);
    });
  }

  private async updateApproval(
    id: string,
    status: AutomationApproval["status"],
    decidedAt: number,
  ): Promise<void> {
    await this.store.update((state) => {
      const approval = state.automationApprovals.find((item) => item.id === id);
      if (!approval) return;
      approval.status = status;
      approval.decidedAt = decidedAt;
    });
  }

  private async acquire(key: string): Promise<boolean> {
    const now = this.now();
    let acquired = false;
    await this.store.update((state) => {
      for (const [lease, expiresAt] of Object.entries(
        state.automationLeases,
      )) {
        if (expiresAt <= now) delete state.automationLeases[lease];
      }
      const existing = state.automationLeases[key] ?? 0;
      if (existing <= now) {
        state.automationLeases[key] = now + this.leaseTtlMs;
        acquired = true;
      }
    });
    return acquired;
  }
}

export function isLowRiskQuestion(question: PendingQuestion): boolean {
  if (question.risk !== "normal") return false;
  if (question.kind !== "boolean" && question.kind !== "choice") return false;
  if (question.multiSelect || question.allowsFreeText) return false;
  if (question.choices.length === 0) return false;
  return question.choices.every(
    (choice) =>
      choice.source === "explicit" &&
      !choice.destructive &&
      !choice.sensitive &&
      !choice.requiresConfirmation,
  );
}

export function pickProposalChoice(
  question: PendingQuestion,
  action: Extract<AutomationAction, { kind: "answer" }>,
): AnswerChoice | undefined {
  if (action.choice === "first-safe") {
    return question.choices.find(
      (choice) =>
        choice.source === "explicit" &&
        !choice.destructive &&
        !choice.sensitive &&
        !choice.requiresConfirmation,
    );
  }
  if (!action.value) return undefined;
  const match = question.choices.find((choice) =>
    action.choice === "id"
      ? choice.id === action.value
      : choice.label === action.value,
  );
  return match?.source === "explicit" ? match : undefined;
}

export function pickSafeChoice(
  question: PendingQuestion,
  action: Extract<AutomationAction, { kind: "answer" }>,
): AnswerChoice | undefined {
  const safe = question.choices.filter(
    (choice) =>
      !choice.destructive &&
      !choice.sensitive &&
      !choice.requiresConfirmation,
  );
  if (safe.length === 0) return undefined;
  if (action.choice === "first-safe") return safe[0];
  if (!action.value) return undefined;
  return safe.find((choice) =>
    action.choice === "id"
      ? choice.id === action.value
      : choice.label === action.value,
  );
}

function matches(watcher: AutomationWatcher, item: Attention): boolean {
  if (!watcher.trigger.types.includes(item.type)) return false;
  const condition = watcher.condition;
  if (!condition) return true;
  const providerID = item.sessionRef.slice(0, item.sessionRef.indexOf(":"));
  if (condition.providerID && condition.providerID !== providerID) {
    return false;
  }
  if (condition.sessionRef && condition.sessionRef !== item.sessionRef) {
    return false;
  }
  if (
    condition.titleContains &&
    !item.title
      .toLowerCase()
      .includes(condition.titleContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}
