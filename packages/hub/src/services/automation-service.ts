import { createHash, randomUUID } from "node:crypto";
import {
  zAttention,
  type AnswerChoice,
  type Attention,
  type AutomationAction,
  type AutomationApproval,
  type AutomationRun,
  type AutomationSettingsInput,
  type AutomationShape,
  type AutomationView,
  type AutomationWatcher,
  type PendingQuestion,
  type SendAnswer,
  type Session,
} from "@amoshydra/oktoso-contracts";
import type {
  AutomationApprovalState,
  StateStore,
} from "@amoshydra/oktoso-storage";
import type { AutomationConfig } from "../config/schema";
import { conflict, notFound } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { EventBus } from "./event-bus";
import type { NotificationService } from "./notification-service";
import { isQuietHours } from "./notification-service";
import type { QuestionService } from "./question-service";
import type { SessionActions } from "./session-actions";
import type { SessionService } from "./session-service";

export interface AutomationServiceOptions {
  config: AutomationConfig;
  store: StateStore;
  eventBus: EventBus;
  logger: Logger;
  questions: QuestionService;
  actions: SessionActions;
  sessions: SessionService;
  notifications?: NotificationService;
  now?: () => number;
  leaseTtlMs?: number;
  retryDelayMs?: number;
}

interface AnswerPlan {
  ok: true;
  question: PendingQuestion;
  choice: AnswerChoice;
  answer: SendAnswer;
  /** Set when a remembered shape, rather than the low-risk allowlist, allowed it. */
  viaShape?: boolean;
  shapeID?: string;
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
  private readonly sessions: SessionService;
  private readonly notifications?: NotificationService;
  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private readonly retryDelayMs: number;
  private readonly lastStatus = new Map<
    string,
    { status: Session["status"]; since: number }
  >();
  private readonly lastSchedule = new Map<string, number>();
  private stopListening?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private readonly inFlight = new Map<
    string,
    { watcherID: string; controller: AbortController }
  >();
  private work: Promise<void> = Promise.resolve();

  constructor(options: AutomationServiceOptions) {
    this.config = options.config;
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.questions = options.questions;
    this.actions = options.actions;
    this.sessions = options.sessions;
    this.notifications = options.notifications;
    this.now = options.now ?? Date.now;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.retryDelayMs = options.retryDelayMs ?? 500;
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
    if (
      this.config.watchers.some(
        (watcher) =>
          watcher.trigger.kind === "session" ||
          watcher.trigger.kind === "schedule",
      )
    ) {
      const now = this.now();
      for (const watcher of this.config.watchers) {
        if (watcher.trigger.kind === "schedule") {
          this.lastSchedule.set(watcher.id, now);
        }
      }
      this.timer = setInterval(
        () => void this.tick(),
        this.config.pollIntervalMs,
      );
      this.timer.unref?.();
    }
    return this.stopListening;
  }

  stop(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.abortAll();
  }

  /** Await every handler queued so far. Tests use this. */
  async whenIdle(): Promise<void> {
    await this.work;
  }

  /** Run one session/schedule poll immediately. Tests and the CLI use this. */
  async tickNow(): Promise<void> {
    await this.tick();
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
      approvals: state.automationApprovals
        .filter(
          (approval) =>
            approval.status === "pending" && approval.expiresAt > now,
        )
        .map(toPublicApproval),
      allowedShapes: state.automationAllowedShapes,
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
      )
      .map(toPublicApproval);
  }

  async updateSettings(input: AutomationSettingsInput): Promise<AutomationView> {
    await this.store.update((state) => {
      if (input.paused !== undefined) state.automationPaused = input.paused;
      if (input.dryRun !== undefined) state.automationDryRun = input.dryRun;
    });
    if (input.paused === true) this.abortAll();
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
    if (paused) this.abortWatcher(id);
    return this.view();
  }

  async actOnApproval(
    id: string,
    action: "approve" | "deny" | "always",
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

    const plan = approval.plan;
    const text = plan?.text;
    const answers = plan?.answers;

    if (action === "always" && (!plan || !approval.shape)) {
      throw conflict("This approval has no shape to remember");
    }

    if (!plan || !text || !answers) {
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

    if (action === "always" && approval.shape) {
      await this.addShape(approval.shape);
    }

    await this.updateApproval(id, "approved", now);
    await this.recordApprovalRun(
      approval,
      "acted",
      action === "always" ? "always_allowed" : "approved",
      typeof plan?.label === "string"
        ? `${action === "always" ? "Always allowed" : "Approved"}: ${plan.label}`
        : "Approved by a human",
      true,
    );
  }

  async revokeShape(id: string): Promise<boolean> {
    let removed = false;
    await this.store.update((state) => {
      const index = state.automationAllowedShapes.findIndex(
        (shape) => shape.id === id,
      );
      if (index >= 0) {
        state.automationAllowedShapes.splice(index, 1);
        removed = true;
      }
    });
    return removed;
  }

  private async addShape(shape: AutomationShape): Promise<void> {
    await this.store.update((state) => {
      if (state.automationAllowedShapes.some((item) => item.id === shape.id)) {
        return;
      }
      state.automationAllowedShapes.push({
        ...shape,
        createdAt: this.now(),
        uses: 0,
      });
      const overflow = state.automationAllowedShapes.length - 100;
      if (overflow > 0) state.automationAllowedShapes.splice(0, overflow);
    });
  }

  private async touchShape(id: string): Promise<void> {
    await this.store.update((state) => {
      const shape = state.automationAllowedShapes.find(
        (item) => item.id === id,
      );
      if (!shape) return;
      shape.uses += 1;
      shape.lastUsedAt = this.now();
    });
  }

  private async tick(): Promise<void> {
    if (!this.config.enabled || this.paused || this.ticking) return;
    this.ticking = true;
    try {
      await this.tickSessions();
      await this.tickSchedules();
    } catch (error) {
      this.logger.warn("Automation tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ticking = false;
    }
  }

  private async tickSessions(): Promise<void> {
    const state = this.store.getState();
    const watchers = this.config.watchers.filter(
      (watcher) =>
        watcher.enabled &&
        watcher.trigger.kind === "session" &&
        !state.automationWatcherPause[watcher.id],
    );
    if (watchers.length === 0) return;

    const page = await this.sessions.list({ limit: 200 });
    const now = this.now();
    const seen = new Set<string>();

    for (const session of page.data) {
      seen.add(session.ref);
      const previous = this.lastStatus.get(session.ref);
      if (!previous || previous.status !== session.status) {
        this.lastStatus.set(session.ref, {
          status: session.status,
          since: now,
        });
        continue;
      }

      for (const watcher of watchers) {
        if (watcher.trigger.kind !== "session") continue;
        if (watcher.trigger.on !== session.status) continue;
        if (!matchesSession(watcher, session)) continue;
        if (now - previous.since < watcher.trigger.idleMs) continue;

        const key = `session:${watcher.id}:${session.ref}:${session.status}:${previous.since}`;
        if (!(await this.acquire(key))) continue;
        await this.evaluateSession(watcher, session);
      }
    }

    for (const ref of [...this.lastStatus.keys()]) {
      if (!seen.has(ref)) this.lastStatus.delete(ref);
    }
  }

  private async tickSchedules(): Promise<void> {
    const state = this.store.getState();
    const watchers = this.config.watchers.filter(
      (watcher) =>
        watcher.enabled &&
        watcher.trigger.kind === "schedule" &&
        !state.automationWatcherPause[watcher.id],
    );
    if (watchers.length === 0) return;

    const now = this.now();
    for (const watcher of watchers) {
      if (watcher.trigger.kind !== "schedule") continue;
      const last = this.lastSchedule.get(watcher.id) ?? now;
      if (now - last < watcher.trigger.everyMs) continue;
      this.lastSchedule.set(watcher.id, now);
      const bucket = Math.floor(now / watcher.trigger.everyMs);
      if (!(await this.acquire(`schedule:${watcher.id}:${bucket}`))) continue;
      await this.evaluateSchedule(watcher);
    }
  }

  private async evaluateSession(
    watcher: AutomationWatcher,
    session: Session,
  ): Promise<void> {
    const item: Attention = {
      id: `automation:session:${watcher.id}:${session.ref}:${session.status}:${session.updatedAt}`,
      sessionRef: session.ref,
      type: session.status === "error" ? "error" : "unread",
      priority: "high",
      title: session.title,
      summary:
        session.status === "error" ? "Session failed" : "Session is idle",
      createdAt: this.now(),
      actions: [],
    };
    await this.evaluate(watcher, item);
  }

  private async evaluateSchedule(
    watcher: AutomationWatcher,
  ): Promise<void> {
    const ref = watcher.condition?.sessionRef;
    const now = this.now();
    let session: Session | undefined;
    if (ref) {
      try {
        session = await this.sessions.get(ref);
      } catch {
        session = undefined;
      }
    }
    const item: Attention = {
      id: `automation:schedule:${watcher.id}:${now}`,
      sessionRef: ref ?? "automation:schedule",
      type: "unread",
      priority: "high",
      title: session?.title ?? watcher.name ?? watcher.id,
      summary: `Scheduled check · ${watcher.name ?? watcher.id}`,
      createdAt: now,
      actions: [],
    };
    if (!ref && watcher.action.kind !== "start") {
      await this.record(watcher, item, "skipped", "missing_target");
      return;
    }
    await this.evaluate(watcher, item);
  }

  private async retryTurn(
    item: Attention,
    signal?: AbortSignal,
  ): Promise<void> {
    const page = await this.sessions.messages(item.sessionRef, {
      limit: 20,
      order: "desc",
    });
    const failed = page.data.find((message) => message.metadata?.error);
    if (!failed) throw new Error("No failed message to retry");
    await this.sessions.retryMessage(item.sessionRef, failed.id, signal);
  }

  private async withRetry<T>(
    action: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
    try {
      return await action();
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isTerminalError(error)) throw error;
      if (this.retryDelayMs > 0) {
        await sleepAbortable(this.retryDelayMs, signal);
      }
      return action();
    }
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
    const quiet = isQuietHours(this.now(), this.config.quietHours);

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

      if (quiet) {
        await this.escalate(watcher, item, "quiet_hours", plan);
        return;
      }

      if (!this.withinBudget(watcher)) {
        await this.record(watcher, item, "skipped", "budget");
        return;
      }

      await this.runAction(watcher, item, "send", async (signal) => {
        await this.withRetry(
          () =>
            this.actions.send(
              item.sessionRef,
              { text: plan.choice.text, answers: [plan.answer] },
              `automation:${watcher.id}:${item.id}`,
              signal,
            ),
          signal,
        );
        if (plan.viaShape && plan.shapeID) {
          await this.touchShape(plan.shapeID);
        }
        return {
          reason: plan.viaShape ? "answered_shape" : "answered",
          detail: `Answered: ${plan.choice.label}`,
        };
      });
      return;
    }

    if (watcher.action.kind === "retry") {
      if (item.type !== "error") {
        await this.record(watcher, item, "skipped", "invalid_action");
        return;
      }
      if (dryRun) {
        await this.record(
          watcher,
          item,
          "dry_run",
          "dry_run",
          "Would retry the failed turn",
        );
        return;
      }
      if (quiet) {
        await this.escalate(watcher, item, "quiet_hours");
        return;
      }
      if (!this.withinBudget(watcher)) {
        await this.record(watcher, item, "skipped", "budget");
        return;
      }
      await this.runAction(watcher, item, "retry", async (signal) => {
        await this.withRetry(() => this.retryTurn(item, signal), signal);
        return {
          reason: "retried",
          detail: "Retried the failed turn",
        };
      });
      return;
    }

    if (watcher.action.kind === "start") {
      const action = watcher.action;
      const template = this.config.templates.find(
        (item) => item.id === action.template,
      );
      if (!template) {
        await this.record(watcher, item, "skipped", "template_missing");
        return;
      }
      if (dryRun) {
        await this.record(
          watcher,
          item,
          "dry_run",
          "dry_run",
          `Would start ${template.title}`,
        );
        return;
      }
      if (!this.withinBudget(watcher)) {
        await this.record(watcher, item, "skipped", "budget");
        return;
      }
      await this.runAction(watcher, item, "start", async (signal) => {
        const session = await this.withRetry(
          () =>
            this.sessions.create(
              {
                providerID: template.providerID,
                title: template.title,
                ...(template.directory
                  ? { directory: template.directory }
                  : {}),
                ...(template.agent ? { agent: template.agent } : {}),
                ...(template.model ? { model: template.model } : {}),
                ...(template.text ? { text: template.text } : {}),
              },
              signal,
            ),
          signal,
        );
        return {
          reason: "started",
          detail: `Started ${session.ref}`,
        };
      });
      return;
    }

    if (watcher.action.kind === "notify") {
      if (!this.notifications || !this.notifications.enabled) {
        await this.record(watcher, item, "skipped", "notifications_disabled");
        return;
      }
      if (dryRun) {
        await this.record(watcher, item, "dry_run", "dry_run", "Would notify");
        return;
      }
      if (!this.withinBudget(watcher)) {
        await this.record(watcher, item, "skipped", "budget");
        return;
      }
      try {
        await this.withRetry(() => this.notifications!.notify(item));
        await this.record(watcher, item, "acted", "notified", "Notification sent");
      } catch (error) {
        await this.record(
          watcher,
          item,
          "failed",
          "notify_failed",
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
    const action =
      watcher.action.kind === "answer" ? watcher.action : undefined;
    if (!action) return { ok: false, reason: "not_an_answer_watcher" };

    const lowRisk = isLowRiskQuestion(question);
    const choice = pickProposalChoice(question, action);
    if (!choice) return { ok: false, reason: "no_safe_choice" };

    let shapeID: string | undefined;
    if (!lowRisk && isChoiceSafe(choice)) {
      const shape = shapeFor(watcher, question, choice, this.now());
      if (
        shape &&
        this.store
          .getState()
          .automationAllowedShapes.some((item) => item.id === shape.id)
      ) {
        shapeID = shape.id;
      }
    }
    if (!lowRisk && !shapeID) {
      return { ok: false, reason: "not_low_risk" };
    }

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
      ...(shapeID ? { viaShape: true, shapeID } : {}),
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
    const shape = plan
      ? shapeFor(watcher, plan.question, plan.choice, now)
      : undefined;
    const approval: AutomationApprovalState = {
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
      ...(shape ? { shape } : {}),
    };

    await this.store.update((state) => {
      state.automationApprovals.push(approval);
      const overflow = state.automationApprovals.length - MAX_APPROVALS;
      if (overflow > 0) state.automationApprovals.splice(0, overflow);
    });
    await this.eventBus.publish("automation.approval", toPublicApproval(approval), {
      sessionRef: item.sessionRef,
      attentionID: item.id,
    });
    await this.record(watcher, item, "escalated", reason);
  }

  private beginAction(watcherID: string): {
    key: string;
    controller: AbortController;
  } {
    const key = randomUUID();
    const controller = new AbortController();
    this.inFlight.set(key, { watcherID, controller });
    return { key, controller };
  }

  private endAction(key: string): void {
    this.inFlight.delete(key);
  }

  private abortAll(): void {
    for (const entry of this.inFlight.values()) entry.controller.abort();
    this.inFlight.clear();
  }

  private abortWatcher(id: string): void {
    for (const [key, entry] of this.inFlight) {
      if (entry.watcherID !== id) continue;
      entry.controller.abort();
      this.inFlight.delete(key);
    }
  }

  private async runAction(
    watcher: AutomationWatcher,
    item: Attention,
    action: string,
    work: (signal: AbortSignal) => Promise<{
      reason: string;
      detail: string;
    }>,
  ): Promise<void> {
    const entry = this.beginAction(watcher.id);
    try {
      const result = await work(entry.controller.signal);
      await this.record(
        watcher,
        item,
        "acted",
        result.reason,
        result.detail,
      );
    } catch (error) {
      if (entry.controller.signal.aborted) {
        await this.record(
          watcher,
          item,
          "skipped",
          "aborted",
          "Paused before the action completed",
        );
        return;
      }
      await this.record(
        watcher,
        item,
        "failed",
        `${action}_failed`,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.endAction(entry.key);
    }
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
    approval: AutomationApprovalState,
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
    let updated: AutomationApprovalState | undefined;
    await this.store.update((state) => {
      const approval = state.automationApprovals.find((item) => item.id === id);
      if (!approval) return;
      approval.status = status;
      approval.decidedAt = decidedAt;
      updated = approval;
    });
    if (updated) {
      await this.eventBus.publish(
        "automation.approval",
        toPublicApproval(updated),
        {
          sessionRef: updated.sessionRef,
          attentionID: updated.attentionID,
        },
      );
    }
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

function shapeFor(
  watcher: AutomationWatcher,
  question: PendingQuestion,
  choice: AnswerChoice,
  at: number,
): AutomationShape | undefined {
  if (question.risk !== "normal" || question.source !== "explicit") {
    return undefined;
  }
  if (question.kind !== "boolean" && question.kind !== "choice") {
    return undefined;
  }
  if (question.multiSelect || question.allowsFreeText) return undefined;
  if (!isChoiceSafe(choice)) return undefined;

  const choices = question.choices.map((item) => item.label).sort();
  const choiceKey = normalizeLabel(choice.label);
  const id = createHash("sha256")
    .update(
      [
        watcher.id,
        question.kind,
        ...choices.map(normalizeLabel),
        choiceKey,
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    id,
    watcherID: watcher.id,
    kind: question.kind,
    choices,
    choice: choiceKey,
    label: choice.label,
    createdAt: at,
    uses: 0,
  };
}

function isChoiceSafe(choice: AnswerChoice): boolean {
  return (
    choice.source === "explicit" &&
    !choice.destructive &&
    !choice.sensitive &&
    !choice.requiresConfirmation
  );
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toPublicApproval(
  approval: AutomationApprovalState,
): AutomationApproval {
  const { plan, shape, ...base } = approval;
  return {
    ...base,
    actionable: Boolean(plan),
    allowShape: Boolean(shape),
    ...(plan
      ? {
          proposed: {
            text: plan.text,
            ...(plan.label ? { label: plan.label } : {}),
          },
        }
      : {}),
  };
}

function matchesSession(
  watcher: AutomationWatcher,
  session: Session,
): boolean {
  if (watcher.trigger.kind !== "session") return false;
  const condition = watcher.condition;
  if (!condition) return true;
  if (condition.providerID && condition.providerID !== session.providerID) {
    return false;
  }
  if (condition.sessionRef && condition.sessionRef !== session.ref) {
    return false;
  }
  if (
    condition.titleContains &&
    !session.title.toLowerCase().includes(condition.titleContains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function sleepAbortable(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("Aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("Aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isTerminalError(error: unknown): boolean {
  const status = (error as { status?: unknown } | undefined)?.status;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

function matches(watcher: AutomationWatcher, item: Attention): boolean {
  if (watcher.trigger.kind !== "attention") return false;
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
