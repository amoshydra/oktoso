import type { Hono } from "hono";
import {
  zAutomationApprovalAction,
  zAutomationSettingsInput,
} from "@amoshydra/oktoso-contracts";
import type { AutomationService } from "../../services/automation-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

export function registerAutomationRoutes(
  app: Hono<AppEnv>,
  automation: AutomationService,
): void {
  app.get("/api/v1/automation", (c) =>
    c.json({ data: automation.view() }),
  );

  app.put("/api/v1/automation", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAutomationSettingsInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid automation settings", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await automation.updateSettings(parsed.data) });
  });

  app.post("/api/v1/automation/watchers/:id/pause", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAutomationSettingsInput
      .pick({ paused: true })
      .safeParse(body);
    if (!parsed.success || parsed.data.paused === undefined) {
      throw badRequest("paused must be a boolean");
    }
    return c.json({
      data: await automation.setWatcherPaused(
        c.req.param("id"),
        parsed.data.paused,
      ),
    });
  });

  app.post("/api/v1/automation/templates/:id/start", async (c) => {
    const session = await automation.startTemplate(c.req.param("id"));
    return c.json(session, 201);
  });

  app.get("/api/v1/automation/runs", (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    return c.json({ data: automation.runs(limit) });
  });

  app.get("/api/v1/automation/approvals", (c) =>
    c.json({ data: automation.approvals() }),
  );

  app.delete("/api/v1/automation/shapes/:id", async (c) => {
    const removed = await automation.revokeShape(c.req.param("id"));
    if (!removed) throw notFound("Allowed shape not found");
    return c.body(null, 204);
  });

  app.post("/api/v1/automation/approvals/:id/:action", async (c) => {
    const action = zAutomationApprovalAction.safeParse(
      c.req.param("action"),
    );
    if (!action.success) {
      throw badRequest("Action must be approve or deny");
    }
    await automation.actOnApproval(c.req.param("id"), action.data);
    return c.body(null, 204);
  });
}
