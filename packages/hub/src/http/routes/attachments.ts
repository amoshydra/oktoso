import type { Hono } from "hono";
import type { ProviderRegistry } from "../../services/provider-registry";
import type { AttachmentStore } from "../../services/attachment-store";
import type { AppEnv } from "../types";
import { badRequest, notFound, notImplemented } from "../../domain/errors";
import { resourceHeaders } from "../resource-response";

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

    return c.body(resource.body, 200, resourceHeaders(resource));
  });
}
