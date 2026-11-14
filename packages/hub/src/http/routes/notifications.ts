import type { Hono } from "hono";
import {
  zNotificationSettingsInput,
  zPushSubscriptionInput,
} from "@amoshydra/oktoso-contracts";
import type { NotificationService } from "../../services/notification-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";

export function registerNotificationRoutes(
  app: Hono<AppEnv>,
  notifications: NotificationService,
): void {
  app.get("/api/v1/notifications", (c) =>
    c.json({ data: notifications.settings() }),
  );

  app.put("/api/v1/notifications", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zNotificationSettingsInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid notification settings", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await notifications.updateSettings(parsed.data) });
  });

  app.get("/api/v1/notifications/subscriptions", (c) =>
    c.json({ data: notifications.subscriptions() }),
  );

  app.post("/api/v1/notifications/subscriptions", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zPushSubscriptionInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid push subscription", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await notifications.addSubscription(parsed.data) }, 201);
  });

  app.delete("/api/v1/notifications/subscriptions/:id", async (c) => {
    const removed = await notifications.removeSubscription(c.req.param("id"));
    if (!removed) throw notFound("Push subscription not found");
    return c.body(null, 204);
  });

  app.get("/api/v1/notifications/deliveries", (c) => {
    const raw = Number(c.req.query("limit") ?? 50);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 200) : 50;
    return c.json({ data: notifications.deliveries(limit) });
  });

  app.post("/api/v1/notifications/test", async (c) =>
    c.json({ data: await notifications.test() }),
  );
}
