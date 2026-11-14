import { describe, expect, it } from "vitest";
import { normalizeSessionPath, relativeSessionPath } from "./files";

describe("normalizeSessionPath", () => {
  it("keeps relative paths and drops redundant segments", () => {
    expect(normalizeSessionPath("notes/plan.md")).toBe("notes/plan.md");
    expect(normalizeSessionPath("./notes//plan.md")).toBe("notes/plan.md");
    expect(normalizeSessionPath(" notes/plan.md ")).toBe("notes/plan.md");
  });

  it("normalizes Windows separators", () => {
    expect(normalizeSessionPath("notes\\plan.md")).toBe("notes/plan.md");
  });

  it("rejects escapes, absolute paths, and empty values", () => {
    expect(() => normalizeSessionPath("../secrets")).toThrow(/session directory/);
    expect(() => normalizeSessionPath("notes/../../secrets")).toThrow(
      /session directory/,
    );
    expect(() => normalizeSessionPath("/etc/passwd")).toThrow(/Absolute/);
    expect(() => normalizeSessionPath("C:/Windows/system.ini")).toThrow(
      /Absolute/,
    );
    expect(() => normalizeSessionPath("")).toThrow(/required/);
    expect(() => normalizeSessionPath("./")).toThrow(/required/);
    expect(() => normalizeSessionPath("a\0b")).toThrow(/invalid/);
    expect(() => normalizeSessionPath(`${"a".repeat(1025)}`)).toThrow(/too long/);
  });
});

describe("relativeSessionPath", () => {
  it("keeps relative paths", () => {
    expect(relativeSessionPath("notes/plan.md", "/home/me/project")).toBe(
      "notes/plan.md",
    );
  });

  it("accepts absolute paths inside the session directory", () => {
    expect(
      relativeSessionPath("/home/me/project/notes/plan.md", "/home/me/project/"),
    ).toBe("notes/plan.md");
  });

  it("rejects absolute paths outside the session directory", () => {
    expect(() =>
      relativeSessionPath("/home/me/other/notes/plan.md", "/home/me/project"),
    ).toThrow(/outside the session directory/);
    expect(() =>
      relativeSessionPath("/home/me/project-other/notes.md", "/home/me/project"),
    ).toThrow(/outside the session directory/);
    expect(() =>
      relativeSessionPath("/home/me/project/../secrets", "/home/me/project"),
    ).toThrow(/session directory/);
    expect(() => relativeSessionPath("/etc/passwd", undefined)).toThrow(
      /working directory/,
    );
  });
});
