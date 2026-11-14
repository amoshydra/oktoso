import type { ProviderResource } from "@amoshydra/oktoso-providers";

const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

const TEXT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "application/json",
]);

const INLINE_MEDIA_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
]);

const DOWNLOAD_TYPES = new Set([
  ...INLINE_IMAGE_TYPES,
  ...TEXT_TYPES,
  ...INLINE_MEDIA_TYPES,
  "application/pdf",
  "application/zip",
  "application/octet-stream",
]);

/**
 * Providers report their own content types. Only known-safe types survive; a
 * provider cannot make the hub serve an arbitrary type on its origin.
 */
export function safeContentType(value: string | undefined): string {
  if (value && DOWNLOAD_TYPES.has(value)) return value;
  return "application/octet-stream";
}

export function safeFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || undefined;
}

export interface ResourceHeaderOptions {
  /**
   * Render the file in the tab instead of forcing a download. The session file
   * reader opens text, HTML, and media, so it opts in; attachment links keep
   * downloading.
   */
  openInTab?: boolean;
}

/** Headers shared by the attachment proxy and the session file reader. */
export function resourceHeaders(
  resource: ProviderResource,
  options: ResourceHeaderOptions = {},
): Record<string, string> {
  const contentType = safeContentType(resource.contentType);
  const inline =
    INLINE_IMAGE_TYPES.has(contentType) ||
    (options.openInTab === true &&
      (TEXT_TYPES.has(contentType) || INLINE_MEDIA_TYPES.has(contentType)));
  const filename = safeFilename(resource.filename);

  return {
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${inline ? "inline" : "attachment"}${filename ? `; filename="${filename}"` : ""}`,
    "Content-Length": String(resource.body.byteLength),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
}
