import type { Hono } from "hono";
import { zLocalDataStore, zLocalRetentionInput } from "@amoshydra/oktoso-contracts";
import { badRequest } from "../../domain/errors";
import type { LocalDataService } from "../../services/local-data";
import type { AppEnv } from "../types";

export function registerLocalDataRoutes(
  app: Hono<AppEnv>,
  localData: LocalDataService,
): void {
  app.get("/api/v1/settings/local-data", async (c) =>
    c.json({ data: await localData.view() }),
  );

  app.put("/api/v1/settings/local-data", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zLocalRetentionInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid retention settings", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await localData.updateRetention(parsed.data) });
  });

  app.delete("/api/v1/settings/local-data", async (c) =>
    c.json({ data: await localData.clearAll() }),
  );

  app.delete("/api/v1/settings/local-data/:store", async (c) => {
    const store = zLocalDataStore.safeParse(c.req.param("store"));
    if (!store.success) {
      throw badRequest("Unknown local data store");
    }
    return c.json({ data: await localData.clear(store.data) });
  });
}
