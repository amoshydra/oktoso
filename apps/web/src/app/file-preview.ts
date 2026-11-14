/**
 * How the preview sheet should display a mentioned file.
 *
 * The hub returns the provider's bytes with a normalized content type. The
 * extension is the fallback because a provider may report
 * `application/octet-stream` for an image or a video.
 */
export type PreviewKind =
  | "markdown"
  | "text"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "html";

const EXTENSION_KINDS: Record<string, PreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  ogv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  flac: "audio",
  pdf: "pdf",
  html: "html",
  htm: "html",
};

/** Text-like extensions: shown as source, never as a rendered document. */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "css",
  "scss",
  "sass",
  "xml",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "env",
  "gitignore",
]);

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  jsonc: "application/json",
  yaml: "text/plain",
  yml: "text/plain",
  toml: "text/plain",
  ini: "text/plain",
  csv: "text/plain",
  xml: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
};

const TEXT_MAX_BYTES = 1024 * 1024;
const HTML_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

/** Every extension the transcript turns into a preview button. */
export const PREVIEW_EXTENSIONS = new Set([
  ...Object.keys(EXTENSION_KINDS),
  ...TEXT_EXTENSIONS,
]);

export function fileExtension(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function previewKind(path: string, mimeType?: string): PreviewKind {
  const mime = mimeType?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime === "image/svg+xml") return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "text/markdown") return "markdown";

  return EXTENSION_KINDS[fileExtension(path)] ?? "text";
}

/** Best content type for an object URL when the provider did not supply one. */
export function previewMimeType(path: string, mimeType?: string): string {
  const mime = mimeType?.trim();
  if (mime && mime !== "application/octet-stream") return mime;
  return MIME_TYPES[fileExtension(path)] ?? "application/octet-stream";
}

export function previewMaxBytes(kind: PreviewKind): number {
  if (kind === "html") return HTML_MAX_BYTES;
  if (kind === "markdown" || kind === "text") return TEXT_MAX_BYTES;
  return MEDIA_MAX_BYTES;
}

export function isTextPreview(kind: PreviewKind): boolean {
  return kind === "markdown" || kind === "text";
}
