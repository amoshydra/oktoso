import type { Hono } from "hono";
import type { ProviderRegistry } from "../../services/provider-registry";
import type { AttachmentStore } from "../../services/attachment-store";
import type { AppEnv } from "../types";
import { badRequest, notFound, notImplemented } from "../../domain/errors";

const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

const DOWNLOAD_TYPES = new Set([
  ...INLINE_IMAGE_TYPES,
  "application/pdf",
  "application/zip",
  "application/json",
  "application/octet-stream",
  "text/plain",
  "text/markdown",
]);

const MAX_URL_LENGTH = 4096;

export function registerAttachmentRoutes(
  app: Hono<AppEnv>,
  registry: ProviderRegistry,
  store: AttachmentStore,
): void {
  app.post("/api/v1/attachments", async (c) => {
    const body = await c.req.parseBody().catch(() => undefined);
    if (!body) throw badRequest("A multipart file body is required");
    const file = body.file;
    if (!(file instanceof File)) {
      throw badRequest("A file is required");
    }
    if (file.size === 0) {
      throw badRequest("The attachment is empty");
    }
    const attachment = await store.stage({
      name: file.name || "Attachment",
      mimeType: file.type || "application/octet-stream",
      data: new Uint8Array(await file.arrayBuffer()),
    });
    return c.json({ data: attachment }, 201);
  });

  app.delete("/api/v1/attachments/:id", async (c) => {
    await store.remove(c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/api/v1/attachments", async (c) => {
    const providerID = c.req.query("provider");
    const url = c.req.query("url");
    if (!providerID || !url) {
      throw badRequest("provider and url are required");
    }
    if (url.length > MAX_URL_LENGTH) {
      throw badRequest("Attachment URL is too long");
    }

    const adapter = registry.adapter(providerID);
    if (!adapter) throw notFound("Provider not found");
    if (!adapter.readResource) {
      throw notImplemented("This provider does not expose attachments");
    }

    const resource = await adapter.readResource(
      url,
      AbortSignal.timeout(20_000),
    );
    const contentType = safeContentType(resource.contentType);
    const inline = INLINE_IMAGE_TYPES.has(contentType);
    const filename = safeFilename(resource.filename);

    return c.body(resource.body, 200, {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `${inline ? "inline" : "attachment"}${filename ? `; filename="${filename}"` : ""}`,
      "Content-Length": String(resource.body.byteLength),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
  });
}

function safeContentType(value: string | undefined): string {
  if (value && DOWNLOAD_TYPES.has(value)) return value;
  return "application/octet-stream";
}

function safeFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || undefined;
}
