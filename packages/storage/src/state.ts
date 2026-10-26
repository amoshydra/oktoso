import { z } from "zod";
import { DEFAULT_ASSISTANT_CONFIG, zAssistantConfig } from "@agent-hub/contracts";

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
  expiresAt: z.number().int().nonnegative(),
});

export const zHubState = z.object({
  schemaVersion: z.literal(1),
  lastSeq: z.number().int().nonnegative(),
  readMarkers: z.record(z.string(), zReadMarker),
  attention: z.record(z.string(), zAttentionState),
  drafts: z.record(z.string(), zDraftState),
  idempotency: z.record(z.string(), zIdempotencyState),
  settings: zAssistantConfig.default(DEFAULT_ASSISTANT_CONFIG),
});

export type HubState = z.infer<typeof zHubState>;
export type ReadMarker = z.infer<typeof zReadMarker>;

export function createInitialState(): HubState {
  return {
    schemaVersion: 1,
    lastSeq: 0,
    readMarkers: {},
    attention: {},
    drafts: {},
    idempotency: {},
    settings: structuredClone(DEFAULT_ASSISTANT_CONFIG),
  };
}

export interface StateStore {
  readonly kind: "memory" | "json";
  getState(): HubState;
  update(mutator: (state: HubState) => void | Promise<void>): Promise<HubState>;
  close(): Promise<void>;
}
