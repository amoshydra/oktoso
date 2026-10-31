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
import type { QuestionService } from "./services/question-service";
import { IdempotencyService } from "./services/idempotency";
import type { StateStore } from "@amoshydra/oktoso-storage";
import { ProviderError } from "@amoshydra/oktoso-providers";
import type { Logger } from "./lib/logger";
import { VERSION } from "./version";
import type { AppEnv } from "./http/types";
import { AppError } from "./domain/errors";
import { AuthService } from "./auth/service";
import { bearerAuth } from "./http/middleware/auth";
import { requestContext } from "./http/middleware/request";
import { requestLimits, securityHeaders } from "./http/middleware/security";
import { registerHealthRoutes } from "./http/routes/health";
import { registerAuthRoutes } from "./http/routes/auth";
import { registerPairRoutes } from "./http/routes/pair";
import { registerProviderRoutes } from "./http/routes/providers";
import { registerSessionRoutes } from "./http/routes/sessions";
import { registerQuestionRoutes } from "./http/routes/questions";
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
  questions: QuestionService;
  logger: Logger;
  startedAt?: number;
  webRoot?: string;
  appsRoot?: string;
  auth?: AuthService;
}

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const startedAt = deps.startedAt ?? Date.now();
  const auth = deps.auth ?? new AuthService(deps.config.token);
  const app = new Hono<AppEnv>();

  app.use("*", requestContext(deps.logger));
  app.use("*", securityHeaders());
  app.use("/api/v1/*", requestLimits());

  if (deps.config.cors.length > 0) {
    const wildcard = deps.config.cors.includes("*");
    if (wildcard) {
      deps.logger.warn("CORS allows every origin; use this only for local testing");
    }
    app.use(
      "*",
      cors({
        origin: wildcard ? "*" : deps.config.cors,
        credentials: !wildcard,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
        exposeHeaders: ["X-Request-Id"],
        maxAge: 600,
      }),
    );
  }

  app.use("/api/v1/*", bearerAuth(auth));

  registerHealthRoutes(app, {
    startedAt,
    eventSeq: () => deps.eventBus.lastSeq,
  });
  registerAuthRoutes(app, { auth, version: VERSION });
  registerPairRoutes(app, { auth });
  registerProviderRoutes(app, deps.registry);
  registerSessionRoutes(
    app,
    deps.sessions,
    deps.replies,
    deps.questions,
    new IdempotencyService(deps.store),
  );
  registerQuestionRoutes(app, deps.questions, deps.attention);
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

  if (deps.appsRoot) {
    const appsRoot = resolve(deps.appsRoot);
    app.get("/apps/:app", (c) =>
      c.redirect(`/apps/${encodeURIComponent(c.req.param("app"))}/`, 308),
    );
    app.use(
      "/apps/*",
      serveStatic({
        root: appsRoot,
        rewriteRequestPath: (path) => path.replace(/^\/apps/, ""),
      }),
    );
    app.get("/apps/:app/*", async (c, next) => {
      const appID = c.req.param("app");
      if (!/^[a-z0-9][a-z0-9-]*$/.test(appID)) return next();
      const leaf = c.req.path.slice(c.req.path.lastIndexOf("/") + 1);
      if (leaf.includes(".")) return next();
      const indexPath = join(appsRoot, appID, "index.html");
      if (!existsSync(indexPath)) return next();
      return c.html(await readFile(indexPath, "utf8"));
    });
    app.all("/apps/*", (c) => c.notFound());
  }

  if (deps.webRoot) {
    const root = resolve(deps.webRoot);
    const indexPath = join(root, "index.html");
    if (existsSync(indexPath)) {
      app.use("*", serveStatic({ root }));
      app.get("*", async (c, next) => {
        if (
          c.req.path.startsWith("/api/") ||
          c.req.path.startsWith("/apps/")
        ) {
          return next();
        }
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
