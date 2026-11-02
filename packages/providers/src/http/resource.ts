import { ProviderError } from "../errors";
import type { ProviderResource } from "../types";

export const MAX_RESOURCE_BYTES = 20 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface ReadProviderResourceOptions {
  url: string;
  baseUrl: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  providerLabel: string;
  maxBytes?: number;
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
  let current = providerURL(options.url, options.baseUrl, options.providerLabel);
  let response: Response | undefined;

  for (let hop = 0; hop < 4; hop += 1) {
    try {
      response = await fetch(current, {
        headers: { Accept: "*/*", ...options.headers },
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
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw providerStatusError(options.providerLabel, response.status);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(maxBytes);
  }

  const body = await readLimitedBody(response, maxBytes);
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const filename =
    filenameFromDisposition(response.headers.get("content-disposition")) ??
    filenameFromURL(current);

  return {
    body,
    ...(contentType ? { contentType } : {}),
    ...(filename ? { filename } : {}),
  };
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

async function readLimitedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw tooLarge(maxBytes);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
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
    return new ProviderError("rate_limited", `${providerLabel} rate limit reached`, {
      status,
    });
  }
  return new ProviderError(
    status >= 500 ? "internal" : "invalid_request",
    `${providerLabel} returned HTTP ${status} for the attachment`,
    { status },
  );
}

function tooLarge(maxBytes: number): ProviderError {
  return new ProviderError(
    "invalid_request",
    `Attachment exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
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
