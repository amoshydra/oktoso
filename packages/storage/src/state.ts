import { z } from "zod";
import {
  DEFAULT_ASSISTANT_CONFIG,
  zAssistantConfig,
  zAutomationApproval,
  zAutomationRun,
  zSendAnswer,
  zNotificationDelivery,
  zNotificationRouting,
} from "@amoshydra/oktoso-contracts";

export const zReadMarker = z.object({
  readAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const zAttentionState = z.object({
  acknowledgedAt: z.number().int().nonnegative().optional(),
  snoozedUntil: z.number().int().nonnegative().optional(),
});

export const zDraftState = z.object({
  text: z.string(),
  updatedAt: z.number().int().nonnegative(),
});

export const zIdempotencyState = z.object({
  response: z.unknown(),
  /** SHA-256 of the request payload; guards against a reused key. */
  requestHash: z.string().optional(),
  expiresAt: z.number().int().nonnegative(),
});

export const zNotificationSubscriptionState = z.object({
  id: z.string(),
  deviceID: z.string(),
  label: z.string().optional(),
  /** Push capability URL. Never returned by the API. */
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
});

export const zNotificationOverrideState = z.object({
  enabled: z.boolean().optional(),
  routing: zNotificationRouting.optional(),
});

/**
 * Approvals keep the executable plan in hub state only. The public contract
 * exposes a typed `actionable`/`proposed` summary instead of this blob.
 */
export const zAutomationApprovalState = zAutomationApproval
  .omit({ actionable: true, proposed: true })
  .extend({
    plan: z
      .object({
        text: z.string().min(1),
        label: z.string().optional(),
        answers: z.array(zSendAnswer).min(1),
      })
      .optional(),
  });

export const zHubState = z.object({
  schemaVersion: z.literal(1),
  lastSeq: z.number().int().nonnegative(),
  readMarkers: z.record(z.string(), zReadMarker),
  attention: z.record(z.string(), zAttentionState),
  drafts: z.record(z.string(), zDraftState),
  idempotency: z.record(z.string(), zIdempotencyState),
  settings: zAssistantConfig.default(DEFAULT_ASSISTANT_CONFIG),
  notificationSubscriptions: z
    .record(z.string(), zNotificationSubscriptionState)
    .default({}),
  notificationDeliveries: z.array(zNotificationDelivery).default([]),
  notificationOverrides: zNotificationOverrideState.default({}),
  automationRuns: z.array(zAutomationRun).default([]),
  automationApprovals: z.array(zAutomationApprovalState).default([]),
  automationLeases: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  automationPaused: z.boolean().default(false),
  automationDryRun: z.boolean().optional(),
  automationWatcherPause: z.record(z.string(), z.boolean()).default({}),
});

export type HubState = z.infer<typeof zHubState>;
export type ReadMarker = z.infer<typeof zReadMarker>;
export type NotificationSubscriptionState = z.infer<
  typeof zNotificationSubscriptionState
>;
export type AutomationApprovalState = z.infer<
  typeof zAutomationApprovalState
>;

export function createInitialState(): HubState {
  return {
    schemaVersion: 1,
    lastSeq: 0,
    readMarkers: {},
    attention: {},
    drafts: {},
    idempotency: {},
    settings: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    notificationSubscriptions: {},
    notificationDeliveries: [],
    notificationOverrides: {},
    automationRuns: [],
    automationApprovals: [],
    automationLeases: {},
    automationPaused: false,
    automationWatcherPause: {},
  };
}

export interface StateStore {
  readonly kind: "memory" | "json";
  getState(): HubState;
  update(mutator: (state: HubState) => void | Promise<void>): Promise<HubState>;
  close(): Promise<void>;
}
