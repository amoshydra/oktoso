import { describe, expect, it } from "vitest";
import type {
  Attention,
  AttentionType,
  Session,
} from "@amoshydra/oktoso-contracts";
import {
  attentionGlyph,
  attentionHeader,
  attentionRowLabel,
  sessionGlyph,
  sessionHeader,
  sessionRowLabel,
  SUBAGENT_GLYPH,
} from "./labels";

function attention(
  type: AttentionType,
  parentRef?: string,
): Attention {
  return {
    id: `attention-${type}`,
    sessionRef: "desktop-opencode:ses_child",
    ...(parentRef ? { parentRef } : {}),
    type,
    priority: "normal",
    title: "Fix auth race",
    summary: "Summary",
    createdAt: 1,
    actions: [],
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    ref: "desktop-opencode:ses_main",
    providerID: "desktop-opencode",
    nativeID: "ses_main",
    title: "Fix auth race",
    project: "agent-hub",
    status: "idle",
    unread: false,
    updatedAt: 1,
    createdAt: 1,
    ...overrides,
  };
}

describe("G2 labels", () => {
  it("uses one fixed glyph per attention type", () => {
    expect(attentionGlyph("unread")).toBe("●");
    expect(attentionGlyph("question")).toBe("?");
    expect(attentionGlyph("permission")).toBe("■");
    expect(attentionGlyph("approval")).toBe("▲");
    expect(attentionGlyph("error")).toBe("!");
  });

  it("marks subagent rows with a prefix", () => {
    expect(attentionRowLabel(attention("permission"))).toBe("■ Fix auth race");
    expect(attentionRowLabel(attention("permission", "desktop-opencode:ses_main"))).toBe(
      `${SUBAGENT_GLYPH}■ Fix auth race`,
    );
    expect(attentionHeader(attention("question", "desktop-opencode:ses_main"))).toBe(
      `${SUBAGENT_GLYPH}? Fix auth race`,
    );
  });

  it("prioritizes question, error, unread, running, offline, then idle", () => {
    expect(sessionGlyph(session({ unread: true }), true)).toBe("?");
    expect(sessionGlyph(session({ status: "error", unread: true }), false)).toBe("!");
    expect(sessionGlyph(session({ unread: true }), false)).toBe("●");
    expect(sessionGlyph(session({ status: "running" }), false)).toBe("▶");
    expect(sessionGlyph(session({ status: "offline" }), false)).toBe("▼");
    expect(sessionGlyph(session(), false)).toBe("◇");
  });

  it("renders session rows and headers with the subagent marker", () => {
    expect(sessionRowLabel(session({ unread: true }), false)).toBe("● Fix auth race");
    expect(
      sessionRowLabel(
        session({ parentRef: "desktop-opencode:ses_main", unread: true }),
        false,
      ),
    ).toBe(`${SUBAGENT_GLYPH}● Fix auth race`);
    expect(
      sessionHeader(session({ parentRef: "desktop-opencode:ses_main" })),
    ).toBe(`${SUBAGENT_GLYPH}agent-hub · Fix auth race`);
  });
});
