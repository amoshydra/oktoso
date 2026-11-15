import { useEffect, useState } from "react";
import type {
  AutomationApproval,
  AutomationApprovalAction,
  AutomationRun,
  AutomationTrigger,
  AutomationView,
} from "@amoshydra/oktoso-contracts";
import type { HubClient } from "@amoshydra/oktoso-client";

const DECISION_LABELS: Record<AutomationRun["decision"], string> = {
  acted: "Acted",
  escalated: "Escalated",
  dry_run: "Dry run",
  skipped: "Skipped",
  failed: "Failed",
};

function triggerLabel(trigger: AutomationTrigger): string {
  if (trigger.kind === "attention") return trigger.types.join(", ");
  if (trigger.kind === "session") return `session ${trigger.on}`;
  return `every ${Math.round(trigger.everyMs / 60_000)}m`;
}

function formatWhen(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
}

export function AutomationSettingsPanel(props: { client: HubClient }) {
  const [view, setView] = useState<AutomationView>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [confirmShape, setConfirmShape] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = async (spinner = true) => {
    if (spinner) setLoading(true);
    setError(undefined);
    try {
      setView(await props.client.automation());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load automation",
      );
    } finally {
      if (spinner) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => window.clearInterval(timer);
  }, [props.client]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Automation action failed",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const togglePause = () =>
    run("pause", async () => {
      if (!view) return;
      setView(await props.client.saveAutomation({ paused: !view.paused }));
      setNotice(view.paused ? "Automation resumed." : "Automation paused.");
    });

  const toggleDryRun = () =>
    run("dry-run", async () => {
      if (!view) return;
      setView(await props.client.saveAutomation({ dryRun: !view.dryRun }));
      setNotice(
        view.dryRun
          ? "Dry run disabled. Watchers may act."
          : "Dry run enabled. Watchers will only record.",
      );
    });

  const toggleWatcher = (id: string, paused: boolean) =>
    run(`watcher:${id}`, async () => {
      setView(await props.client.pauseWatcher(id, !paused));
    });

  const decide = (
    approval: AutomationApproval,
    action: AutomationApprovalAction,
  ) =>
    run(`approval:${approval.id}`, async () => {
      await props.client.actOnApproval(approval.id, action);
      setConfirmShape(undefined);
      await load(false);
      setNotice(
        action === "deny"
          ? "Approval denied."
          : action === "always"
            ? "Approval executed and this shape remembered."
            : "Approval executed.",
      );
    });

  const revokeShape = (id: string) =>
    run(`shape:${id}`, async () => {
      await props.client.revokeAutomationShape(id);
      await load(false);
      setNotice("Allowed shape revoked.");
    });

  const badge = view?.paused
    ? "paused"
    : view?.dryRun
      ? "dry run"
      : view?.enabled
        ? "armed"
        : "off";

  return (
    <section className="settings-automation">
      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Automation</h2>
            <p>
              Watchers act on attention under a policy. Dry run is the default
              and never sends.
            </p>
          </div>
          <span className="mode-badge">{badge}</span>
        </div>

        <div className="form-actions">
          <button
            className={view?.paused ? "btn primary small" : "btn small"}
            type="button"
            disabled={!view || busy === "pause"}
            onClick={() => void togglePause()}
          >
            {busy === "pause" ? "Saving…" : view?.paused ? "Resume" : "Pause all"}
          </button>
          <button
            className="btn small"
            type="button"
            disabled={!view || busy === "dry-run"}
            onClick={() => void toggleDryRun()}
          >
            {busy === "dry-run"
              ? "Saving…"
              : view?.dryRun
                ? "Disable dry run"
                : "Use dry run"}
          </button>
        </div>

        {view && !view.enabled ? (
          <p className="form-note">
            Automation is off in the hub config. Add watchers under{" "}
            <code>automation.watchers</code> and set{" "}
            <code>automation.enabled</code>.
          </p>
        ) : null}
        {notice ? (
          <p className="form-note" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Watchers</h2>
            <p>Configured in the hub file. Pause one without editing it.</p>
          </div>
          <span className="mode-badge">{view?.watchers.length ?? 0}</span>
        </div>

        {loading && !view ? (
          <p className="form-note">Loading automation…</p>
        ) : view && view.watchers.length > 0 ? (
          <ul className="automation-list">
            {view.watchers.map((watcher) => {
              const paused = view.pausedWatchers.includes(watcher.id);
              return (
                <li key={watcher.id}>
                  <div className="settings-device-meta">
                    <span className="settings-device-name">
                      {watcher.name ?? watcher.id}
                    </span>
                    <span className="settings-device-detail">
                      {triggerLabel(watcher.trigger)} · {watcher.action.kind}
                      {watcher.dryRun ? " · dry run" : ""}
                      {paused ? " · paused" : ""}
                    </span>
                  </div>
                  <button
                    className="btn small"
                    type="button"
                    disabled={busy === `watcher:${watcher.id}`}
                    aria-label={`${paused ? "Resume" : "Pause"} ${watcher.name ?? watcher.id}`}
                    onClick={() => void toggleWatcher(watcher.id, paused)}
                  >
                    {busy === `watcher:${watcher.id}`
                      ? "Saving…"
                      : paused
                        ? "Resume"
                        : "Pause"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="form-note">No watchers configured.</p>
        )}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Approvals</h2>
            <p>Actions the policy would not take without a human.</p>
          </div>
          <span className="mode-badge">{view?.approvals.length ?? 0}</span>
        </div>

        {view && view.approvals.length > 0 ? (
          <ul className="automation-list">
            {view.approvals.map((approval) => (
              <li key={approval.id}>
                <div className="settings-device-meta">
                  <span className="settings-device-name">
                    {approval.title}
                  </span>
                  <span className="settings-device-detail">
                    {approval.watcherID} · {approval.reason} ·{" "}
                    {approval.proposed?.text ?? approval.summary}
                  </span>
                </div>
                <div className="automation-actions">
                  <button
                    className="btn primary small"
                    type="button"
                    disabled={busy === `approval:${approval.id}`}
                    aria-label={`Approve ${approval.title}`}
                    onClick={() => void decide(approval, "approve")}
                  >
                    Approve
                  </button>
                  {approval.allowShape ? (
                    confirmShape === approval.id ? (
                      <>
                        <button
                          className="btn primary small"
                          type="button"
                          disabled={busy === `approval:${approval.id}`}
                          aria-label={`Confirm always allow for ${approval.title}`}
                          onClick={() => void decide(approval, "always")}
                        >
                          Confirm always
                        </button>
                        <button
                          className="btn small"
                          type="button"
                          onClick={() => setConfirmShape(undefined)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn small"
                        type="button"
                        disabled={busy === `approval:${approval.id}`}
                        aria-label={`Always allow ${approval.title}`}
                        onClick={() => setConfirmShape(approval.id)}
                      >
                        Always allow
                      </button>
                    )
                  ) : null}
                  <button
                    className="btn small"
                    type="button"
                    disabled={busy === `approval:${approval.id}`}
                    aria-label={`Deny ${approval.title}`}
                    onClick={() => void decide(approval, "deny")}
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-note">Nothing is waiting for approval.</p>
        )}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Allowed shapes</h2>
            <p>
              Patterns you approved for automatic answers. Revoke one to make
              the policy ask again.
            </p>
          </div>
          <span className="mode-badge">
            {view?.allowedShapes.length ?? 0}
          </span>
        </div>

        {view && view.allowedShapes.length > 0 ? (
          <ul className="automation-list">
            {view.allowedShapes.map((shape) => (
              <li key={shape.id}>
                <div className="settings-device-meta">
                  <span className="settings-device-name">{shape.label}</span>
                  <span className="settings-device-detail">
                    {shape.watcherID} · {shape.kind} · {shape.uses} use
                    {shape.uses === 1 ? "" : "s"} · {shape.choices.join(" / ")}
                  </span>
                </div>
                <button
                  className="btn small"
                  type="button"
                  disabled={busy === `shape:${shape.id}`}
                  aria-label={`Revoke ${shape.label}`}
                  onClick={() => void revokeShape(shape.id)}
                >
                  {busy === `shape:${shape.id}` ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-note">No shapes have been remembered yet.</p>
        )}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent runs</h2>
            <p>Newest first. Dry runs send nothing.</p>
          </div>
        </div>

        {view && view.runs.length > 0 ? (
          <ul className="automation-list">
            {view.runs.slice(0, 8).map((run) => (
              <li key={run.id}>
                <span className={`run-decision ${run.decision}`}>
                  {DECISION_LABELS[run.decision]}
                </span>
                <div className="settings-device-meta">
                  <span className="settings-device-name">
                    {run.watcherID} · {run.action ?? run.trigger}
                  </span>
                  <span className="settings-device-detail">
                    {run.detail ?? run.reason} · {formatWhen(run.at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="form-note">No automation runs yet.</p>
        )}
      </article>
    </section>
  );
}
