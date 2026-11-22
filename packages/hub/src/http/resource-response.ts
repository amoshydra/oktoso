import {
  MAX_MEDIA_RESOURCE_BYTES,
  type ProviderResource,
  type ProviderResourceOpen,
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

/** The metadata a response needs, with or without a buffered body. */
export interface ResourceMeta {
  contentType?: string;
  filename?: string;
  contentLength?: number;
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
 * Used only when the provider ignored the range and the whole body is already
 * in memory; a provider that honors `Range` is relayed untouched.
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
      headers: notSatisfiableHeaders(total),
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
    headers: rangeHeaders({
      status: 206,
      contentLength: range.end - range.start + 1,
      contentRange: `bytes ${range.start}-${range.end}/${total}`,
    }),
  };
}

/** Headers for a resource that advertises seek support. */
export function rangeHeaders(input: {
  status: 200 | 206;
  contentLength?: number;
  contentRange?: string;
}): Record<string, string> {
  const headers: Record<string, string> = { "Accept-Ranges": "bytes" };
  if (input.contentLength !== undefined) {
    headers["Content-Length"] = String(input.contentLength);
  }
  if (input.status === 206 && input.contentRange) {
    headers["Content-Range"] = input.contentRange;
  }
  return headers;
}

export function notSatisfiableHeaders(total?: number): Record<string, string> {
  return {
    "Accept-Ranges": "bytes",
    "Content-Range": `bytes */${total === undefined ? "*" : total}`,
  };
}

/** Headers for a relayed provider response, buffered or streaming. */
export function openedResourceHeaders(
  opened: ProviderResourceOpen,
  options: ResourceHeaderOptions = {},
): Record<string, string> {
  if (opened.status === 416) return notSatisfiableHeaders(opened.totalBytes);
  return {
    ...resourceHeaders(opened, options),
    ...rangeHeaders(opened),
  };
}

/**
 * The range to forward upstream. Only a single `bytes=` range is forwarded;
 * anything else is left for the local slicer so a provider cannot be asked for
 * a multipart response the hub does not parse.
 */
export function forwardedRange(value: string | undefined): { range?: string } {
  if (!value) return {};
  return /^bytes=\d*-\d*$/.test(value.trim()) ? { range: value.trim() } : {};
}

/**
 * Resolve a client range against a provider response.
 *
 * A provider that honored the range already answered 206 and is relayed as-is.
 * One that ignored it answered 200 with the whole body, so the hub drops the
 * bytes before the range and cancels the upstream read at the end. That keeps
 * seeking working against providers that do not implement `Range`, without
 * buffering the file.
 */
export function applyRange(
  opened: ProviderResourceOpen,
  rangeHeader: string | undefined,
): ProviderResourceOpen {
  if (opened.status === 416 || !rangeHeader || opened.status === 206) {
    return opened;
  }
  const total = opened.totalBytes ?? opened.contentLength;
  if (total === undefined) {
    // The provider did not declare a size, so `206` is not honest.
    return opened;
  }
  const range = parseByteRange(rangeHeader, total);
  if (range === "invalid") return { status: 416, totalBytes: total };
  if (!range) return opened;

  return {
    ...opened,
    status: 206,
    contentLength: range.end - range.start + 1,
    contentRange: `bytes ${range.start}-${range.end}/${total}`,
    totalBytes: total,
    stream: sliceStream(opened.stream, range),
  };
}

/** Serve a buffered resource through the streaming shape, for adapters without `openFile`. */
export function openBufferedResource(
  resource: ProviderResource,
  rangeHeader: string | undefined,
): ProviderResourceOpen {
  const ranged = sliceForRange(resource, rangeHeader);
  if (ranged.status === 416) return { status: 416, totalBytes: resource.body.byteLength };
  return {
    status: ranged.status,
    stream: streamOf(ranged.body),
    ...(resource.contentType ? { contentType: resource.contentType } : {}),
    ...(resource.filename ? { filename: resource.filename } : {}),
    contentLength: ranged.body.byteLength,
    ...(ranged.headers["Content-Range"]
      ? { contentRange: ranged.headers["Content-Range"] }
      : {}),
    totalBytes: resource.body.byteLength,
  };
}

function streamOf(body: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
}

/** Forward only `range.start … range.end` of a stream, then cancel upstream. */
function sliceStream(
  stream: ReadableStream<Uint8Array>,
  range: ByteRange,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let position = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const chunkStart = position;
          position += value.byteLength;
          if (position <= range.start) continue;

          const from = Math.max(0, range.start - chunkStart);
          const to = Math.min(value.byteLength, range.end + 1 - chunkStart);
          if (to > from) controller.enqueue(value.subarray(from, to));

          if (position > range.end) {
            await reader.cancel().catch(() => undefined);
            controller.close();
            return;
          }
          if (to > from) return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => undefined);
    },
  });
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
  resource: ResourceMeta,
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
    ...(resource.contentLength === undefined
      ? {}
      : { "Content-Length": String(resource.contentLength) }),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  };
}
