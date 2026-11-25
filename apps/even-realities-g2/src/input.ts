import { OsEventTypeList } from "@evenrealities/even_hub_sdk";

export type GlassInput =
  | { type: "back" }
  | { type: "scroll"; direction: -1 | 1 }
  | { type: "list-scroll"; direction: -1 | 1; index?: number }
  | { type: "list-click"; index: number }
  | { type: "text-click" };

/**
 * Translate an Even Hub event into the small input grammar the app handles.
 *
 * Protobuf omits zero values, so `CLICK_EVENT` often arrives as an event with
 * no `eventType` at all. A sys event with a source and no type is therefore a
 * tap on the active text container, not a foreground transition.
 */
export function glassInput(event: any): GlassInput | undefined {
  const eventType =
    event?.sysEvent?.eventType ??
    event?.textEvent?.eventType ??
    event?.listEvent?.eventType;

  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    return { type: "back" };
  }

  if (event?.listEvent) {
    const type = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
    const index = event.listEvent.currentSelectItemIndex;
    if (type === OsEventTypeList.CLICK_EVENT) {
      return {
        type: "list-click",
        index: typeof index === "number" ? index : 0,
      };
    }
    if (type === OsEventTypeList.SCROLL_TOP_EVENT) {
      return {
        type: "list-scroll",
        direction: -1,
        ...(typeof index === "number" ? { index } : {}),
      };
    }
    if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      return {
        type: "list-scroll",
        direction: 1,
        ...(typeof index === "number" ? { index } : {}),
      };
    }
    return undefined;
  }

  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
    return { type: "scroll", direction: -1 };
  }
  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    return { type: "scroll", direction: 1 };
  }

  if (event?.sysEvent) {
    if (
      event.sysEvent.eventSource !== undefined &&
      (event.sysEvent.eventType === undefined ||
        event.sysEvent.eventType === OsEventTypeList.CLICK_EVENT)
    ) {
      return { type: "text-click" };
    }
    return undefined;
  }

  if (event?.textEvent) {
    if (
      event.textEvent.eventType === undefined ||
      event.textEvent.eventType === OsEventTypeList.CLICK_EVENT
    ) {
      return { type: "text-click" };
    }
  }

  return undefined;
}
