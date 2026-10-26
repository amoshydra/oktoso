import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HubConfig } from "./config/schema";
import type { EventBus } from "./services/event-bus";
import type { ProviderRegistry } from "./services/provider-registry";
import type { SessionService } from "./services/session-service";
import type { AttentionService } from "./services/attention-service";
import type { DraftService } from "./services/draft-service";
import type { AssistantSettingsService } from "./services/assistant-settings";
import type { ReplyService } from "./services/reply-service";
import type { StateStore } from "@agent-hub/storage";
import { ProviderError } from "@agent-hub/providers";
import type { Logger } from "./lib/logger";
import type { AppEnv } from "./http/types";
import { AppError } from "./domain/errors";
import { bearerAuth } from "./http/middleware/auth";
import { requestContext } from "./http/middleware/request";
import { requestLimits, securityHeaders } from "./http/middleware/security";
import { registerHealthRoutes } from "./http/routes/health";
import { registerProviderRoutes } from "./http/routes/providers";
import { registerSessionRoutes } from "./http/routes/sessions";
import { registerDraftRoutes } from "./http/routes/drafts";
import { registerSettingsRoutes } from "./http/routes/settings";
import { registerAttentionRoutes } from "./http/routes/attention";
import { registerEventRoutes } from "./http/routes/events";
import { registerDiagnosticsRoute } from "./http/routes/diagnostics";

export interface AppDependencies {
  config: HubConfig;
  store: StateStore;
  eventBus: EventBus;
  registry: ProviderRegistry;
  sessions: SessionService;
  attention: AttentionService;
  drafts: DraftService;
  settings: AssistantSettingsService;
  replies: ReplyService;
  logger: Logger;
  startedAt?: number;
  webRoot?: string;
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const startedAt = deps.startedAt ?? Date.now();
  const app = new Hono<AppEnv>();

  app.use("*", requestContext(deps.logger));
  app.use("*", securityHeaders());
  app.use("/api/v1/*", requestLimits());

  if (deps.config.cors.length > 0) {
    app.use(
      "*",
      cors({
        origin: deps.config.cors,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        exposeHeaders: ["X-Request-Id"],
        maxAge: 600,
      }),
    );
  }

  app.use("/api/v1/*", bearerAuth(deps.config.token));

  registerHealthRoutes(app, {
    startedAt,
    eventSeq: () => deps.eventBus.lastSeq,
  });
  registerProviderRoutes(app, deps.registry);
  registerSessionRoutes(app, deps.sessions, deps.replies);
  registerDraftRoutes(app, deps.drafts);
  registerSettingsRoutes(app, deps.settings);
  registerAttentionRoutes(app, deps.attention);
  registerEventRoutes(app, deps.eventBus);
  registerDiagnosticsRoute(app, {
    startedAt,
    eventBus: deps.eventBus,
    registry: deps.registry,
    store: deps.store,
  });

  if (deps.webRoot) {
    const root = resolve(deps.webRoot);
    const indexPath = join(root, "index.html");
    if (existsSync(indexPath)) {
      app.use("*", serveStatic({ root }));
      app.get("*", async (c, next) => {
        if (c.req.path.startsWith("/api/")) return next();
        const html = await readFile(indexPath, "utf8");
        return c.html(html);
      });
    }
  }

  app.notFound((c) => {
    const requestId = c.get("requestId");
    return c.json(
      {
        error: {
          code: "not_found",
          message: "Not found",
          retryable: false,
          ...(requestId ? { requestId } : {}),
        },
      },
      404,
    );
  });

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    const logger = c.get("logger") ?? deps.logger;
    const appError =
      error instanceof AppError
        ? error
        : error instanceof ProviderError
          ? providerAppError(error)
          : new AppError("internal", "Internal server error", 500);

    logger.error("request failed", {
      code: appError.code,
      status: appError.status,
      error: error.message,
    });
    if (requestId) c.header("X-Request-Id", requestId);

    return c.json(
      {
        error: {
          code: appError.code,
          message: appError.message,
          retryable: appError.retryable,
          ...(requestId ? { requestId } : {}),
          ...(appError.details ? { details: appError.details } : {}),
        },
      },
      appError.status as ContentfulStatusCode,
    );
  });

  return app;
}

function providerAppError(error: ProviderError): AppError {
  const status =
    error.code === "not_found"
      ? 404
      : error.code === "conflict"
        ? 409
        : error.code === "rate_limited"
          ? 429
          : error.code === "invalid_request"
            ? 400
            : error.code === "unsupported"
              ? 501
              : 502;
  return new AppError(error.code, error.message, status, {
    retryable: error.retryable,
    details: error.details,
  });
}
