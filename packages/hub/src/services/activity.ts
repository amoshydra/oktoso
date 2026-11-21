import {
  MAX_ASSISTANT_ACTIVITY_STEPS,
  type AssistantStep,
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
