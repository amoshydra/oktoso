import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_ROUTING,
  zNotificationChannelView,
  zNotificationRouting,
  zNotificationSettings,
  zNotificationSettingsInput,
  zPushSubscription,
  zPushSubscriptionInput,
} from "./notifications";

describe("notification contracts", () => {
  it("applies the default routing", () => {
    expect(zNotificationRouting.parse({})).toEqual(DEFAULT_NOTIFICATION_ROUTING);
  });

  it("rejects a type that is both immediate and digest", () => {
    const result = zNotificationRouting.safeParse({
      immediate: ["question"],
      digest: ["question"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown time zone", () => {
    const result = zNotificationRouting.safeParse({
      quietHours: { enabled: true, timezone: "Mars/Olympus" },
    });

    expect(result.success).toBe(false);
  });

  it("validates a subscription and drops transport secrets on read", () => {
    const input = zPushSubscriptionInput.parse({
      deviceID: "phone-1",
      label: "Pixel",
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: "public-key", auth: "auth-secret" },
    });

    expect(input.deviceID).toBe("phone-1");

    const stored = zPushSubscription.parse({
      ...input,
      id: "sub-1",
      createdAt: 1,
      lastSeenAt: 2,
    });

    expect(stored).not.toHaveProperty("endpoint");
    expect(stored).not.toHaveProperty("keys");
  });

  it("rejects a non-URL endpoint", () => {
    const result = zPushSubscriptionInput.safeParse({
      deviceID: "phone-1",
      endpoint: "not-a-url",
      keys: { p256dh: "public-key", auth: "auth-secret" },
    });

    expect(result.success).toBe(false);
  });

  it("keeps the settings input partial", () => {
    expect(zNotificationSettingsInput.parse({ enabled: true })).toEqual({
      enabled: true,
    });
  });

  it("never exposes channel credentials in the view", () => {
    const view = zNotificationChannelView.parse({
      kind: "webpush",
      enabled: true,
      configured: true,
      token: "secret",
      endpoint: "https://push.example.com/secret-capability",
    });

    expect(view).not.toHaveProperty("token");
    expect(view).not.toHaveProperty("endpoint");
  });

  it("round-trips the settings view", () => {
    const settings = zNotificationSettings.parse({
      enabled: true,
      routing: DEFAULT_NOTIFICATION_ROUTING,
      channels: [{ kind: "webpush", enabled: true, configured: true }],
      subscriptions: [
        {
          id: "sub-1",
          deviceID: "phone-1",
          createdAt: 1,
          lastSeenAt: 2,
        },
      ],
    });

    expect(zNotificationSettings.parse(settings)).toEqual(settings);
  });
});
