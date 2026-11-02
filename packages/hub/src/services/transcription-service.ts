import type { TranscriptionResult } from "@amoshydra/oktoso-contracts";
import { AppError } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { AssistantSettingsService } from "./assistant-settings";

const MAX_TRANSCRIPTION_TEXT = 20_000;
const MAX_ERROR_DETAIL = 2_000;

export interface TranscriptionInput {
  audio: Blob;
  filename: string;
  language?: string;
  prompt?: string;
}

export class TranscriptionService {
  constructor(
    private readonly settings: AssistantSettingsService,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const config = this.settings.config().transcription;
    if (!config.enabled) {
      throw new AppError(
        "transcription_disabled",
        "Voice transcription is disabled in the hub settings",
        409,
        { details: { reason: "disabled" } },
      );
    }
    if (!config.baseUrl.trim() || !config.model.trim()) {
      throw new AppError(
        "transcription_unavailable",
        "Voice transcription is not configured",
        409,
        { details: { reason: "unconfigured" } },
      );
    }

    const form = new FormData();
    form.set("file", input.audio, input.filename);
    form.set("model", config.model);
    form.set("response_format", "json");
    if (input.language) form.set("language", input.language);
    if (input.prompt) form.set("prompt", input.prompt);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${trimSlash(config.baseUrl)}/audio/transcriptions`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            ...(config.apiKey
              ? { Authorization: `Bearer ${config.apiKey}` }
              : {}),
          },
          body: form,
          signal: AbortSignal.timeout(config.timeoutMs),
        },
      );
    } catch (error) {
      const timeout = isTimeoutError(error);
      this.logger.warn("Transcription endpoint request failed", {
        model: config.model,
        bytes: input.audio.size,
        timeout,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        timeout ? "transcription_timeout" : "transcription_failed",
        timeout
          ? "Voice transcription timed out"
          : "Unable to reach the transcription endpoint",
        timeout ? 504 : 502,
        { retryable: true, details: { reason: timeout ? "timeout" : "network" } },
      );
    }

    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      this.logger.warn("Transcription endpoint returned an error", {
        model: config.model,
        status: response.status,
        durationMs: Date.now() - startedAt,
        detail,
      });
      throw new AppError(
        "transcription_failed",
        `Transcription endpoint returned HTTP ${response.status}`,
        502,
        {
          retryable: response.status >= 500 || response.status === 429,
          details: { reason: "upstream", status: response.status },
        },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const text =
      payload &&
      typeof payload === "object" &&
      "text" in payload &&
      typeof payload.text === "string"
        ? payload.text.trim()
        : "";
    if (!text) {
      this.logger.warn("Transcription endpoint returned no text", {
        model: config.model,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      throw new AppError(
        "transcription_failed",
        "The transcription endpoint returned no text",
        502,
        { retryable: true, details: { reason: "empty" } },
      );
    }

    this.logger.info("Transcribed audio", {
      model: config.model,
      bytes: input.audio.size,
      characters: text.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      text: text.slice(0, MAX_TRANSCRIPTION_TEXT),
      model: config.model,
    };
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function safeErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.text()).trim();
    return text ? text.slice(0, MAX_ERROR_DETAIL) : undefined;
  } catch {
    return undefined;
  }
}
