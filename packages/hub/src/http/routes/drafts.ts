import type { Hono } from "hono";
import { zDraftInput, zSessionRef } from "@amoshydra/oktoso-contracts";
import type { DraftService } from "../../services/draft-service";
import type { AppEnv } from "../types";
import { badRequest } from "../../domain/errors";

export function registerDraftRoutes(
  app: Hono<AppEnv>,
  drafts: DraftService,
): void {
  app.get("/api/v1/sessions/:ref/draft", (c) => {
    const ref = parseRef(c.req.param("ref"));
    return c.json({ data: drafts.get(ref) });
  });

  app.put("/api/v1/sessions/:ref/draft", async (c) => {
    const ref = parseRef(c.req.param("ref"));
    const body = await c.req.json().catch(() => undefined);
    const parsed = zDraftInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid draft input", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await drafts.save(ref, parsed.data.text) });
  });

  app.delete("/api/v1/sessions/:ref/draft", async (c) => {
    const ref = parseRef(c.req.param("ref"));
    await drafts.delete(ref);
    return c.body(null, 204);
  });
}

function parseRef(value: string): string {
  const parsed = zSessionRef.safeParse(value);
  if (!parsed.success) {
    throw badRequest("Invalid session reference");
  }
  return parsed.data;
}
