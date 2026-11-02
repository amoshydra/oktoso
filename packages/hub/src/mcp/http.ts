import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import type { Hono } from "hono";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { HubConfig, McpTokenConfig } from "../config/schema";
import type { AppEnv } from "../http/types";
import type { Logger } from "../lib/logger";
import { createMcpAudit, type McpAudit } from "./audit";
import { withProviderPolicy } from "./policy";
import { FixedWindowRateLimiter } from "./rate-limit";
import {
  createOktosoMcpServer,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  type McpHubApi,
} from "./server";

const MCP_PATH = "/mcp";
const SESSION_HEADER = "mcp-session-id";
const MAX_SESSIONS_PER_CLIENT = 5;
const MAX_MCP_BODY_BYTES = 1024 * 1024;

interface AuthenticatedClient {
  client: McpTokenConfig;
  digest: Buffer;
}

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  clientId: string;
  lastSeenAt: number;
}

export interface McpRouteDependencies {
  config: HubConfig;
  api: McpHubApi;
  logger: Logger;
  version: string;
}

export interface McpRouteHandle {
  close(): Promise<void>;
  sessionCount(): number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authenticate(
  header: string,
  clients: AuthenticatedClient[],
): AuthenticatedClient | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return undefined;
  const presented = digest(match[1]!.trim());
  for (const candidate of clients) {
    if (
      presented.length === candidate.digest.length &&
      timingSafeEqual(presented, candidate.digest)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function requestOriginAllowed(
  requestUrl: string,
  origin: string | undefined,
  cors: string[],
): boolean {
  if (!origin) return true;
  if (cors.includes("*") || cors.includes(origin)) return true;
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

class BodyTooLargeError extends Error {}

async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const body = request.body;
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Host a stateful MCP Streamable HTTP endpoint at `/mcp`. Each bearer token is
 * a client identity with its own write scope, provider allowlist, tool
 * allowlist, timeout, and rate limit. Sessions are in-memory and expire after
 * the configured idle TTL.
 */
export function registerMcpRoutes(
  app: Hono<AppEnv>,
  deps: McpRouteDependencies,
): McpRouteHandle | undefined {
  const { config, logger } = deps;
  const mcp = config.mcp;
  if (!mcp.enabled) {
    app.all(MCP_PATH, (c) => c.notFound());
    return undefined;
  }
  if (mcp.tokens.length === 0) {
    logger.warn("MCP is enabled but no tokens are configured");
    app.all(MCP_PATH, (c) => c.notFound());
    return undefined;
  }

  const knownTools = new Set<string>(MCP_TOOL_NAMES);
  const writeTools = new Set<string>(MCP_WRITE_TOOL_NAMES);
  const clients: AuthenticatedClient[] = mcp.tokens.map((client) => {
    for (const tool of client.tools ?? []) {
      if (!knownTools.has(tool)) {
        logger.warn("MCP token lists an unknown tool", {
          clientId: client.id,
          tool,
        });
      } else if (!client.allowWrite && writeTools.has(tool)) {
        logger.warn("MCP write tool will be hidden without allowWrite", {
          clientId: client.id,
          tool,
        });
      }
    }
    return { client, digest: digest(client.token) };
  });

  const audit: McpAudit = mcp.audit.enabled
    ? createMcpAudit({
        logger,
        file: resolve(
          mcp.audit.file ?? resolve(config.dataDir, "mcp-audit.jsonl"),
        ),
      })
    : { record: () => undefined, flush: async () => undefined };

  const sessions = new Map<string, McpSession>();
  const limiter = new FixedWindowRateLimiter();

  function sweep(now: number): void {
    for (const [id, session] of sessions) {
      if (now - session.lastSeenAt <= mcp.sessionTtlMs) continue;
      sessions.delete(id);
      void session.server.close().catch(() => undefined);
    }
  }

  async function makeRoom(clientId: string): Promise<void> {
    const now = Date.now();
    const own = [...sessions.entries()]
      .filter(([, session]) => session.clientId === clientId)
      .sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    while (own.length >= MAX_SESSIONS_PER_CLIENT) {
      const [id, session] = own.shift()!;
      sessions.delete(id);
      await session.server.close().catch(() => undefined);
    }
    if (sessions.size >= mcp.maxSessions) {
      const oldest = [...sessions.entries()].sort(
        (a, b) => a[1].lastSeenAt - b[1].lastSeenAt,
      )[0];
      if (oldest) {
        sessions.delete(oldest[0]);
        await oldest[1].server.close().catch(() => undefined);
      }
    }
    sweep(now);
  }

  app.all(MCP_PATH, async (c) => {
    if (!requestOriginAllowed(c.req.url, c.req.header("origin"), config.cors)) {
      return c.json(
        {
          error: {
            code: "forbidden",
            message: "Origin is not allowed",
            retryable: false,
          },
        },
        403,
      );
    }

    const authenticated = authenticate(
      c.req.header("authorization") ?? "",
      clients,
    );
    if (!authenticated) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json(
        {
          error: {
            code: "unauthorized",
            message: "Unauthorized",
            retryable: false,
          },
        },
        401,
      );
    }

    const { client } = authenticated;
    const limit = limiter.consume(client.id, client.rateLimit);
    if (!limit.allowed) {
      c.header("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
      return c.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many MCP requests",
            retryable: true,
          },
        },
        429,
      );
    }

    const method = c.req.method.toUpperCase();
    if (!["GET", "POST", "DELETE"].includes(method)) {
      c.header("Allow", "GET, POST, DELETE");
      return c.json(
        {
          error: {
            code: "method_not_allowed",
            message: "Method not allowed",
            retryable: false,
          },
        },
        405,
      );
    }

    const now = Date.now();
    sweep(now);
    const sessionId = c.req.header(SESSION_HEADER);

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.clientId !== client.id) {
        return c.json(
          {
            error: {
              code: "session_not_found",
              message: "MCP session not found",
              retryable: false,
            },
          },
          404,
        );
      }
      session.lastSeenAt = now;
      return session.transport.handleRequest(c.req.raw);
    }

    if (method !== "POST") {
      return c.json(
        {
          error: {
            code: "session_required",
            message: "Mcp-Session-Id is required",
            retryable: false,
          },
        },
        400,
      );
    }

    let body: unknown;
    try {
      body = await readJsonBody(c.req.raw, MAX_MCP_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return c.json(
          {
            error: {
              code: "payload_too_large",
              message: "MCP request body is too large",
              retryable: false,
            },
          },
          413,
        );
      }
      return c.json(
        {
          error: {
            code: "invalid_json",
            message: "MCP request body must be JSON",
            retryable: false,
          },
        },
        400,
      );
    }
    if (!isInitializeRequest(body)) {
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "An initialize request or a session ID is required",
            retryable: false,
          },
        },
        400,
      );
    }

    await makeRoom(client.id);

    let session: McpSession | undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
      onsessioninitialized: (id) => {
        if (!session) return;
        session.lastSeenAt = Date.now();
        sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });
    transport.onerror = (error) => {
      logger.error("MCP transport error", {
        clientId: client.id,
        error: error.message,
      });
    };
    const server = createOktosoMcpServer({
      api: withProviderPolicy(deps.api, client.providers),
      version: deps.version,
      allowWrite: client.allowWrite,
      ...(client.tools ? { tools: client.tools } : {}),
      timeoutMs: client.timeoutMs,
      onCall: (record) => audit.record(client.id, record),
    });
    session = {
      transport,
      server,
      clientId: client.id,
      lastSeenAt: now,
    };
    await server.connect(transport);
    logger.debug("MCP session opened", { clientId: client.id });
    try {
      return await transport.handleRequest(c.req.raw, { parsedBody: body });
    } catch (error) {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      await server.close().catch(() => undefined);
      throw error;
    }
  });

  return {
    async close() {
      for (const session of sessions.values()) {
        await session.server.close().catch(() => undefined);
      }
      sessions.clear();
      await audit.flush();
    },
    sessionCount: () => sessions.size,
  };
}
