import { describe, expect, it } from "vitest";
import { phoneListWindow } from "./phone-list";

describe("phoneListWindow", () => {
  it("keeps the window fixed while the cursor moves inside it", () => {
    let start = 0;
    for (const cursor of [0, 1, 2, 3, 4, 5, 6]) {
      start = phoneListWindow(cursor, 12, 7, start);
      expect(start).toBe(0);
    }
  });

  it("moves one row when the cursor crosses the bottom edge", () => {
    expect(phoneListWindow(7, 12, 7, 0)).toBe(1);
    expect(phoneListWindow(8, 12, 7, 1)).toBe(2);
  });

  it("moves one row when the cursor crosses the top edge", () => {
    expect(phoneListWindow(1, 12, 7, 2)).toBe(1);
    expect(phoneListWindow(0, 12, 7, 1)).toBe(0);
  });

  it("clamps at the ends and when the list is shorter than the window", () => {
    expect(phoneListWindow(11, 12, 7, 0)).toBe(5);
    expect(phoneListWindow(0, 4, 7, 3)).toBe(0);
  });
});
