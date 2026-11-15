import type { Hono } from "hono";
import { renderMetrics, type MetricsSources } from "../../services/metrics";
import type { AppEnv } from "../types";

export function registerMetricsRoutes(
  app: Hono<AppEnv>,
  sources: MetricsSources,
): void {
  app.get("/metrics", (c) =>
    c.body(renderMetrics(sources), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  );
}
