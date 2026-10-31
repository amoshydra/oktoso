import { describe, expect, it } from "vitest";
import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import { glassInput } from "./input";

describe("glass input", () => {
  it("treats a list event without an event type as a click", () => {
    expect(glassInput({ listEvent: { currentSelectItemIndex: 2 } })).toEqual({
      type: "list-click",
      index: 2,
    });
  });

  it("treats a sys event with a source and no type as a text tap", () => {
    expect(glassInput({ sysEvent: { eventSource: 1 } })).toEqual({
      type: "text-click",
    });
  });

  it("treats a text event without an event type as a tap", () => {
    expect(glassInput({ textEvent: {} })).toEqual({ type: "text-click" });
  });

  it("maps double taps to back", () => {
    expect(
      glassInput({
        sysEvent: {
          eventSource: 1,
          eventType: OsEventTypeList.DOUBLE_CLICK_EVENT,
        },
      }),
    ).toEqual({ type: "back" });
  });

  it("maps scroll directions and ignores foreground transitions", () => {
    expect(
      glassInput({
        sysEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT },
      }),
    ).toEqual({ type: "scroll", direction: -1 });
    expect(
      glassInput({
        sysEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT },
      }),
    ).toEqual({ type: "scroll", direction: 1 });
    expect(
      glassInput({
        sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT },
      }),
    ).toBeUndefined();
  });

  it("maps list scroll events without treating them as clicks", () => {
    expect(
      glassInput({
        listEvent: {
          eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT,
          currentSelectItemIndex: 1,
        },
      }),
    ).toEqual({ type: "scroll", direction: 1 });
  });
});
