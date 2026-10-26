import type { Hono } from "hono";
import { zAssistantInput } from "@agent-hub/contracts";
import type { AssistantSettingsService } from "../../services/assistant-settings";
import type { AppEnv } from "../types";
import { badRequest } from "../../domain/errors";

export function registerSettingsRoutes(
  app: Hono<AppEnv>,
  settings: AssistantSettingsService,
): void {
  app.get("/api/v1/settings/assistant", (c) =>
    c.json({ data: settings.view() }),
  );

  app.put("/api/v1/settings/assistant", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zAssistantInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid assistant settings", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await settings.update(parsed.data) });
  });

  app.get("/api/v1/settings/assistant/:target/models", async (c) => {
    const target = parseTarget(c.req.param("target"));
    try {
      return c.json({ data: await settings.listModels(target) });
    } catch (error) {
      throw badRequest(
        error instanceof Error ? error.message : "Unable to reach the endpoint",
      );
    }
  });
}

function parseTarget(value: string): "reply" | "transcription" {
  if (value === "reply" || value === "transcription") return value;
  throw badRequest("Unknown assistant settings target");
}
