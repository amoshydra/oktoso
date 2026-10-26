import type { Hono } from "hono";
import type { ProviderRegistry } from "../../services/provider-registry";
import type { AppEnv } from "../types";
import { notFound, notImplemented } from "../../domain/errors";

export function registerProviderRoutes(
  app: Hono<AppEnv>,
  registry: ProviderRegistry,
): void {
  app.get("/api/v1/providers", (c) => c.json({ data: registry.list() }));

  app.post("/api/v1/providers/:providerID/check", async (c) => {
    const providerID = c.req.param("providerID");
    if (!registry.get(providerID)) throw notFound("Provider not found");
    return c.json(await registry.check(providerID));
  });

  app.get("/api/v1/providers/:providerID/options", (c) => {
    const providerID = c.req.param("providerID");
    if (!registry.get(providerID)) throw notFound("Provider not found");
    throw notImplemented("Provider options are not implemented until the provider adapter lands");
  });
}
