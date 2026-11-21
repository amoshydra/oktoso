import {
  MAX_MEDIA_RESOURCE_BYTES,
  type ProviderResource,
} from "@amoshydra/oktoso-providers";

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
  "text/css",
  "text/javascript",
  "application/javascript",
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

const MEDIA_EXTENSION =
  /\.(?:mp4|m4v|webm|mov|ogv|ogg|mp3|m4a|wav|flac)(?:[?#]|$)/i;

/**
 * Media gets the streaming cap; a 3-minute 1080p clip is normal, and the
 * browser streams it with Range requests rather than opening it inline as an
 * attachment. Everything else keeps the 20 MB attachment cap.
 */
export function mediaMaxBytes(pathOrUrl: string | undefined): number | undefined {
  return pathOrUrl && MEDIA_EXTENSION.test(pathOrUrl)
    ? MAX_MEDIA_RESOURCE_BYTES
    : undefined;
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single `bytes=` range. A missing or non-byte range is `undefined`
 * (serve the whole file); an unsatisfiable one is `"invalid"` (416).
 */
export function parseByteRange(
  value: string | undefined,
  total: number,
): ByteRange | "invalid" | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return "invalid";

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "invalid";
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? total - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
    if (start > end) return "invalid";
  }
  if (start >= total) return "invalid";
  return { start, end: Math.min(end, total - 1) };
}

/**
 * Slice a buffered resource for a Range request.
 *
 * The provider read is still whole-file; only the client side is ranged. That
 * is enough for seeking and for clients that require 206, without teaching
 * every adapter to forward byte ranges.
 */
export type RangedResource =
  | { status: 416; body: undefined; headers: Record<string, string> }
  | {
      status: 200 | 206;
      body: Uint8Array<ArrayBuffer>;
      headers: Record<string, string>;
    };

export function sliceForRange(
  resource: ProviderResource,
  rangeHeader: string | undefined,
): RangedResource {
  const total = resource.body.byteLength;
  const range = parseByteRange(rangeHeader, total);
  if (range === "invalid") {
    return {
      status: 416,
      body: undefined,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${total}`,
      },
    };
  }
  if (!range) {
    return {
      status: 200,
      body: resource.body,
      headers: { "Accept-Ranges": "bytes" },
    };
  }
  return {
    status: 206,
    body: resource.body.subarray(range.start, range.end + 1),
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
      "Content-Length": String(range.end - range.start + 1),
    },
  };
}

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
