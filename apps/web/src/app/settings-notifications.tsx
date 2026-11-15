import { useEffect, useState } from "react";
import type {
  AttentionType,
  NotificationSettings,
} from "@amoshydra/oktoso-contracts";
import type { HubClient } from "@amoshydra/oktoso-client";
import {
  deviceID,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "../pwa";

type RoutingChoice = "immediate" | "digest" | "off";

const ROUTING_TYPES: Array<[AttentionType, string]> = [
  ["permission", "Permission"],
  ["approval", "Approval"],
  ["question", "Question"],
  ["unread", "Unread"],
  ["error", "Error"],
];

const DEFAULT_ROUTING: Record<AttentionType, RoutingChoice> = {
  permission: "immediate",
  approval: "immediate",
  question: "digest",
  unread: "digest",
  error: "digest",
};

function routingFrom(settings: NotificationSettings): Record<AttentionType, RoutingChoice> {
  return Object.fromEntries(
    ROUTING_TYPES.map(([type]) => [
      type,
      settings.routing.immediate.includes(type)
        ? "immediate"
        : settings.routing.digest.includes(type)
          ? "digest"
          : "off",
    ]),
  ) as Record<AttentionType, RoutingChoice>;
}

function permissionLabel(permission: ReturnType<typeof notificationPermission>): string {
  if (permission === "granted") return "allowed";
  if (permission === "denied") return "blocked";
  if (permission === "unsupported") return "unsupported";
  return "not asked";
}

function formatWhen(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(at));
}

export function NotificationSettingsPanel(props: { client: HubClient }) {
  const [settings, setSettings] = useState<NotificationSettings>();
  const [enabled, setEnabled] = useState(false);
  const [routing, setRouting] =
    useState<Record<AttentionType, RoutingChoice>>(DEFAULT_ROUTING);
  const [quiet, setQuiet] = useState({
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "UTC",
  });
  const [digestMinutes, setDigestMinutes] = useState(15);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [permission, setPermission] = useState(notificationPermission());
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const supported = pushSupported();
  const thisDevice = deviceID();
  const subscribed =
    settings?.subscriptions.some((item) => item.deviceID === thisDevice) ?? false;

  const apply = (next: NotificationSettings) => {
    setSettings(next);
    setEnabled(next.enabled);
    setRouting(routingFrom(next));
    setQuiet(next.routing.quietHours);
    setDigestMinutes(Math.max(1, Math.round(next.routing.digestWindowMs / 60_000)));
  };

  const load = async (spinner = true) => {
    if (spinner) setLoading(true);
    setError(undefined);
    try {
      apply(await props.client.notificationSettings());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load notifications",
      );
    } finally {
      if (spinner) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [props.client]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notification action failed");
    } finally {
      setBusy(undefined);
      setPermission(notificationPermission());
    }
  };

  const enable = () =>
    run("enable", async () => {
      const stored = await enablePush(props.client);
      await load(false);
      setNotice(
        stored
          ? "Notifications enabled on this device."
          : "Notification permission was not granted.",
      );
    });

  const disable = () =>
    run("disable", async () => {
      await disablePush(props.client);
      await load(false);
      setNotice("Notifications disabled on this device.");
    });

  const sendTest = () =>
    run("test", async () => {
      const result = await props.client.testNotification();
      setNotice(
        result.attempted === 0
          ? "No channel is configured yet."
          : `Test sent to ${result.delivered} of ${result.attempted} channel${result.attempted === 1 ? "" : "s"}.`,
      );
    });

  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const immediate = ROUTING_TYPES.map(([type]) => type).filter(
        (type) => routing[type] === "immediate",
      );
      const digest = ROUTING_TYPES.map(([type]) => type).filter(
        (type) => routing[type] === "digest",
      );
      const next = await props.client.saveNotificationSettings({
        enabled,
        routing: {
          immediate,
          digest,
          digestWindowMs: Math.max(1, Math.round(digestMinutes)) * 60_000,
          quietHours: quiet,
        },
      });
      apply(next);
      setNotice("Notification settings saved.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to save notification settings",
      );
    } finally {
      setSaving(false);
    }
  };

  const revoke = (id: string, local: boolean) =>
    run(id, async () => {
      if (local) {
        await disablePush(props.client);
      } else {
        await props.client.removePushSubscription(id);
      }
      await load(false);
      setNotice(local ? "Notifications disabled on this device." : "Device revoked.");
    });

  return (
    <section className="settings-notifications">
      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Notifications</h2>
            <p>
              Wake this device when a session needs you. Blocking items ignore
              quiet hours.
            </p>
          </div>
          <span className="mode-badge">{permissionLabel(permission)}</span>
        </div>

        {supported ? (
          <div className="form-actions">
            <button
              className="btn primary small"
              type="button"
              disabled={busy === "enable" || permission === "denied"}
              onClick={() => void enable()}
            >
              {busy === "enable"
                ? "Enabling…"
                : subscribed
                  ? "Re-enable on this device"
                  : "Enable on this device"}
            </button>
            <button
              className="btn small"
              type="button"
              disabled={busy === "test"}
              onClick={() => void sendTest()}
            >
              {busy === "test" ? "Sending…" : "Send test"}
            </button>
            {subscribed ? (
              <button
                className="btn small"
                type="button"
                disabled={busy === "disable"}
                onClick={() => void disable()}
              >
                {busy === "disable" ? "Disabling…" : "Disable on this device"}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="form-note">
            This browser does not support Web Push. Web Push needs a secure
            context: open the hub over HTTPS or from localhost.
          </p>
        )}

        <p className="form-note">
          Permission: {permission}.{" "}
          {settings?.applicationServerKey
            ? "The hub key is ready."
            : "The hub has no Web Push key."}{" "}
          Web Push requires HTTPS or localhost.
        </p>
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
            <h2>Routing</h2>
            <p>Immediate wakes the device; digest waits for the window.</p>
          </div>
          <span className="mode-badge">{enabled ? "on" : "off"}</span>
        </div>

        {loading && !settings ? (
          <p className="form-note">Loading notification settings…</p>
        ) : (
          <>
            <div className="form-grid">
              <label className="check-field span-2">
                <input
                  id="notify-enabled"
                  name="notify-enabled"
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.currentTarget.checked)}
                />
                <span>Send notifications</span>
              </label>

              {ROUTING_TYPES.map(([type, label]) => (
                <label className="form-field" key={type}>
                  <span>{label}</span>
                  <select
                    id={`notify-routing-${type}`}
                    name={`notify-routing-${type}`}
                    value={routing[type]}
                    onChange={(event) => {
                      const choice = event.currentTarget.value as RoutingChoice;
                      setRouting((current) => ({
                        ...current,
                        [type]: choice,
                      }));
                    }}
                  >
                    <option value="immediate">Immediate</option>
                    <option value="digest">Digest</option>
                    <option value="off">Off</option>
                  </select>
                </label>
              ))}

              <label className="form-field">
                <span>Digest window (minutes)</span>
                <input
                  id="notify-digest"
                  name="notify-digest"
                  type="number"
                  min={1}
                  max={1440}
                  value={digestMinutes}
                  onChange={(event) =>
                    setDigestMinutes(Number(event.currentTarget.value))
                  }
                />
              </label>

              <label className="check-field span-2">
                <input
                  id="notify-quiet"
                  name="notify-quiet"
                  type="checkbox"
                  checked={quiet.enabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setQuiet((current) => ({
                      ...current,
                      enabled: checked,
                    }));
                  }}
                />
                <span>Quiet hours</span>
              </label>
              <label className="form-field">
                <span>Start</span>
                <input
                  id="notify-quiet-start"
                  name="notify-quiet-start"
                  type="time"
                  value={quiet.start}
                  onChange={(event) => {
                    const start = event.currentTarget.value;
                    setQuiet((current) => ({ ...current, start }));
                  }}
                />
              </label>
              <label className="form-field">
                <span>End</span>
                <input
                  id="notify-quiet-end"
                  name="notify-quiet-end"
                  type="time"
                  value={quiet.end}
                  onChange={(event) => {
                    const end = event.currentTarget.value;
                    setQuiet((current) => ({ ...current, end }));
                  }}
                />
              </label>
              <label className="form-field span-2">
                <span>Time zone</span>
                <input
                  id="notify-quiet-timezone"
                  name="notify-quiet-timezone"
                  value={quiet.timezone}
                  placeholder="Asia/Kuala_Lumpur"
                  onChange={(event) => {
                    const timezone = event.currentTarget.value;
                    setQuiet((current) => ({ ...current, timezone }));
                  }}
                />
              </label>
            </div>

            <div className="form-actions">
              <button
                className="btn primary small"
                type="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save routing"}
              </button>
            </div>
          </>
        )}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Devices</h2>
            <p>
              Browsers that can receive a notification. Revoke one without
              rotating the hub token.
            </p>
          </div>
          <span className="mode-badge">{settings?.subscriptions.length ?? 0}</span>
        </div>

        {settings && settings.subscriptions.length > 0 ? (
          <ul className="settings-device-list">
            {settings.subscriptions.map((item) => {
              const local = item.deviceID === thisDevice;
              return (
                <li key={item.id}>
                  <div className="settings-device-meta">
                    <span className="settings-device-name">
                      {item.label ?? "Browser"}
                      {local ? " · this device" : ""}
                    </span>
                    <span className="settings-device-detail">
                      {item.deviceID} · last seen {formatWhen(item.lastSeenAt)}
                    </span>
                  </div>
                  <button
                    className="btn small"
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => void revoke(item.id, local)}
                  >
                    {busy === item.id ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="form-note">No devices have enabled notifications yet.</p>
        )}
      </article>
    </section>
  );
}
