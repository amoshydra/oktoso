import { useEffect, useMemo, useState } from "react";
import type { HubClient } from "@amoshydra/oktoso-client";
import type { Session } from "@amoshydra/oktoso-contracts";
import { useRouteDataKey } from "./history";
import { compactNumber } from "./metrics";
import { readRouteCache, writeRouteCache } from "./route-cache";
import { useRevalidationIndicator } from "./revalidation";
import { buildUsageReport, type UsageGroup } from "./usage";

const GROUPS: Array<{ id: UsageGroup; label: string }> = [
  { id: "provider", label: "Provider" },
  { id: "project", label: "Project" },
  { id: "model", label: "Model" },
  { id: "day", label: "Day" },
];

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;

function figures(tokens: number | null, cost: number | null) {
  return {
    tokens: tokens === null ? "—" : compactNumber(tokens),
    cost: cost === null ? "—" : `$${cost.toFixed(2)}`,
  };
}

/**
 * Usage report for the Overview screen.
 *
 * Pages through the session list the client already has access to; no
 * aggregation endpoint. The head states how many sessions were counted so a
 * bounded walk never claims to be the whole history.
 */
export function OverviewUsage(props: { client: HubClient }) {
  const key = useRouteDataKey();
  const [cached] = useState<Session[] | undefined>(() =>
    readRouteCache<Session[]>(key, "overview-usage"),
  );
  const [group, setGroup] = useState<UsageGroup>("provider");
  const [sessions, setSessions] = useState<Session[]>(() => cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [checking, setChecking] = useState(Boolean(cached));
  const [settled, setSettled] = useState(Boolean(cached));
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useRevalidationIndicator(checking);

  useEffect(() => {
    let cancelled = false;
    if (cached) setChecking(true);
    else setLoading(true);
    setError(undefined);
    (async () => {
      try {
        const collected = new Map<string, Session>();
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const result = await props.client.sessions({
            limit: PAGE_LIMIT,
            ...(cursor ? { cursor } : {}),
          });
          for (const session of result.data) collected.set(session.ref, session);
          cursor = result.cursor.next ?? undefined;
          if (!cursor || result.data.length === 0) break;
        }
        if (!cancelled) {
          const next = [...collected.values()];
          setSessions(next);
          setSettled(true);
          writeRouteCache(key, "overview-usage", next);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error ? reason.message : "Unable to load usage",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setChecking(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.client, key, attempt]);

  const report = useMemo(
    () => buildUsageReport(sessions, group),
    [sessions, group],
  );

  return (
    <section className="panel overview-usage" aria-labelledby="overview-usage-title">
      <div className="panel-head">
        <div>
          <h2 id="overview-usage-title">Usage</h2>
          <p>
            Tokens and cost the providers reported for {report.sessions} session
            {report.sessions === 1 ? "" : "s"}. Unreported figures stay blank.
          </p>
        </div>
      </div>

      <div className="panel-body">
        <div className="search-filters" role="group" aria-label="Group usage by">
          <span className="search-filter-label">Group by</span>
          {GROUPS.map((entry) => (
            <button
              key={entry.id}
              className={`chip ${group === entry.id ? "active" : ""}`}
              type="button"
              aria-pressed={group === entry.id}
              onClick={() => setGroup(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="form-note" role="alert">
            {error}
            {settled ? " Showing the last report." : ""}
            <button
              className="text-button"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        ) : null}

        {loading && sessions.length === 0 ? (
          <div className="empty">Loading usage…</div>
        ) : checking && sessions.length === 0 ? (
          <div className="empty">Checking usage…</div>
        ) : !settled ? null : report.sessions === 0 ? (
          <div className="empty">No sessions yet, so there is nothing to report.</div>
        ) : report.rows.length === 0 ? (
          <div className="empty">No sessions to summarise.</div>
        ) : (
          <>
            <table className="usage-table">
              <thead>
                <tr>
                  <th scope="col">
                    {GROUPS.find((entry) => entry.id === group)?.label ?? "Group"}
                  </th>
                  <th scope="col" className="num">
                    Sessions
                  </th>
                  <th scope="col" className="num">
                    Tokens
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => {
                  const value = figures(row.tokens, row.cost);
                  return (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className="num">{row.sessions}</td>
                      <td className="num">{value.tokens}</td>
                      <td className="num">{value.cost}</td>
                    </tr>
                  );
                })}
                <tr className="usage-total">
                  <td>Reported total</td>
                  <td className="num">{report.sessions}</td>
                  <td className="num">{figures(report.tokens, null).tokens}</td>
                  <td className="num">{figures(null, report.cost).cost}</td>
                </tr>
              </tbody>
            </table>

            <ul className="usage-stacked">
              {report.rows.map((row) => {
                const value = figures(row.tokens, row.cost);
                return (
                  <li key={row.key}>
                    <span className="usage-stacked-head">
                      <span>{row.label}</span>
                      <span>{row.sessions}</span>
                    </span>
                    <span className="usage-stacked-figures">
                      {value.tokens} tokens · {value.cost}
                    </span>
                  </li>
                );
              })}
              <li className="usage-total">
                <span className="usage-stacked-head">
                  <span>Reported total</span>
                  <span>{report.sessions}</span>
                </span>
                <span className="usage-stacked-figures">
                  {figures(report.tokens, null).tokens} tokens ·{" "}
                  {figures(null, report.cost).cost}
                </span>
              </li>
            </ul>

            <p className="form-note">
              {report.missingCost > 0
                ? `${report.missingCost} of ${report.sessions} sessions did not report cost. `
                : ""}
              {report.missingTokens > 0
                ? `${report.missingTokens} did not report tokens. `
                : ""}
              {group === "day" ? "Days follow each session's last update. " : ""}
              Sessions are read from providers, not stored here.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
