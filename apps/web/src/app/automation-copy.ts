/**
 * Human copy for automation internals.
 *
 * The hub records short codes (`not_low_risk`, `form_unmapped`, `budget`) so
 * runs stay compact and stable. Those codes are not sentences, and the UI was
 * printing them verbatim. Map the known codes here and fall back to the code
 * with its underscores opened up, so a new reason degrades instead of
 * disappearing.
 */
const REASON_LABELS: Record<string, string> = {
  aborted: "Stopped by Pause",
  answered: "Answered automatically",
  answered_shape: "Answered from an allowed pattern",
  approval_pending: "An approval was already waiting",
  budget: "The action budget is used up",
  dry_run: "Recorded only",
  form_unmapped: "The provider form needs a human",
  invalid_action: "The action was not valid for this question",
  missing_target: "The rule has no target session",
  multiple_questions: "More than one question was waiting",
  no_safe_choice: "No safe option was offered",
  not_an_answer_watcher: "This rule does not answer questions",
  not_low_risk: "No safe answer was available",
  notified: "Notification sent",
  notifications_disabled: "Notifications are off",
  notify_failed: "The notification failed",
  question_resolved: "The question was already answered",
  question_unavailable: "The question was no longer available",
  quiet_hours: "Quiet hours: escalated instead of acting",
  retried: "Retried once",
  send_failed: "The reply failed to send",
  started: "Started the session",
  template_missing: "The template is missing",
  watcher_action: "Handled by the rule",
};

export function automationReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}
