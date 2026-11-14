import { describe, expect, it } from "vitest";
import {
  attachmentProxyPath,
  isProviderResource,
  previewableFilePath,
  resolveProviderUrl,
  resolveSessionResource,
} from "./urls";

const base = "http://127.0.0.1:4096";

describe("resolveProviderUrl", () => {
  it("keeps absolute provider links", () => {
    expect(resolveProviderUrl("https://example.com/a", base)).toBe(
      "https://example.com/a",
    );
  });

  it("resolves relative provider links against the provider base", () => {
    expect(resolveProviderUrl("/session/abc", base)).toBe(
      "http://127.0.0.1:4096/session/abc",
    );
    expect(resolveProviderUrl("./src/auth.ts", base)).toBe(
      "http://127.0.0.1:4096/src/auth.ts",
    );
    expect(resolveProviderUrl("//cdn.example.com/a.png", base)).toBe(
      "http://cdn.example.com/a.png",
    );
  });

  it("does not resolve relative links without a provider base", () => {
    expect(resolveProviderUrl("/session/abc", undefined)).toBeUndefined();
    expect(resolveProviderUrl("./src/auth.ts", "")).toBeUndefined();
  });

  it("allows mail and phone links in prose but not images", () => {
    expect(resolveProviderUrl("mailto:me@example.com", base)).toBe(
      "mailto:me@example.com",
    );
    expect(resolveProviderUrl("tel:+123", base)).toBe("tel:+123");
    expect(resolveProviderUrl("mailto:me@example.com", base, "image")).toBeUndefined();
  });

  it("rejects executable and unknown schemes", () => {
    expect(resolveProviderUrl("javascript:alert(1)", base)).toBeUndefined();
    expect(resolveProviderUrl("file:///etc/passwd", base)).toBeUndefined();
    expect(resolveProviderUrl("blob:http://127.0.0.1/abc", base)).toBeUndefined();
  });

  it("allows safe inline images and rejects svg data URLs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveProviderUrl(png, base, "image")).toBe(png);
    expect(
      resolveProviderUrl("data:image/svg+xml;base64,PHN2Zz4=", base, "image"),
    ).toBeUndefined();
  });

  it("leaves document anchors alone for links", () => {
    expect(resolveProviderUrl("#section", base)).toBe("#section");
    expect(resolveProviderUrl("#section", base, "image")).toBeUndefined();
  });
});

describe("isProviderResource", () => {
  it("matches the configured provider origin", () => {
    expect(isProviderResource("http://127.0.0.1:4096/file.png", base)).toBe(true);
    expect(isProviderResource("/file.png", base)).toBe(false);
  });

  it("does not match other origins or data URLs", () => {
    expect(isProviderResource("https://example.com/file.png", base)).toBe(false);
    expect(isProviderResource("data:image/png;base64,abc", base)).toBe(false);
    expect(isProviderResource("http://127.0.0.1:5000/file.png", base)).toBe(false);
  });
});

describe("resolveSessionResource", () => {
  const context = {
    baseUrl: base,
    providerID: "desktop-opencode",
    providerType: "opencode",
    directory: "/home/me/project",
  };

  it("maps OpenCode file links to the fs read endpoint", () => {
    const resolved = resolveSessionResource("docs/spec.md", context, "link");
    expect(resolved.attachment).toBe(true);
    expect(resolved.url).toBe(
      "http://127.0.0.1:4096/api/fs/read/docs/spec.md?location%5Bdirectory%5D=%2Fhome%2Fme%2Fproject",
    );

    const image = resolveSessionResource("docs/concepts/shelf.png", context, "image");
    expect(image.attachment).toBe(true);
    expect(image.url).toContain("/api/fs/read/docs/concepts/shelf.png");
  });

  it("leaves OpenCode provider routes and absolute links alone", () => {
    expect(resolveSessionResource("/session/abc", context, "link")).toMatchObject({
      attachment: false,
      url: "http://127.0.0.1:4096/session/abc",
    });
    expect(
      resolveSessionResource("https://example.com/a.png", context, "image"),
    ).toMatchObject({ attachment: false, url: "https://example.com/a.png" });
  });

  it("resolves Open WebUI relative files against the provider base", () => {
    const resolved = resolveSessionResource(
      "/api/files/shot.png",
      { baseUrl: base, providerID: "openwebui", providerType: "openwebui" },
      "image",
    );
    expect(resolved).toMatchObject({
      attachment: true,
      url: "http://127.0.0.1:4096/api/files/shot.png",
    });
  });
});

describe("attachmentProxyPath", () => {
  it("encodes the provider and resource URL", () => {
    expect(
      attachmentProxyPath("desktop-opencode", "http://127.0.0.1:4096/api/fs/read/a.png?x=1"),
    ).toBe(
      "/api/v1/attachments?provider=desktop-opencode&url=http%3A%2F%2F127.0.0.1%3A4096%2Fapi%2Ffs%2Fread%2Fa.png%3Fx%3D1",
    );
  });
});

describe("previewableFilePath", () => {
  it("accepts relative text files", () => {
    expect(previewableFilePath("trip-korea-2026.md")).toBe("trip-korea-2026.md");
    expect(previewableFilePath("./notes/plan.md")).toBe("notes/plan.md");
    expect(previewableFilePath("src/app.tsx")).toBe("src/app.tsx");
    expect(previewableFilePath("config.yaml?plain=1")).toBe("config.yaml");
  });

  it("accepts documents, images, media, and HTML", () => {
    for (const mention of [
      "plots/chart.png",
      "clip.mp4",
      "voice.m4a",
      "spec.pdf",
      "report.html",
      "diagram.svg",
    ]) {
      expect(previewableFilePath(mention)).toBe(mention);
    }
  });

  it("accepts an absolute path inside the session directory", () => {
    expect(
      previewableFilePath("/home/me/project/notes/plan.md", "/home/me/project"),
    ).toBe("notes/plan.md");
    expect(
      previewableFilePath("/home/me/other/plan.md", "/home/me/project"),
    ).toBeUndefined();
  });

  it("rejects commands, URLs, absolute paths, and binary types", () => {
    expect(previewableFilePath("pnpm run build")).toBeUndefined();
    expect(previewableFilePath("npm")).toBeUndefined();
    expect(previewableFilePath("127.0.0.1:4056")).toBeUndefined();
    expect(previewableFilePath("https://example.com/a.md")).toBeUndefined();
    expect(previewableFilePath("/home/me/notes.md")).toBeUndefined();
    expect(previewableFilePath("../notes.md")).toBeUndefined();
    expect(previewableFilePath("/home/me/notes.md")).toBeUndefined();
    expect(previewableFilePath("archive.zip")).toBeUndefined();
    expect(previewableFilePath("binary.bin")).toBeUndefined();
    expect(previewableFilePath("app.exe")).toBeUndefined();
    expect(previewableFilePath("--with-flag")).toBeUndefined();
    expect(previewableFilePath("")).toBeUndefined();
    expect(previewableFilePath(undefined)).toBeUndefined();
  });
});
