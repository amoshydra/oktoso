import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { JsonStateStore } from "@agent-hub/storage";
import { createLogger, type LogLevel } from "./lib/logger";
import { loadConfig } from "./config/load";
import { EventBus } from "./services/event-bus";
import { ProviderRegistry } from "./services/provider-registry";
import { createApp } from "./app";
import { VERSION } from "./version";

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const configPath =
  readArgument("--config") ?? process.env.HUB_CONFIG ?? "./hub.config.json";
const logLevel = (process.env.LOG_LEVEL ?? "info") as LogLevel;
const logger = createLogger({ level: logLevel });
const startedAt = Date.now();

try {
  const config = await loadConfig(configPath);
  const stateFile = join(resolve(config.dataDir), "state.json");
  const store = await JsonStateStore.open({ filePath: stateFile });
  const eventBus = new EventBus(store, logger);
  await eventBus.init();
  const registry = new ProviderRegistry(config.providers, logger);

  const configuredWebRoot = config.webRoot
    ? resolve(config.webRoot)
    : existsSync(resolve("dist/web"))
      ? resolve("dist/web")
      : undefined;

  const app = createApp({
    config,
    store,
    eventBus,
    registry,
    logger,
    startedAt,
    webRoot: configuredWebRoot,
  });

  const server = serve(
    {
      fetch: app.fetch,
      hostname: config.host,
      port: config.port,
    },
    (info) => {
      logger.info("hub listening", {
        version: VERSION,
        host: info.address,
        port: info.port,
        providers: config.providers.length,
        dataDir: resolve(config.dataDir),
        webRoot: configuredWebRoot ?? null,
      });
    },
  );

  // Health checks are best-effort startup information. The web client can
  // re-check on demand and the provider adapters take over in Phase 1.
  void registry.checkAll().catch((error) => {
    logger.warn("initial provider checks failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutting down", { signal });
    server.close();
    await store.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
} catch (error) {
  logger.error("hub failed to start", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
