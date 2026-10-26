import { z } from "zod";
import { zProviderID, zProviderStatus } from "./common";

export const zHealth = z.object({
  ok: z.boolean(),
  version: z.string(),
  uptimeMs: z.number().int().nonnegative(),
  startedAt: z.number().int(),
  eventSeq: z.number().int().nonnegative(),
});

export const zAuthCheck = z.object({
  ok: z.boolean(),
  version: z.string(),
});

export const zProviderDiagnostics = z.object({
  id: zProviderID,
  type: z.string(),
  status: zProviderStatus,
  lastCheckedAt: z.number().int().optional(),
  lastSyncAt: z.number().int().optional(),
  lastError: z.string().optional(),
  nextRetryAt: z.number().int().optional(),
});

export const zDiagnostics = z.object({
  version: z.string(),
  node: z.string(),
  uptimeMs: z.number().int().nonnegative(),
  startedAt: z.number().int(),
  providers: z.array(zProviderDiagnostics),
  events: z.object({
    lastSeq: z.number().int().nonnegative(),
    bufferSize: z.number().int().nonnegative(),
    subscribers: z.number().int().nonnegative(),
  }),
  storage: z.object({
    kind: z.string(),
  }),
});

export type Health = z.infer<typeof zHealth>;
export type AuthCheck = z.infer<typeof zAuthCheck>;
export type Diagnostics = z.infer<typeof zDiagnostics>;
