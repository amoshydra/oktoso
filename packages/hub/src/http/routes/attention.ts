import type { Hono } from "hono";
import { zAttentionActionInput, zAttentionType } from "@agent-hub/contracts";
import type { AttentionService } from "../../services/attention-service";
import type { AppEnv } from "../types";
import { badRequest } from "../../domain/errors";

export function registerAttentionRoutes(
  app: Hono<AppEnv>,
  attention: AttentionService,
): void {
  app.get("/api/v1/attention", async (c) => {
    const type = c.req.query("type");
    if (type && !zAttentionType.safeParse(type).success) {
      throw badRequest("Invalid attention type");
    }
    return c.json(
      await attention.list({
        ...(type ? { type: type as import("@agent-hub/contracts").AttentionType } : {}),
        ...(c.req.query("sessionRef")
          ? { sessionRef: c.req.query("sessionRef") }
          : {}),
      }),
    );
  });

  app.post("/api/v1/attention/:attentionID/actions/:action", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = zAttentionActionInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid attention action input", {
        issues: parsed.error.issues,
      });
    }
    await attention.act(
      c.req.param("attentionID"),
      c.req.param("action"),
      parsed.data,
    );
    return c.body(null, 204);
  });
}
