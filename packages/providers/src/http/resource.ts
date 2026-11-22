import { ProviderError } from "../errors";
import type {
  ProviderResource,
  ProviderResourceOpen,
  ProviderResourceStream,
} from "../types";

export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
/** Media is streamed by the browser; an attachment cap does not apply. */
export const MAX_MEDIA_RESOURCE_BYTES = 256 * 1024 * 1024;
/** A stalled body cannot pin a provider socket forever. */
export const RESOURCE_STREAM_TIMEOUT_MS = 10 * 60 * 1_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ReadProviderResourceOptions {
  url: string;
  baseUrl: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  providerLabel: string;
  maxBytes?: number;
  /** `bytes=start-end`; the provider may ignore it and return the whole file. */
  range?: string;
  streamTimeoutMs?: number;
}

/**
 * Fetch a provider-hosted resource with the provider credentials.
 *
 * The proxy only accepts resources on the configured provider origin. Redirects
 * are followed manually so a provider cannot bounce the hub to another host.
 */
export async function readProviderResource(
  options: ReadProviderResourceOptions,
): Promise<ProviderResource> {
  const maxBytes = options.maxBytes ?? MAX_RESOURCE_BYTES;
  const opened = await openProviderResource({ ...options, range: undefined });
  if (!("stream" in opened)) {
    throw new ProviderError(
      "invalid_request",
      `${options.providerLabel} attachment range is not satisfiable`,
      { status: 416, retryable: false },
    );
  }
  const body = await collectStream(opened.stream, maxBytes);
  return {
    body,
    ...(opened.contentType ? { contentType: opened.contentType } : {}),
    ...(opened.filename ? { filename: opened.filename } : {}),
  };
}

/**
 * Open a provider resource without buffering it.
 *
 * A `range` is forwarded upstream. A provider that honors it answers `206` and
 * the body is relayed as-is; one that ignores it answers `200` and the caller
 * decides whether to serve the whole file or slice it. `maxBytes` applies to
 * the whole resource, not to the requested range, so a `Range` cannot be used
 * to read past the media cap.
 */
export async function openProviderResource(
  options: ReadProviderResourceOptions,
): Promise<ProviderResourceOpen> {
  const maxBytes = options.maxBytes ?? MAX_RESOURCE_BYTES;
  const { response, url } = await fetchResource(options);

  if (response.status === 416) {
    const totalBytes = totalFromContentRange(
      response.headers.get("content-range"),
    );
    await response.body?.cancel().catch(() => undefined);
    return { status: 416, ...(totalBytes === undefined ? {} : { totalBytes }) };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw providerStatusError(options.providerLabel, response.status);
  }

  const declaredLength = numberHeader(response.headers.get("content-length"));
  const contentRange =
    response.status === 206
      ? (response.headers.get("content-range") ?? undefined)
      : undefined;
  const totalBytes =
    totalFromContentRange(contentRange) ??
    (response.status === 200 ? declaredLength : undefined);

  // The cap protects the hub's memory. A ranged response is checked against
  // the resource it belongs to, since `Content-Length` only counts the slice.
  const size = totalBytes ?? declaredLength;
  if (size !== undefined && size > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(maxBytes);
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const filename =
    filenameFromDisposition(response.headers.get("content-disposition")) ??
    filenameFromURL(url);

  const stream = response.body
    ? guardStream(
        response.body,
        maxBytes,
        options.streamTimeoutMs ?? RESOURCE_STREAM_TIMEOUT_MS,
      )
    : emptyStream();

  const opened: ProviderResourceStream = {
    status: response.status === 206 ? 206 : 200,
    stream,
    ...(contentType ? { contentType } : {}),
    ...(filename ? { filename } : {}),
    ...(declaredLength === undefined ? {} : { contentLength: declaredLength }),
    ...(contentRange ? { contentRange } : {}),
    ...(totalBytes === undefined ? {} : { totalBytes }),
  };
  return opened;
}

async function fetchResource(
  options: ReadProviderResourceOptions,
): Promise<{ response: Response; url: URL }> {
  let current = providerURL(options.url, options.baseUrl, options.providerLabel);
  let response: Response | undefined;
  const headers: Record<string, string> = {
    Accept: "*/*",
    ...options.headers,
  };
  if (options.range) headers.Range = options.range;

  for (let hop = 0; hop < 4; hop += 1) {
    try {
      response = await fetch(current, {
        headers,
        redirect: "manual",
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      throw new ProviderError(
        "provider_offline",
        `Unable to reach ${options.providerLabel} at ${options.baseUrl}`,
        { cause: error },
      );
    }

    if (!REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get("location");
    if (!location) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(
        "invalid_request",
        `${options.providerLabel} returned a redirect without a location`,
      );
    }
    await response.body?.cancel().catch(() => undefined);
    current = providerURL(
      new URL(location, current).toString(),
      options.baseUrl,
      options.providerLabel,
    );
    response = undefined;
  }

  if (!response) {
    throw new ProviderError(
      "invalid_request",
      `${options.providerLabel} attachment redirected too many times`,
    );
  }
  if (REDIRECT_STATUSES.has(response.status)) {
    throw new ProviderError(
      "invalid_request",
      `${options.providerLabel} attachment redirected too many times`,
    );
  }
  return { response, url: current };
}

function providerURL(value: string, baseUrl: string, providerLabel: string): URL {
  let target: URL;
  let base: URL;
  try {
    target = new URL(value);
    base = new URL(baseUrl);
  } catch {
    throw new ProviderError("invalid_request", "Invalid attachment URL");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new ProviderError("invalid_request", "Attachment URL must use HTTP or HTTPS");
  }
  if (target.username || target.password) {
    throw new ProviderError("invalid_request", "Attachment URL must not include credentials");
  }
  if (target.origin !== base.origin) {
    throw new ProviderError(
      "invalid_request",
      `Attachment URL is outside the ${providerLabel} origin`,
    );
  }
  return target;
}

/**
 * Enforce the cap on a body whose length the provider did not declare, and
 * drop a body that stalls. Either failure surfaces as a stream error, which
 * closes the client connection instead of buffering the overflow.
 */
function guardStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
  timeoutMs: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    timer = setTimeout(() => {
      timer = undefined;
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
    // A paused video must not keep the process alive on shutdown.
    (timer as { unref?: () => void }).unref?.();
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          stopTimer();
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          stopTimer();
          await reader.cancel().catch(() => undefined);
          controller.error(tooLarge(maxBytes));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        stopTimer();
        controller.error(error);
      }
    },
    async cancel(reason) {
      stopTimer();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function numberHeader(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** `bytes 0-1023/8192` → 8192; `bytes 0-1023/*` → undefined. */
export function totalFromContentRange(value: string | null | undefined): number | undefined {
  const match = value ? /\/(\d+)\s*$/.exec(value) : null;
  return match?.[1] ? Number(match[1]) : undefined;
}

function providerStatusError(providerLabel: string, status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError(
      "provider_auth_error",
      `${providerLabel} rejected the attachment credentials`,
      { status, retryable: false },
    );
  }
  if (status === 404) {
    return new ProviderError("not_found", `${providerLabel} attachment not found`, {
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new ProviderError(
      "rate_limited",
      `${providerLabel} rate limit reached`,
      { status },
    );
  }
  return new ProviderError(
    status >= 500 ? "internal" : "invalid_request",
    `${providerLabel} returned HTTP ${status} for the attachment`,
    { status },
  );
}

function tooLarge(maxBytes: number): ProviderError {
  const mb = maxBytes / (1024 * 1024);
  const label = mb >= 1 ? `${Math.round(mb)} MB` : `${maxBytes} bytes`;
  return new ProviderError(
    "invalid_request",
    `Attachment exceeds the ${label} limit`,
    { details: { maxBytes }, retryable: false },
  );
}

function filenameFromDisposition(value: string | null): string | undefined {
  if (!value) return undefined;
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(value);
  return match?.[1] ? safeFilename(decodeURIComponentSafe(match[1])) : undefined;
}

function filenameFromURL(value: URL): string | undefined {
  const segment = value.pathname.split("/").filter(Boolean).at(-1);
  return segment ? safeFilename(decodeURIComponentSafe(segment)) : undefined;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeFilename(value: string): string | undefined {
  const cleaned = value.replace(/[\\/\r\n\t]/g, "_").trim();
  return cleaned ? cleaned.slice(0, 180) : undefined;
}
