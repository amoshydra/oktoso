import { describe, expect, it } from "vitest";
import {
  FOOTER_Y,
  GLASS_HEIGHT,
  GLASS_WIDTH,
  listPage,
  textPage,
} from "./layout";

function captures(page: ReturnType<typeof textPage>): number {
  const textCaptures = (page.textObject ?? []).filter(
    (container) => container.isEventCapture === 1,
  ).length;
  const listCaptures = (page.listObject ?? []).filter(
    (container) => container.isEventCapture === 1,
  ).length;
  return textCaptures + listCaptures;
}

function assertInsideGlass(page: ReturnType<typeof textPage>): void {
  for (const container of [
    ...(page.textObject ?? []),
    ...(page.listObject ?? []),
  ]) {
    expect(container.xPosition ?? 0).toBeGreaterThanOrEqual(0);
    expect(container.yPosition ?? 0).toBeGreaterThanOrEqual(0);
    expect((container.xPosition ?? 0) + (container.width ?? 0)).toBeLessThanOrEqual(
      GLASS_WIDTH,
    );
    expect(
      (container.yPosition ?? 0) + (container.height ?? 0),
    ).toBeLessThanOrEqual(GLASS_HEIGHT);
  }
}

describe("G2 frame layout", () => {
  it("snapshots the text frame", () => {
    expect(textPage("Body copy", "Footer hint", "HEADER").toJson()).toMatchSnapshot();
  });

  it("snapshots the list frame", () => {
    expect(
      listPage("RECENT 2", ["First session", "Second session"], "Tap open").toJson(),
    ).toMatchSnapshot();
  });

  it("snapshots the list frame with a summary body", () => {
    expect(
      listPage("ATTENTION", ["One item"], "Tap choose", "Summary line").toJson(),
    ).toMatchSnapshot();
  });

  it("uses exactly one event-capturing container per page", () => {
    expect(captures(textPage("Body", "Footer"))).toBe(1);
    expect(captures(listPage("LIST", ["Item"], "Footer"))).toBe(1);
    expect(captures(listPage("LIST", ["Item"], "Footer", "Body"))).toBe(1);
  });

  it("keeps the list as the capture target and the footer as a hint", () => {
    const page = listPage("LIST", ["Item"], "Footer");
    expect(page.listObject?.[0]?.isEventCapture).toBe(1);
    expect(
      page.textObject?.filter((container) => container.containerName === "footer")[0]
        ?.isEventCapture,
    ).toBe(0);
    expect(page.textObject?.[0]?.containerName).toBe("header");
  });

  it("keeps every container within the 576×288 display", () => {
    assertInsideGlass(textPage("Body", "Footer"));
    assertInsideGlass(listPage("LIST", ["Item"], "Footer"));
    assertInsideGlass(listPage("LIST", ["Item"], "Footer", "Body"));
  });

  it("keeps the footer pinned to the bottom", () => {
    const page = listPage("LIST", ["Item"], "Footer", "Body");
    const footer = page.textObject?.find(
      (container) => container.containerName === "footer",
    );
    expect(footer?.yPosition).toBe(FOOTER_Y);
    expect((footer?.yPosition ?? 0) + (footer?.height ?? 0)).toBe(GLASS_HEIGHT);
  });

  it("maps list items without dropping or inventing rows", () => {
    const page = listPage("LIST", ["One", "Two", "Three"], "Footer");
    expect(page.listObject?.[0]?.itemContainer?.itemCount).toBe(3);
    expect(page.listObject?.[0]?.itemContainer?.itemName).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });
});
