import { useEffect, useState } from "react";
import type {
  LocalDataView,
  TranscriptCacheSettings,
  TranscriptCacheView,
} from "@amoshydra/oktoso-contracts";
import type { HubClient } from "@amoshydra/oktoso-client";

const RETENTION_OPTIONS = [
  { value: 0, label: "Never" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Every store the hub keeps on its own disk.
 *
 * The transcript cache keeps its enable toggle, retention window, and session
 * cap: those are C1's controls, not something this panel may drop. Retention is
 * per store because a draft is unsent work while the cache is derived data.
 */
export function LocalDataSettingsPanel(props: { client: HubClient }) {
  const [local, setLocal] = useState<LocalDataView>();
  const [cache, setCache] = useState<TranscriptCacheView>();
  const [cacheDraft, setCacheDraft] = useState<TranscriptCacheSettings>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirming, setConfirming] = useState(false);

  const applyCache = (next: TranscriptCacheView) => {
    setCache(next);
    setCacheDraft(next.settings);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([props.client.localData(), props.client.transcriptCache()])
      .then(([nextLocal, nextCache]) => {
        if (cancelled) return;
        setLocal(nextLocal);
        applyCache(nextCache);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(
          reason instanceof Error ? reason.message : "Unable to load local data",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Local data action failed");
    } finally {
      setBusy(undefined);
    }
  };

  const saveRetention = (patch: {
    draftsDays?: number;
    markersDays?: number;
    feedbackDays?: number;
  }) =>
    run("retention", async () => {
      setLocal(await props.client.saveLocalRetention(patch));
      setNotice("Retention saved.");
    });

  const clearStore = (store: "drafts" | "markers" | "feedback") =>
    run(store, async () => {
      setLocal(await props.client.clearLocalStore(store));
      setNotice("Cleared.");
    });

  const saveCache = () =>
    run("cache-save", async () => {
      if (!cacheDraft) return;
      applyCache(
        await props.client.saveTranscriptCache({
          enabled: cacheDraft.enabled,
          ttlDays: cacheDraft.ttlDays,
          maxSessions: cacheDraft.maxSessions,
        }),
      );
      setNotice("Transcript cache saved.");
    });

  const clearCache = () =>
    run("cache-clear", async () => {
      applyCache(await props.client.clearTranscriptCache());
      setNotice("Stored transcripts deleted.");
    });

  const clearAll = () =>
    run("all", async () => {
      setLocal(await props.client.clearAllLocalData());
      applyCache(await props.client.transcriptCache());
      setConfirming(false);
      setNotice("All local data cleared. Providers were not touched.");
    });

  return (
    <section className="settings-local">
      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Local data</h2>
            <p>
              What this hub keeps on its own disk. Providers own the
              conversations; clearing here never deletes them.
            </p>
          </div>
          <span className="mode-badge">hub disk</span>
        </div>

        {loading ? <div className="form-note">Loading local data…</div> : null}

        <div className="local-block">
          <div className="local-row">
            <div>
              <div className="local-name">Transcript cache</div>
              <div className="local-meta">
                {cache
                  ? `${plural(cache.stats.sessions, "session")} · ${formatBytes(cache.stats.bytes)}`
                  : "—"}
              </div>
            </div>
            <button
              className="btn small"
              type="button"
              disabled={busy === "cache-clear" || (cache?.stats.sessions ?? 0) === 0}
              onClick={() => void clearCache()}
            >
              {busy === "cache-clear" ? "Clearing…" : "Clear"}
            </button>
          </div>
          <div className="form-grid">
            <label className="check-field span-2">
              <input
                type="checkbox"
                checked={cacheDraft?.enabled ?? false}
                onChange={(event) => {
                  const enabled = (event.currentTarget as HTMLInputElement).checked;
                  setCacheDraft((current) =>
                    current ? { ...current, enabled } : current,
                  );
                }}
              />
              <span>Cache transcripts on the hub</span>
            </label>
            <label className="form-field">
              <span>Keep transcripts for (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={cacheDraft?.ttlDays ?? 7}
                onChange={(event) => {
                  const ttlDays = Number((event.currentTarget as HTMLInputElement).value);
                  setCacheDraft((current) =>
                    current ? { ...current, ttlDays } : current,
                  );
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
                value={cacheDraft?.maxSessions ?? 500}
                onChange={(event) => {
                  const maxSessions = Number(
                    (event.currentTarget as HTMLInputElement).value,
                  );
                  setCacheDraft((current) =>
                    current ? { ...current, maxSessions } : current,
                  );
                }}
              />
            </label>
          </div>
          <div className="form-actions">
            <button
              className="btn small"
              type="button"
              disabled={busy === "cache-save"}
              onClick={() => void saveCache()}
            >
              {busy === "cache-save" ? "Saving…" : "Save cache settings"}
            </button>
          </div>
          <p className="form-note">
            The cache is opt-in and stores message text only. Turning it off or
            clearing it also deletes the search index.
          </p>
        </div>

        <div className="local-block">
          <div className="local-row">
            <div>
              <div className="local-name">Reply feedback</div>
              <div className="local-meta">
                {local ? `${local.feedback} entries · ${formatBytes(local.feedbackBytes)}` : "—"}
              </div>
            </div>
            <div className="local-actions">
              <select
                className="local-select"
                aria-label="Keep reply feedback"
                value={local?.retention.feedbackDays ?? 30}
                onChange={(event) =>
                  void saveRetention({ feedbackDays: Number(event.currentTarget.value) })
                }
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className="btn small"
                type="button"
                disabled={busy === "feedback" || (local?.feedback ?? 0) === 0}
                onClick={() => void clearStore("feedback")}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <div className="local-block">
          <div className="local-row">
            <div>
              <div className="local-name">Drafts</div>
              <div className="local-meta">
                {local ? `${local.drafts} saved` : "—"}
              </div>
            </div>
            <div className="local-actions">
              <select
                className="local-select"
                aria-label="Keep drafts"
                value={local?.retention.draftsDays ?? 0}
                onChange={(event) =>
                  void saveRetention({ draftsDays: Number(event.currentTarget.value) })
                }
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className="btn small"
                type="button"
                disabled={busy === "drafts" || (local?.drafts ?? 0) === 0}
                onClick={() => void clearStore("drafts")}
              >
                Clear
              </button>
            </div>
          </div>
          <p className="form-note">
            Drafts default to <strong>Never</strong>: an unsent message is your
            work, not derived data.
          </p>
        </div>

        <div className="local-block">
          <div className="local-row">
            <div>
              <div className="local-name">Read markers</div>
              <div className="local-meta">
                {local ? `${local.markers} sessions` : "—"}
              </div>
            </div>
            <div className="local-actions">
              <select
                className="local-select"
                aria-label="Keep read markers"
                value={local?.retention.markersDays ?? 30}
                onChange={(event) =>
                  void saveRetention({ markersDays: Number(event.currentTarget.value) })
                }
              >
                {RETENTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                className="btn small"
                type="button"
                disabled={busy === "markers" || (local?.markers ?? 0) === 0}
                onClick={() => void clearStore("markers")}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        <p className="form-note">
          Retention applies per store: the cache is derived data, read markers
          and feedback are convenience, drafts are yours. Nothing here sends
          anything to a provider.
        </p>

        <div className="form-actions">
          {confirming ? (
            <>
              <button
                className="btn small danger"
                type="button"
                disabled={busy === "all"}
                onClick={() => void clearAll()}
              >
                {busy === "all" ? "Clearing…" : "Confirm clear all local data"}
              </button>
              <button
                className="btn small"
                type="button"
                disabled={busy === "all"}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn small"
              type="button"
              onClick={() => setConfirming(true)}
            >
              Clear all local data
            </button>
          )}
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
      </article>
    </section>
  );
}
