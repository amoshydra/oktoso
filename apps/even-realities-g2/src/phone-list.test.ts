import { describe, expect, it } from "vitest";
import { MIRROR_LINES, phoneListBody, phoneListWindow } from "./phone-list";

describe("phoneListWindow", () => {
  it("keeps the window fixed while the cursor moves inside it", () => {
    let start = 0;
    for (const cursor of [0, 1, 2, 3, 4, 5]) {
      start = phoneListWindow(cursor, 12, 6, start);
      expect(start).toBe(0);
    }
  });

  it("moves one row when the cursor crosses the bottom edge", () => {
    expect(phoneListWindow(6, 12, 6, 0)).toBe(1);
    expect(phoneListWindow(7, 12, 6, 1)).toBe(2);
  });

  it("moves one row when the cursor crosses the top edge", () => {
    expect(phoneListWindow(1, 12, 6, 2)).toBe(1);
    expect(phoneListWindow(0, 12, 6, 1)).toBe(0);
  });

  it("clamps at the ends and when the list is shorter than the window", () => {
    expect(phoneListWindow(11, 12, 6, 0)).toBe(6);
    expect(phoneListWindow(0, 4, 6, 3)).toBe(0);
  });
});

describe("phoneListBody", () => {
  const items = Array.from({ length: 12 }, (_, index) => `Row ${index + 1}`);

  it("shows six rows with a marker when there is no summary", () => {
    const view = phoneListBody("", items, 0, 0);
    expect(view.body.split("\n")).toHaveLength(MIRROR_LINES);
    expect(view.body.split("\n")[0]).toBe("› Row 1");
    expect(view.body.split("\n")[1]).toBe("  Row 2");
  });

  it("never grows past the body height with a summary", () => {
    const view = phoneListBody("one\ntwo", items, 0, 0);
    const lines = view.body.split("\n");
    expect(lines).toHaveLength(MIRROR_LINES);
    expect(lines.slice(0, 2)).toEqual(["one", "two"]);
    expect(lines[2]).toBe("› Row 1");
  });

  it("keeps the window fixed inside the shorter row budget", () => {
    let start = 0;
    for (const cursor of [0, 1, 2, 3]) {
      const view = phoneListBody("one\ntwo", items, cursor, start);
      start = view.start;
      expect(start).toBe(0);
    }
    expect(phoneListBody("one\ntwo", items, 4, start).start).toBe(1);
  });

  it("clamps the summary and long rows to their line budgets", () => {
    const view = phoneListBody(
      `${"s".repeat(80)}\nsecond\nthird`,
      [`${"r".repeat(80)}`],
      0,
      0,
    );
    const lines = view.body.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].length).toBeLessThanOrEqual(54);
    expect(lines[1]).toBe("second");
    expect(lines[2].length).toBeLessThanOrEqual(54);
  });
});
