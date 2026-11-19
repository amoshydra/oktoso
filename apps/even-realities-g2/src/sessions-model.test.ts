import { describe, expect, it } from "vitest";
import type { Session } from "@amoshydra/oktoso-contracts";
import {
  SESSIONS_PER_PAGE,
  sessionListPage,
} from "./sessions-model";

function sessions(count: number): Session[] {
  return Array.from({ length: count }, (_, index) => ({
    ref: `desktop-opencode:ses_${index}`,
    providerID: "desktop-opencode",
    nativeID: `ses_${index}`,
    title: `Session ${index}`,
    status: "idle" as const,
    unread: false,
    updatedAt: count - index,
    createdAt: count - index,
  }));
}

describe("G2 session pagination", () => {
  it("shows five sessions per page", () => {
    const view = sessionListPage(sessions(12), 0, true);

    expect(SESSIONS_PER_PAGE).toBe(5);
    expect(view.sessions).toHaveLength(5);
    expect(view.sessions[0]?.title).toBe("Session 0");
    expect(view.page).toBe(0);
    expect(view.pages).toBe(3);
    expect(view.hasMore).toBe(true);
  });

  it("walks to the last page", () => {
    const view = sessionListPage(sessions(12), 2, true);

    expect(view.sessions.map((session) => session.title)).toEqual([
      "Session 10",
      "Session 11",
    ]);
    expect(view.page).toBe(2);
    expect(view.hasMore).toBe(true);
  });

  it("stops paging when the window and the cursor are exhausted", () => {
    const view = sessionListPage(sessions(12), 2, false);

    expect(view.hasMore).toBe(false);
  });

  it("clamps an out-of-range page", () => {
    expect(sessionListPage(sessions(7), 9, false).page).toBe(1);
    expect(sessionListPage(sessions(7), -3, false).page).toBe(0);
  });

  it("keeps an empty list on one page with nothing more", () => {
    const view = sessionListPage([], 0, true);

    expect(view.sessions).toEqual([]);
    expect(view.pages).toBe(1);
    expect(view.hasMore).toBe(false);
  });
});
