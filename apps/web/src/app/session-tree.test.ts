import { describe, expect, it } from "vitest";
import type { Session } from "@amoshydra/oktoso-contracts";
import {
  buildSessionTree,
  countTreeSessions,
  filterSessionTree,
} from "./session-tree";

function session(
  ref: string,
  updatedAt: number,
  parentRef?: string,
  status: Session["status"] = "idle",
): Session {
  return {
    ref,
    providerID: "desktop-opencode",
    nativeID: ref,
    title: ref,
    status,
    unread: false,
    updatedAt,
    createdAt: 0,
    ...(parentRef ? { parentRef } : {}),
  };
}

describe("buildSessionTree", () => {
  it("nests children under their parent and sorts newest first", () => {
    const tree = buildSessionTree([
      session("root-a", 10),
      session("child-a1", 30, "root-a"),
      session("child-a2", 20, "root-a"),
      session("root-b", 40),
    ]);

    expect(tree.nodes.map((node) => node.session.ref)).toEqual([
      "root-b",
      "root-a",
    ]);
    expect(tree.nodes[1]?.children.map((node) => node.session.ref)).toEqual([
      "child-a1",
      "child-a2",
    ]);
    expect(tree.nodes[1]?.latestAt).toBe(30);
    expect(tree.childCount).toBe(2);
  });

  it("keeps subagents whose parent is outside the page as orphans", () => {
    const tree = buildSessionTree([
      session("root", 10),
      session("orphan", 20, "missing-parent"),
    ]);
    expect(tree.orphans.map((item) => item.ref)).toEqual(["orphan"]);
    expect(tree.childCount).toBe(1);
  });

  it("nests more than one level without losing a grandchild", () => {
    const tree = buildSessionTree([
      session("root", 10),
      session("child", 20, "root"),
      session("grandchild", 30, "child"),
    ]);
    expect(tree.nodes[0]?.children[0]?.children[0]?.session.ref).toBe(
      "grandchild",
    );
    expect(tree.nodes[0]?.latestAt).toBe(30);
    expect(countTreeSessions(tree.nodes)).toBe(3);
  });
});

describe("filterSessionTree", () => {
  it("keeps a parent when only a child matches", () => {
    const tree = buildSessionTree([
      session("root", 10),
      session("child-a", 20, "root"),
      session("child-b", 30, "root"),
    ]);
    const filtered = filterSessionTree(tree.nodes, (item) => item.ref === "child-b");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.session.ref).toBe("root");
    expect(filtered[0]?.children.map((node) => node.session.ref)).toEqual([
      "child-b",
    ]);
  });

  it("drops a branch with no matching session", () => {
    const tree = buildSessionTree([session("root", 10), session("child", 20, "root")]);
    expect(filterSessionTree(tree.nodes, () => false)).toEqual([]);
  });
});
