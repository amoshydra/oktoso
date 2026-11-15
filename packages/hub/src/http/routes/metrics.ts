import type { Hono } from "hono";
import { AppError } from "../../domain/errors";
import { renderMetrics, type MetricsSources } from "../../services/metrics";
import type { AppEnv } from "../types";

export function registerMetricsRoutes(
  app: Hono<AppEnv>,
  sources: MetricsSources,
): void {
  app.get("/metrics", (c) => {
    // Provider names and counts are owner business; a paired browser speaks for
    // the owner but should not scrape operational data.
    if (c.get("auth")?.kind !== "owner") {
      throw new AppError("forbidden", "Metrics require the owner token", 403);
    }
    return c.body(renderMetrics(sources), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
  });
}
