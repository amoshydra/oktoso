import { describe, expect, it } from "vitest";
import {
  PREVIEW_EXTENSIONS,
  isTextPreview,
  previewKind,
  previewMaxBytes,
  previewMimeType,
} from "./file-preview";

describe("previewKind", () => {
  it("uses the extension when the provider reports a generic type", () => {
    expect(previewKind("notes/plan.md")).toBe("markdown");
    expect(previewKind("plots/chart.png")).toBe("image");
    expect(previewKind("clip.mp4")).toBe("video");
    expect(previewKind("voice.m4a")).toBe("audio");
    expect(previewKind("spec.pdf")).toBe("pdf");
    expect(previewKind("report.html")).toBe("html");
    expect(previewKind("src/app.tsx")).toBe("text");
  });

  it("trusts a specific content type over the extension", () => {
    expect(previewKind("data.bin", "image/png")).toBe("image");
    expect(previewKind("story.md", "text/plain")).toBe("markdown");
    expect(previewKind("font.woff", "audio/mpeg")).toBe("audio");
    expect(previewKind("chart.svg", "image/svg+xml")).toBe("image");
  });

  it("falls back to text for unknown extensions and empty types", () => {
    expect(previewKind("Makefile")).toBe("text");
    expect(previewKind("archive.data", "application/octet-stream")).toBe("text");
  });
});

describe("previewMimeType", () => {
  it("supplies a type for media when the provider does not", () => {
    expect(previewMimeType("chart.png")).toBe("image/png");
    expect(previewMimeType("clip.mov")).toBe("video/quicktime");
    expect(previewMimeType("spec.pdf")).toBe("application/pdf");
    expect(previewMimeType("notes.md", "text/markdown")).toBe("text/markdown");
    expect(previewMimeType("unknown.zzz")).toBe("application/octet-stream");
  });
});

describe("preview limits", () => {
  it("caps text, HTML, and media separately", () => {
    expect(previewMaxBytes("markdown")).toBe(1024 * 1024);
    expect(previewMaxBytes("text")).toBe(1024 * 1024);
    expect(previewMaxBytes("html")).toBe(5 * 1024 * 1024);
    expect(previewMaxBytes("image")).toBe(20 * 1024 * 1024);
    expect(previewMaxBytes("video")).toBe(20 * 1024 * 1024);
  });

  it("treats only Markdown and text as readable source", () => {
    expect(isTextPreview("markdown")).toBe(true);
    expect(isTextPreview("text")).toBe(true);
    expect(isTextPreview("image")).toBe(false);
    expect(isTextPreview("html")).toBe(false);
  });
});

describe("PREVIEW_EXTENSIONS", () => {
  it("covers documents, code, images, media, and HTML", () => {
    for (const extension of [
      "md",
      "txt",
      "json",
      "ts",
      "png",
      "svg",
      "mp4",
      "mov",
      "mp3",
      "pdf",
      "html",
    ]) {
      expect(PREVIEW_EXTENSIONS.has(extension)).toBe(true);
    }
    expect(PREVIEW_EXTENSIONS.has("zip")).toBe(false);
    expect(PREVIEW_EXTENSIONS.has("exe")).toBe(false);
  });
});
