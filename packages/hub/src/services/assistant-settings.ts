import type {
  AssistantConfig,
  AssistantInput,
  AssistantView,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";

export class AssistantSettingsService {
  constructor(private readonly store: StateStore) {}

  view(): AssistantView {
    return toView(this.store.getState().settings);
  }

  config(): AssistantConfig {
    return this.store.getState().settings;
  }

  async update(input: AssistantInput): Promise<AssistantView> {
    await this.store.update((state) => {
      const current = state.settings;
      if (input.reply) {
        state.settings.reply = mergeConfig(current.reply, input.reply);
      }
      if (input.transcription) {
        state.settings.transcription = mergeConfig(
          current.transcription,
          input.transcription,
        );
      }
    });
    return this.view();
  }

  async listModels(
    target: "reply" | "transcription",
  ): Promise<{ data: string[]; baseUrl: string }> {
    const config = this.config()[target];
    if (!config.baseUrl) {
      throw new Error(`${target} endpoint is not configured`);
    }
    const response = await fetch(`${trimSlash(config.baseUrl)}/models`, {
      headers: {
        Accept: "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`Endpoint returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const data = Array.isArray(payload.data)
      ? payload.data
          .map((model) => (typeof model.id === "string" ? model.id : undefined))
          .filter((id): id is string => Boolean(id))
      : [];
    return { data, baseUrl: config.baseUrl };
  }
}

function toView(config: AssistantConfig): AssistantView {
  return {
    reply: {
      enabled: config.reply.enabled,
      baseUrl: config.reply.baseUrl,
      model: config.reply.model,
      timeoutMs: config.reply.timeoutMs,
      hasApiKey: Boolean(config.reply.apiKey),
      disableThinking: config.reply.disableThinking,
    },
    transcription: {
      enabled: config.transcription.enabled,
      baseUrl: config.transcription.baseUrl,
      model: config.transcription.model,
      timeoutMs: config.transcription.timeoutMs,
      hasApiKey: Boolean(config.transcription.apiKey),
    },
  };
}

function mergeConfig<T extends object>(
  current: T,
  input: Omit<Partial<T>, "apiKey"> & { apiKey?: string | null },
): T {
  const { apiKey, ...rest } = input;
  const next: Record<string, unknown> = { ...current, ...rest };
  if (apiKey === null) {
    delete next.apiKey;
  } else if (apiKey !== undefined) {
    next.apiKey = apiKey;
  }
  return next as T;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
