import { describe, expect, it } from "vitest";
import type { Message, Session } from "@amoshydra/oktoso-contracts";
import { exportFilename, exportJson, exportMarkdown } from "./session-export";

const session: Session = {
  ref: "desktop-opencode:ses_auth",
  providerID: "desktop-opencode",
  nativeID: "ses_auth",
  title: "Fix auth race in gateway!",
  project: "oktoso",
  directory: "/home/me/oktoso",
  status: "idle",
  unread: false,
  createdAt: 1_792_970_000_000,
  updatedAt: 1_792_970_180_000,
};

const messages: Message[] = [
  {
    id: "m1",
    sessionRef: session.ref,
    role: "user",
    parts: [{ type: "text", text: "Why does the token rotate twice?" }],
    createdAt: 1_792_970_060_000,
  },
  {
    id: "m2",
    sessionRef: session.ref,
    role: "assistant",
    parts: [
      { type: "reasoning", text: "hidden reasoning" },
      { type: "text", text: "Because two writers race." },
      { type: "tool", id: "t1", name: "bash", status: "completed" },
      { type: "file", name: "plot.png", mimeType: "image/png" },
    ],
    createdAt: 1_792_970_120_000,
  },
];

describe("exportMarkdown", () => {
  it("writes a header block and one section per message", () => {
    const body = exportMarkdown({ session, messages, exportedAt: 1_792_980_000_000 });

    expect(body).toContain("# Fix auth race in gateway!");
    expect(body).toContain("- Session: `desktop-opencode:ses_auth`");
    expect(body).toContain("- Project: oktoso");
    expect(body).toContain(`## user · ${new Date(1_792_970_060_000).toISOString()}`);
    expect(body).toContain("Because two writers race.");
  });

  it("omits reasoning and tool payloads but says what was left out", () => {
    const body = exportMarkdown({ session, messages, exportedAt: 0 });

    expect(body).not.toContain("hidden reasoning");
    expect(body).toContain("_1 tool call omitted._");
    expect(body).toContain("_1 attachment not embedded._");
  });

  it("handles a session with no messages", () => {
    const body = exportMarkdown({ session, messages: [], exportedAt: 0 });
    expect(body).toContain("_No messages._");
  });
});

describe("exportJson", () => {
  it("round-trips the session and transcript", () => {
    const body = exportJson({ session, messages, exportedAt: 1_792_980_000_000 });
    const parsed = JSON.parse(body) as {
      exportedAt: string;
      session: Session;
      messages: Message[];
    };

    expect(parsed.exportedAt).toBe(new Date(1_792_980_000_000).toISOString());
    expect(parsed.session.ref).toBe(session.ref);
    expect(parsed.messages.map((message) => message.id)).toEqual(["m1", "m2"]);
  });
});

describe("exportFilename", () => {
  it("slugifies the title and keeps the date and format", () => {
    expect(exportFilename(session, "md")).toBe(
      `desktop-opencode-fix-auth-race-in-gateway-${new Date(session.updatedAt).toISOString().slice(0, 10)}.md`,
    );
    expect(exportFilename(session, "json")).toMatch(/\.json$/);
  });

  it("falls back when the title has no usable characters", () => {
    expect(
      exportFilename({ ...session, title: "!!!" }, "md"),
    ).toBe(
      `desktop-opencode-session-${new Date(session.updatedAt).toISOString().slice(0, 10)}.md`,
    );
  });
});
