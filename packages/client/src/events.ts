import type { HubEvent, Message } from "@amoshydra/oktoso-contracts";

/** Returns the normalized message carried by a message event, if present. */
export function messageFromHubEvent(event: HubEvent): Message | undefined {
  if (
    event.type !== "message.created" &&
    event.type !== "message.updated" &&
    event.type !== "message.delta"
  ) {
    return undefined;
  }
  const data = event.data as { message?: Message } | undefined;
  return data?.message;
}
