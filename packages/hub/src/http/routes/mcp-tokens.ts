import type { Context, Hono } from "hono";
import { z } from "zod";
import { AppError, badRequest, notFound } from "../../domain/errors";
import type { McpTokenService } from "../../mcp/tokens";
import type { AppEnv } from "../types";

const zCreateMcpToken = z.object({
  ttlSeconds: z.number().int().min(60).max(3_600).optional(),
  providers: z.array(z.string().min(1)).max(20).optional(),
  tools: z.array(z.string().min(1)).max(50).optional(),
  sessionRef: z.string().min(1).optional(),
  allowWrite: z.boolean().default(false),
  maxSessions: z.number().int().min(1).max(5).optional(),
});

function requireOwner(c: Context<AppEnv>): void {
  if (c.get("auth")?.kind !== "owner") {
    throw new AppError(
      "forbidden",
      "Only the hub owner can manage MCP tokens",
      403,
    );
  }
}

/**
 * Short-lived MCP credentials issued by the owner.
 *
 * The create and reveal responses are the only places the plaintext appears;
 * lists expose metadata only. The assistant uses the same service directly.
 */
export function registerMcpTokenRoutes(
  app: Hono<AppEnv>,
  tokens: McpTokenService,
): void {
  app.post("/api/v1/mcp/tokens", async (c) => {
    requireOwner(c);
    const body = await c.req.json().catch(() => undefined);
    const parsed = zCreateMcpToken.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid MCP token input", {
        issues: parsed.error.issues,
      });
    }
    const issued = tokens.issue(parsed.data);
    c.header("Cache-Control", "no-store");
    return c.json({ data: issued }, 201);
  });

  app.get("/api/v1/mcp/tokens", (c) => {
    requireOwner(c);
    c.header("Cache-Control", "no-store");
    return c.json({ data: tokens.list() });
  });

  app.post("/api/v1/mcp/tokens/:id/reveal", (c) => {
    requireOwner(c);
    const issued = tokens.reveal(c.req.param("id"));
    if (!issued) {
      throw notFound("MCP token not found or expired");
    }
    c.header("Cache-Control", "no-store");
    return c.json({ data: issued });
  });

  app.delete("/api/v1/mcp/tokens/:id", (c) => {
    requireOwner(c);
    if (!tokens.revoke(c.req.param("id"))) {
      throw notFound("MCP token not found");
    }
    return c.body(null, 204);
  });
}
