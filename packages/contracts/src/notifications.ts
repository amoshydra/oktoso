import { z } from "zod";
import { zAttentionType } from "./attention";

/**
 * Notification contracts.
 *
 * The hub owns delivery. Clients only register push subscriptions and read the
 * resolved settings view. Channel credentials never cross the API boundary.
 */

/**
 * Web Push is the only delivery channel. It needs no channel entry in config:
 * a browser subscription is the whole registration.
 */
export const zNotificationChannelKind = z.literal("webpush");

export const zClockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour HH:MM time");

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const zQuietHours = z.object({
  enabled: z.boolean().default(false),
  start: zClockTime.default("22:00"),
  end: zClockTime.default("07:00"),
  /** IANA zone, for example `Asia/Kuala_Lumpur`. */
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimeZone, "Unknown time zone")
    .default("UTC"),
});

export const zNotificationRouting = z
  .object({
    /** Types that wake the device immediately. */
    immediate: z
      .array(zAttentionType)
      .default(["permission", "approval"]),
    /** Types that wait for the digest window. */
    digest: z.array(zAttentionType).default(["question", "unread", "error"]),
    digestWindowMs: z
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(900_000),
    quietHours: zQuietHours.default({
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    }),
  })
  .superRefine((value, ctx) => {
    const overlap = [...new Set(value.immediate)].filter((type) =>
      value.digest.includes(type),
    );
    if (overlap.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `A type cannot be both immediate and digest: ${overlap.join(", ")}`,
        path: ["immediate"],
      });
    }
  });

/** Partial update shape for the settings screen. */
export const zQuietHoursInput = z.object({
  enabled: z.boolean().optional(),
  start: zClockTime.optional(),
  end: zClockTime.optional(),
  timezone: z.string().min(1).refine(isValidTimeZone, "Unknown time zone").optional(),
});

export const zNotificationRoutingInput = z.object({
  immediate: z.array(zAttentionType).optional(),
  digest: z.array(zAttentionType).optional(),
  digestWindowMs: z.number().int().min(60_000).max(86_400_000).optional(),
  quietHours: zQuietHoursInput.optional(),
});

export const zNotificationSettingsInput = z.object({
  enabled: z.boolean().optional(),
  routing: zNotificationRoutingInput.optional(),
});

/** Public channel status. Never includes tokens or destinations. */
export const zNotificationChannelView = z.object({
  kind: zNotificationChannelKind,
  enabled: z.boolean(),
  configured: z.boolean(),
  label: z.string().optional(),
});

/** A browser or PWA push subscription, as submitted by the client. */
export const zPushSubscriptionInput = z.object({
  deviceID: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9._:-]+$/,
      "Device IDs may contain letters, numbers, dot, underscore, colon, or dash",
    ),
  label: z.string().trim().min(1).max(80).optional(),
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
});

/**
 * A stored subscription, as read back. The endpoint and keys are deliberately
 * omitted: the endpoint is a capability URL and the keys are only needed by the
 * hub when it sends.
 */
export const zPushSubscription = z.object({
  id: z.string(),
  deviceID: z.string(),
  label: z.string().optional(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
  expirationTime: z.number().int().nullable().optional(),
});

export const zPushSubscriptionPage = z.object({
  data: z.array(zPushSubscription),
});

export const zNotificationDeliveryStatus = z.enum([
  "queued",
  "sent",
  "failed",
  "skipped",
]);

export const zNotificationDelivery = z.object({
  id: z.string(),
  channel: zNotificationChannelKind,
  attentionID: z.string(),
  sessionRef: z.string(),
  status: zNotificationDeliveryStatus,
  attempts: z.number().int().min(0),
  createdAt: z.number().int(),
  sentAt: z.number().int().optional(),
  /** Redacted failure text. Never a transcript or a credential. */
  error: z.string().optional(),
});

export const zNotificationDeliveryPage = z.object({
  data: z.array(zNotificationDelivery),
});

export const zNotificationTestResult = z.object({
  attempted: z.number().int().min(0),
  delivered: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const zNotificationSettings = z.object({
  enabled: z.boolean(),
  channels: z.array(zNotificationChannelView),
  routing: zNotificationRouting,
  subscriptions: z.array(zPushSubscription),
  /** VAPID public key for `pushManager.subscribe`. Not a secret. */
  applicationServerKey: z.string().optional(),
});

export const DEFAULT_NOTIFICATION_ROUTING = {
  immediate: ["permission", "approval"],
  digest: ["question", "unread", "error"],
  digestWindowMs: 900_000,
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "UTC",
  },
} satisfies z.infer<typeof zNotificationRouting>;

export type NotificationChannelKind = z.infer<typeof zNotificationChannelKind>;
export type QuietHours = z.infer<typeof zQuietHours>;
export type NotificationRouting = z.infer<typeof zNotificationRouting>;
export type NotificationSettings = z.infer<typeof zNotificationSettings>;
export type NotificationSettingsInput = z.infer<
  typeof zNotificationSettingsInput
>;
export type NotificationChannelView = z.infer<typeof zNotificationChannelView>;
export type PushSubscriptionInput = z.infer<typeof zPushSubscriptionInput>;
export type PushSubscription = z.infer<typeof zPushSubscription>;
export type PushSubscriptionPage = z.infer<typeof zPushSubscriptionPage>;
export type NotificationDelivery = z.infer<typeof zNotificationDelivery>;
export type NotificationDeliveryStatus = z.infer<
  typeof zNotificationDeliveryStatus
>;
export type NotificationDeliveryPage = z.infer<
  typeof zNotificationDeliveryPage
>;
export type NotificationTestResult = z.infer<typeof zNotificationTestResult>;
