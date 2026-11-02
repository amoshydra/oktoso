import type { Hono } from "hono";
import type { TranscriptionService } from "../../services/transcription-service";
import type { AppEnv } from "../types";
import { AppError, badRequest } from "../../domain/errors";
import { AUDIO_CONTENT_TYPES, MAX_AUDIO_BODY_BYTES } from "../limits";

export function registerTranscriptionRoutes(
  app: Hono<AppEnv>,
  transcription: TranscriptionService,
): void {
  app.post("/api/v1/transcribe", async (c) => {
    const body = await c.req.parseBody().catch(() => undefined);
    if (!body) throw badRequest("A multipart audio body is required");
    const audio = body.audio;
    if (!(audio instanceof File)) {
      throw badRequest("An audio file is required");
    }
    if (audio.size === 0) {
      throw badRequest("The audio file is empty");
    }
    if (audio.size > MAX_AUDIO_BODY_BYTES) {
      throw new AppError(
        "payload_too_large",
        "The audio file is too large",
        413,
        { details: { maxBytes: MAX_AUDIO_BODY_BYTES } },
      );
    }

    const contentType =
      audio.type.split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = AUDIO_CONTENT_TYPES.get(contentType);
    if (!extension) {
      throw badRequest("Unsupported audio type", { contentType });
    }

    const language =
      typeof body.language === "string"
        ? body.language.trim().slice(0, 16)
        : undefined;
    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim().slice(0, 2_000)
        : undefined;

    const result = await transcription.transcribe({
      audio,
      filename: `audio.${extension}`,
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
    });
    return c.json({ data: result });
  });
}
