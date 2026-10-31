import { z } from "zod";
import { zProviderID, zProviderStatus } from "./common";

export const zHealth = z.object({
  ok: z.boolean(),
  version: z.string(),
  pid: z.number().int().positive(),
  uptimeMs: z.number().int().nonnegative(),
  startedAt: z.number().int(),
  eventSeq: z.number().int().nonnegative(),
});

export const zAuthKind = z.enum(["owner", "session"]);

export const zAuthCheck = z.object({
  ok: z.boolean(),
  version: z.string(),
  auth: z
    .object({
      kind: zAuthKind,
      expiresAt: z
        .number()
        .int()
        .describe("Unix epoch milliseconds for a paired session")
        .optional(),
    })
    .optional(),
});

export const zPairingCode = z.object({
  code: z.string().min(1),
  expiresIn: z
    .number()
    .int()
    .nonnegative()
    .describe("Seconds until the pairing code expires"),
  expiresAt: z
    .number()
    .int()
    .describe("Unix epoch milliseconds when the pairing code expires"),
});

export const zPairingSession = z.object({
  token: z.string().min(1),
  expiresAt: z
    .number()
    .int()
    .describe("Unix epoch milliseconds when the session token expires"),
});

export const zPairingExchange = z.object({
  code: z.string().min(1).describe("Single-use pairing code"),
});

export const zSessionRefresh = z.object({
  token: z.string().min(1),
  expiresAt: z
    .number()
    .int()
    .describe("Unix epoch milliseconds when the refreshed session expires"),
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
export type AuthKind = z.infer<typeof zAuthKind>;
export type AuthCheck = z.infer<typeof zAuthCheck>;
export type PairingCode = z.infer<typeof zPairingCode>;
export type PairingSession = z.infer<typeof zPairingSession>;
export type PairingExchange = z.infer<typeof zPairingExchange>;
export type SessionRefresh = z.infer<typeof zSessionRefresh>;
export type Diagnostics = z.infer<typeof zDiagnostics>;
