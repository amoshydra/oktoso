import { useEffect, useState } from "react";
import type {
  TranscriptCacheSettings,
  TranscriptCacheView,
} from "@amoshydra/oktoso-contracts";
import type { HubClient } from "@amoshydra/oktoso-client";

const DEFAULT_SETTINGS: TranscriptCacheSettings = {
  enabled: false,
  ttlDays: 7,
  maxSessions: 200,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDay(at: number | null): string {
  if (at === null) return "—";
  return new Date(at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function TranscriptCacheSettingsPanel(props: { client: HubClient }) {
  const [view, setView] = useState<TranscriptCacheView>();
  const [settings, setSettings] = useState<TranscriptCacheSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const apply = (next: TranscriptCacheView) => {
    setView(next);
    setSettings(next.settings);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    props.client
      .transcriptCache()
      .then((next) => {
        if (!cancelled) apply(next);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load the transcript cache",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      apply(
        await props.client.saveTranscriptCache({
          enabled: settings.enabled,
          ttlDays: settings.ttlDays,
          maxSessions: settings.maxSessions,
        }),
      );
      setNotice(
        settings.enabled
          ? "Transcript cache saved."
          : "Transcript cache off. Stored transcripts were deleted.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save the transcript cache settings",
      );
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setClearing(true);
    setError(undefined);
    setNotice(undefined);
    try {
      apply(await props.client.clearTranscriptCache());
      setNotice("Stored transcripts deleted.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to clear the cache",
      );
    } finally {
      setClearing(false);
    }
  };

  const stats = view?.stats;

  return (
    <section className="settings-transcripts">
      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Transcript cache</h2>
            <p>
              Keep the message text the hub already read on disk, so search and
              export do not need another provider round trip.
            </p>
          </div>
          <span className="mode-badge">{settings.enabled ? "on" : "off"}</span>
        </div>

        {loading ? <div className="form-note">Loading cache settings…</div> : null}

        <div className="form-grid">
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => {
                const enabled = (event.currentTarget as HTMLInputElement).checked;
                setSettings((current) => ({ ...current, enabled }));
              }}
            />
            <span>Cache transcripts on the hub</span>
          </label>
          <label className="form-field">
            <span>Keep for (days)</span>
            <input
              type="number"
              min={1}
              max={90}
              value={settings.ttlDays}
              onChange={(event) => {
                const ttlDays = Number((event.currentTarget as HTMLInputElement).value);
                setSettings((current) => ({ ...current, ttlDays }));
              }}
            />
          </label>
          <label className="form-field">
            <span>Maximum sessions</span>
            <input
              type="number"
              min={10}
              max={2000}
              step={10}
              value={settings.maxSessions}
              onChange={(event) => {
                const maxSessions = Number(
                  (event.currentTarget as HTMLInputElement).value,
                );
                setSettings((current) => ({ ...current, maxSessions }));
              }}
            />
          </label>
        </div>

        <p className="form-note">
          Providers stay authoritative: opening a session always reads from the
          provider, and a new session revision replaces the stored copy. The
          cache is off by default, stored owner-only under the hub data
          directory, and deleted when you turn it off or clear it.
        </p>

        <div className="form-actions">
          <button
            className="btn primary small"
            type="button"
            disabled={saving || loading}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save cache settings"}
          </button>
          <button
            className="btn small"
            type="button"
            disabled={clearing || (stats?.sessions ?? 0) === 0}
            onClick={() => void clear()}
          >
            {clearing ? "Clearing…" : "Clear cache"}
          </button>
        </div>

        {notice ? (
          <p className="form-note" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-note" role="alert">
            {error}
          </p>
        ) : null}

        <div className="transcript-stats mono">
          <span>{stats ? `${stats.sessions} sessions` : "—"}</span>
          <span aria-hidden="true">·</span>
          <span>{stats ? formatBytes(stats.bytes) : "—"}</span>
          <span aria-hidden="true">·</span>
          <span>{stats ? `${stats.completeSessions} complete` : "—"}</span>
          <span aria-hidden="true">·</span>
          <span>stored {formatDay(stats?.newestStoredAt ?? null)}</span>
        </div>
      </article>
    </section>
  );
}
