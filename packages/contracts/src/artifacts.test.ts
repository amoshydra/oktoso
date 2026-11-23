import { describe, expect, it } from "vitest";
import type { Message, MessagePart } from "./messages";
import {
  artifactPathFromToolPart,
  artifactPathsFromMessages,
  resolveArtifactPath,
} from "./artifacts";

function tool(name: string, input: unknown): MessagePart {
  return {
    type: "tool",
    id: "tool_1",
    name,
    status: "completed",
    input,
  };
}

function message(parts: MessagePart[]): Message {
  return {
    id: "msg_1",
    sessionRef: "test:ses_1",
    role: "assistant",
    parts,
    createdAt: 1,
  };
}

describe("artifactPathFromToolPart", () => {
  it("reads the path from write, edit, and read tools", () => {
    expect(
      artifactPathFromToolPart(tool("write", { path: "/tmp/a.md" })),
    ).toBe("/tmp/a.md");
    expect(
      artifactPathFromToolPart(tool("edit", { filePath: "src/a.ts" })),
    ).toBe("src/a.ts");
    expect(artifactPathFromToolPart(tool("read", { file: "/tmp/b.png" }))).toBe(
      "/tmp/b.png",
    );
  });

  it("ignores shell, search, and prose-like tools", () => {
    expect(
      artifactPathFromToolPart(tool("shell", { path: "/etc/passwd" })),
    ).toBeUndefined();
    expect(
      artifactPathFromToolPart(tool("grep", { path: "/tmp" })),
    ).toBeUndefined();
  });
});

describe("resolveArtifactPath", () => {
  it("keeps absolute paths and joins relative ones to the session", () => {
    expect(resolveArtifactPath("/home/me/project", "/tmp/a.md")).toBe(
      "/tmp/a.md",
    );
    expect(resolveArtifactPath("/home/me/project", "notes/a.md")).toBe(
      "/home/me/project/notes/a.md",
    );
    expect(resolveArtifactPath("/home/me/project", "./notes/../a.md")).toBe(
      "/home/me/project/a.md",
    );
  });

  it("normalizes repeated separators and backslashes", () => {
    expect(resolveArtifactPath("/home/me/project", "notes//a.md")).toBe(
      "/home/me/project/notes/a.md",
    );
    expect(resolveArtifactPath("/home/me/project", "notes\\a.md")).toBe(
      "/home/me/project/notes/a.md",
    );
  });

  it("requires a directory for a relative path", () => {
    expect(resolveArtifactPath(undefined, "notes/a.md")).toBeUndefined();
  });
});

describe("artifactPathsFromMessages", () => {
  it("collects distinct absolute tool paths", () => {
    const paths = artifactPathsFromMessages(
      [
        message([
          tool("write", { path: "/tmp/a.md" }),
          tool("read", { path: "notes/b.md" }),
        ]),
        message([tool("write", { path: "/tmp/a.md" })]),
      ],
      "/home/me/project",
    );
    expect(paths.sort()).toEqual(["/home/me/project/notes/b.md", "/tmp/a.md"]);
  });
});
