import type { Hono } from "hono";
import {
  zHandoffCreate,
  zHandoffDecision,
  zHandoffStatus,
  zHandoffUpdate,
} from "@amoshydra/oktoso-contracts";
import { badRequest, notFound } from "../../domain/errors";
import type { HandoffService } from "../../services/handoff-service";
import type { AppEnv } from "../types";

export function registerHandoffRoutes(
  app: Hono<AppEnv>,
  handoffs: HandoffService,
): void {
  app.get("/api/v1/handoffs", (c) => {
    const sourceRef = c.req.query("sourceRef")?.trim();
    const parsedStatus = zHandoffStatus.optional().safeParse(
      c.req.query("status") || undefined,
    );
    if (!parsedStatus.success) {
      throw badRequest("Invalid handoff status");
    }
    return c.json({
      data: handoffs.list({
        ...(sourceRef ? { sourceRef } : {}),
        ...(parsedStatus.data ? { status: parsedStatus.data } : {}),
      }),
    });
  });

  app.post("/api/v1/handoffs", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zHandoffCreate.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid handoff input", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await handoffs.propose(parsed.data) }, 201);
  });

  app.patch("/api/v1/handoffs/:id", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zHandoffUpdate.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid handoff update", {
        issues: parsed.error.issues,
      });
    }
    return c.json({
      data: await handoffs.update(c.req.param("id"), parsed.data.message),
    });
  });

  app.post("/api/v1/handoffs/:id/approve", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zHandoffDecision.safeParse(body ?? {});
    if (!parsed.success) {
      throw badRequest("Invalid handoff decision", {
        issues: parsed.error.issues,
      });
    }
    const handoff = await handoffs.approve(
      c.req.param("id"),
      parsed.data.message,
    );
    if (!handoff) throw notFound("Handoff not found");
    return c.json({ data: handoff });
  });

  app.post("/api/v1/handoffs/:id/cancel", async (c) => {
    return c.json({
      data: await handoffs.cancel(c.req.param("id")),
    });
  });
}
