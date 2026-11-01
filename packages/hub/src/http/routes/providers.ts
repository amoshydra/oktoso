import type { Hono } from "hono";
import { zProviderInput, zProviderUpdateInput } from "@amoshydra/oktoso-contracts";
import type { ProviderAdminService } from "../../services/provider-admin";
import type { ProviderRegistry } from "../../services/provider-registry";
import type { AppEnv } from "../types";
import { badRequest, notFound, notImplemented } from "../../domain/errors";

export function registerProviderRoutes(
  app: Hono<AppEnv>,
  registry: ProviderRegistry,
  admin?: ProviderAdminService,
): void {
  app.get("/api/v1/providers", (c) => c.json({ data: registry.list() }));

  app.post("/api/v1/providers", async (c) => {
    if (!admin) throw notImplemented("Provider management is not configured");
    const body = await c.req.json().catch(() => undefined);
    const parsed = zProviderInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid provider input", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await admin.add(parsed.data) }, 201);
  });

  app.put("/api/v1/providers/:providerID", async (c) => {
    if (!admin) throw notImplemented("Provider management is not configured");
    const providerID = c.req.param("providerID");
    if (!providerID) throw notFound("Provider not found");
    const body = await c.req.json().catch(() => undefined);
    const parsed = zProviderUpdateInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid provider input", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await admin.update(providerID, parsed.data) });
  });

  app.post("/api/v1/providers/:providerID/check", async (c) => {
    const providerID = c.req.param("providerID");
    if (!registry.get(providerID)) throw notFound("Provider not found");
    return c.json(await registry.check(providerID));
  });
}
