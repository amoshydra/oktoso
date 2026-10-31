import type { Hono } from "hono";
import type { Diagnostics } from "@amoshydra/oktoso-contracts";
import type { EventBus } from "../../services/event-bus";
import type { ProviderRegistry } from "../../services/provider-registry";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { AppEnv } from "../types";
import { VERSION } from "../../version";

export function registerDiagnosticsRoute(
  app: Hono<AppEnv>,
  deps: {
    startedAt: number;
    eventBus: EventBus;
    registry: ProviderRegistry;
    store: StateStore;
  },
): void {
  app.get("/api/v1/diagnostics", (c) => {
    const diagnostics: Diagnostics = {
      version: VERSION,
      node: process.version,
      uptimeMs: Math.max(0, Date.now() - deps.startedAt),
      startedAt: deps.startedAt,
      providers: deps.registry.diagnostics().map((provider) => ({
        id: provider.id,
        type: provider.type,
        status: provider.status,
        ...(provider.lastCheckedAt
          ? { lastCheckedAt: provider.lastCheckedAt }
          : {}),
        ...(provider.lastError ? { lastError: provider.lastError } : {}),
      })),
      events: {
        lastSeq: deps.eventBus.lastSeq,
        bufferSize: deps.eventBus.bufferLength,
        subscribers: deps.eventBus.subscriberCount,
      },
      storage: { kind: deps.store.kind },
    };
    return c.json(diagnostics);
  });
}
