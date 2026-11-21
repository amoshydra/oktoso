import { randomUUID } from "node:crypto";
import {
  MAX_ASSISTANT_ACTIVITY_STEPS,
  type AssistantStep,
  type AssistantStepKind,
  type AssistantStepMetrics,
} from "@amoshydra/oktoso-contracts";

/**
 * Fold an over-long run into the contract's cap.
 *
 * The live SSE stream is deliberately unbounded: a subscriber watching a run
 * should see every step. The *persisted* turn is not, because `zAssistantTurn`
 * re-validates it on every store write. A tool loop will exceed 40 steps, and
 * without this the whole turn would fail to save.
 *
 * The newest steps are folded into one honest summary item, so the transcript
 * says the run was long rather than silently pretending it was short.
 */
export function capActivity(steps: AssistantStep[]): AssistantStep[] {
  if (steps.length <= MAX_ASSISTANT_ACTIVITY_STEPS) return steps;
  const kept = steps.slice(0, MAX_ASSISTANT_ACTIVITY_STEPS - 1);
  const folded = steps.length - kept.length;
  const last = steps[steps.length - 1];
  return [
    ...kept,
    {
      id: `stp_folded_${folded}`,
      kind: "tool",
      label: `${folded} more steps`,
      detail: `The run emitted ${steps.length} steps; the last ${folded} are folded into this summary.`,
      status: "ok",
      at: last.at,
      durationMs: 0,
    },
  ];
}

/**
 * The surface every context builder reports through.
 *
 * Builders do not own the step array, do not cap it, and cannot emit after the
 * run settles: they only call `begin`/`finish`/`done`. That keeps a new builder
 * from silently forgetting a cap, and gives the run one place to close whatever
 * is still running.
 */
export interface StepSink {
  done(
    kind: AssistantStepKind,
    label: string,
    detail?: string,
    durationMs?: number,
    metrics?: AssistantStepMetrics,
  ): void;
  begin(
    kind: AssistantStepKind,
    label: string,
    detail?: string,
    metrics?: AssistantStepMetrics,
  ): AssistantStep;
  finish(
    step: AssistantStep,
    detail?: string,
    metrics?: AssistantStepMetrics,
  ): void;
}

export interface RunTraceOptions {
  now: () => number;
  /** Called on every push and every status change, for the live stream. */
  emit: (step: AssistantStep) => void;
}

/**
 * One run's activity: a collector, not a shared array.
 *
 * Steps are objects, so `finish` can turn a `running` step into `ok` and
 * `settle` can close one the run abandoned. `items()` is the only way out, and
 * it always returns a capped, contract-valid array.
 */
export class RunTrace implements StepSink {
  private readonly steps: AssistantStep[] = [];
  private settled = false;

  constructor(private readonly options: RunTraceOptions) {}

  done(
    kind: AssistantStepKind,
    label: string,
    detail?: string,
    durationMs?: number,
    metrics?: AssistantStepMetrics,
  ): void {
    this.push({
      id: this.id(),
      kind,
      label,
      status: "ok",
      at: this.options.now(),
      ...(detail ? { detail } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(metrics ? { metrics } : {}),
    });
  }

  begin(
    kind: AssistantStepKind,
    label: string,
    detail?: string,
    metrics?: AssistantStepMetrics,
  ): AssistantStep {
    const step: AssistantStep = {
      id: this.id(),
      kind,
      label,
      status: "running",
      at: this.options.now(),
      ...(detail ? { detail } : {}),
      ...(metrics ? { metrics } : {}),
    };
    this.push(step);
    return step;
  }

  finish(
    step: AssistantStep,
    detail?: string,
    metrics?: AssistantStepMetrics,
  ): void {
    step.status = "ok";
    step.durationMs = Math.max(0, this.options.now() - step.at);
    if (detail) step.detail = detail;
    if (metrics) step.metrics = { ...step.metrics, ...metrics };
    this.options.emit({ ...step });
  }

  /** Mark a step failed without aborting the run. */
  fail(step: AssistantStep, message: string): void {
    step.status = "error";
    step.detail = message;
    step.durationMs = Math.max(0, this.options.now() - step.at);
    this.options.emit({ ...step });
  }

  /**
   * Close every step still running when the run ended on its own terms.
   * Cancelled is not an error, and the renderer treats it as neither.
   */
  settle(outcome: "cancelled" | "error", message?: string): void {
    this.settled = true;
    for (const step of this.steps) {
      if (step.status !== "running") continue;
      step.status = outcome;
      if (message) step.detail = message;
      step.durationMs = Math.max(0, this.options.now() - step.at);
      this.options.emit({ ...step });
    }
  }

  /** The persisted form. Capped here, and again at the store boundary. */
  items(): AssistantStep[] {
    return capActivity(this.steps);
  }

  /** Raw count before capping, for the evidence line. */
  get size(): number {
    return this.steps.length;
  }

  private push(step: AssistantStep): void {
    if (this.settled) return;
    this.steps.push(step);
    this.options.emit({ ...step });
  }

  private id(): string {
    return `stp_${randomUUID()}`;
  }
}
