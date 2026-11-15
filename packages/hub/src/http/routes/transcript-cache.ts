import type { Hono } from "hono";
import { zTranscriptCacheInput } from "@amoshydra/oktoso-contracts";
import { badRequest } from "../../domain/errors";
import type { TranscriptCacheService } from "../../services/transcript-cache";
import type { AppEnv } from "../types";

export function registerTranscriptCacheRoutes(
  app: Hono<AppEnv>,
  transcripts: TranscriptCacheService,
): void {
  app.get("/api/v1/settings/transcripts", (c) => c.json({ data: transcripts.view() }));

  app.put("/api/v1/settings/transcripts", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = zTranscriptCacheInput.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid transcript cache settings", {
        issues: parsed.error.issues,
      });
    }
    return c.json({ data: await transcripts.update(parsed.data) });
  });

  app.delete("/api/v1/settings/transcripts", async (c) => {
    await transcripts.clear();
    return c.json({ data: transcripts.view() });
  });
}
