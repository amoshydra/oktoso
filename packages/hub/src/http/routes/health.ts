import type { Hono } from "hono";
import type { Health } from "@agent-hub/contracts";
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
      uptimeMs: Math.max(0, Date.now() - deps.startedAt),
      startedAt: deps.startedAt,
      eventSeq: deps.eventSeq(),
    };
    return c.json(health);
  });

  app.get("/api/v1/auth/check", (c) =>
    c.json({ ok: true, version: VERSION }),
  );
}
