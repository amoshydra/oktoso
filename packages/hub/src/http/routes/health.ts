import type { Hono } from "hono";
import type { Health } from "@amoshydra/oktoso-contracts";
import type { AppEnv } from "../types";
import { VERSION } from "../../version";

export function registerHealthRoutes(
  app: Hono<AppEnv>,
  deps: { startedAt: number; eventSeq: () => number },
): void {
  app.get("/api/v1/health", (c) => {
    const health: Health = {
      ok: true,
      version: VERSION,
      pid: process.pid,
      uptimeMs: Math.max(0, Date.now() - deps.startedAt),
      startedAt: deps.startedAt,
      eventSeq: deps.eventSeq(),
    };
    return c.json(health);
  });
}
