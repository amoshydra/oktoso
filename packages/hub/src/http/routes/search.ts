import type { Hono } from "hono";
import { zSearchQuery } from "@amoshydra/oktoso-contracts";
import { badRequest } from "../../domain/errors";
import type { SearchService } from "../../services/search-service";
import type { AppEnv } from "../types";

export function registerSearchRoutes(
  app: Hono<AppEnv>,
  search: SearchService,
): void {
  app.get("/api/v1/search", async (c) => {
    const parsed = zSearchQuery.safeParse({
      q: c.req.query("q") ?? "",
      ...(c.req.query("scope") ? { scope: c.req.query("scope") } : {}),
      ...(c.req.query("provider") ? { provider: c.req.query("provider") } : {}),
      ...(c.req.query("status") ? { status: c.req.query("status") } : {}),
      ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") } : {}),
      ...(c.req.query("limit") ? { limit: c.req.query("limit") } : {}),
    });
    if (!parsed.success) {
      throw badRequest("Invalid search query", { issues: parsed.error.issues });
    }
    return c.json(await search.search(parsed.data));
  });
}
