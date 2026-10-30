import { z } from "zod";
import { zMessage } from "./messages";

export const zHubEventType = z.enum([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.read",
  "message.created",
  "message.updated",
  "message.delta",
  "attention.created",
  "attention.updated",
  "attention.resolved",
  "provider.status",
  "error",
  "resync",
]);

export const zHubEvent = z.object({
  seq: z.number().int().nonnegative(),
  type: zHubEventType,
  sessionRef: z.string().optional(),
  attentionID: z.string().optional(),
  data: z.unknown(),
  at: z.number().int(),
});

export type HubEventType = z.infer<typeof zHubEventType>;
export type HubEvent = z.infer<typeof zHubEvent>;

export const zMessageEventData = z.object({
  message: zMessage,
});

export type MessageEventData = z.infer<typeof zMessageEventData>;
