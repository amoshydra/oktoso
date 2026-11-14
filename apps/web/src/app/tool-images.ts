export interface ToolImage {
  url: string;
  name: string;
  mimeType?: string;
}

const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i;
const MAX_IMAGES = 6;

/**
 * Tool results from image-aware tools arrive as content arrays, for example:
 *
 *   [
 *     { type: "text", text: "Image read successfully" },
 *     { type: "file", uri: "data:image/jpeg;base64,..." }
 *   ]
 *
 * or as provider-specific `source.base64` / `image_url` objects. Collect the
 * renderable images without treating arbitrary strings as images.
 */
export function collectToolImages(output: unknown): ToolImage[] {
  const images: ToolImage[] = [];
  const seen = new Set<string>();

  const add = (url: string | undefined, name?: string, mimeType?: string) => {
    if (!url || seen.has(url) || images.length >= MAX_IMAGES) return;
    const image =
      url.startsWith("data:image/") ||
      Boolean(mimeType?.startsWith("image/")) ||
      IMAGE_EXTENSION.test(url);
    if (!image) return;
    seen.add(url);
    images.push({
      url,
      name: name?.trim() || `Image ${images.length + 1}`,
      ...(mimeType ? { mimeType } : {}),
    });
  };

  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || images.length >= MAX_IMAGES) return;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const mimeType =
      typeof record.mimeType === "string"
        ? record.mimeType
        : typeof record.mime === "string"
          ? record.mime
          : typeof record.media_type === "string"
            ? record.media_type
            : undefined;
    const name =
      typeof record.name === "string"
        ? record.name
        : typeof record.filename === "string"
          ? record.filename
          : typeof record.title === "string"
            ? record.title
            : undefined;
    const url =
      typeof record.url === "string"
        ? record.url
        : typeof record.uri === "string"
          ? record.uri
          : undefined;
    if (url) add(url, name, mimeType);

    const source = record.source;
    if (source && typeof source === "object") {
      const nested = source as Record<string, unknown>;
      if (
        nested.type === "base64" &&
        typeof nested.data === "string" &&
        typeof nested.media_type === "string"
      ) {
        add(
          `data:${nested.media_type};base64,${nested.data}`,
          name,
          nested.media_type,
        );
      }
      if (nested.type === "url" && typeof nested.url === "string") {
        add(nested.url, name, mimeType);
      }
    }

    const imageUrl = record.image_url;
    if (imageUrl && typeof imageUrl === "object") {
      const nested = imageUrl as Record<string, unknown>;
      if (typeof nested.url === "string") add(nested.url, name, mimeType);
    }

    for (const key of ["content", "output", "parts"]) {
      if (record[key] !== undefined) visit(record[key], depth + 1);
    }
  };

  visit(output, 0);
  return images;
}

/**
 * Keep tool input/output readable in the transcript: a base64 image would
 * otherwise dump megabytes of text into the expanded tool row.
 */
export function sanitizeToolOutput(output: unknown, depth = 0): unknown {  if (depth > 8) return "[…]";
  if (typeof output === "string") {
    return output.startsWith("data:image/") ? "[image]" : output;
  }
  if (Array.isArray(output)) {
    return output.map((item) => sanitizeToolOutput(item, depth + 1));
  }
  if (!output || typeof output !== "object") return output;

  const record = output as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (
      key === "data" &&
      typeof value === "string" &&
      (record.type === "base64" ||
        (typeof record.media_type === "string" &&
          record.media_type.startsWith("image/")))
    ) {
      result[key] = "[image]";
      continue;
    }
    result[key] = sanitizeToolOutput(value, depth + 1);
  }
  return result;
}

/**
 * Return a plain-text tool result when every part is text.
 *
 * Providers wrap a simple confirmation in a content array
 * (`[{ type: "text", text: "..." }]`). Rendering that as JSON adds noise, so the
 * transcript shows the sentence instead. Mixed or structured results fall back
 * to JSON.
 */
export function toolOutputText(output: unknown): string | undefined {
  if (typeof output === "string") return output.trim() || undefined;
  if (Array.isArray(output)) {
    const texts: string[] = [];
    for (const item of output) {
      const text = toolOutputText(item);
      if (!text) return undefined;
      texts.push(text);
    }
    return texts.length > 0 ? texts.join("\n") : undefined;
  }
  if (!output || typeof output !== "object") return undefined;

  const record = output as Record<string, unknown>;
  if (typeof record.type === "string" && record.type !== "text") {
    return undefined;
  }
  if (typeof record.text === "string" && record.text.trim()) {
    return record.text.trim();
  }
  return undefined;
}
