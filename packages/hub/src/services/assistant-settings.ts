import type {
  AssistantAgentConfig,
  AssistantAgentTest,
  AssistantAgentTestInput,
  AssistantConfig,
  AssistantInput,
  AssistantView,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { SecretBox } from "../lib/secret-box";

const KEY_TARGETS = ["agent", "reply", "transcription"] as const;

export class AssistantSettingsService {
  constructor(
    private readonly store: StateStore,
    private readonly secrets: SecretBox,
  ) {}

  /** Provider keys are sealed at rest; the view only says whether one exists. */
  view(): AssistantView {
    return toView(this.config());
  }

  /** In-process config with keys opened; a wrong token leaves the key empty. */
  config(): AssistantConfig {
    const settings = this.store.getState().settings;
    return {
      agent: this.open(settings.agent),
      reply: this.open(settings.reply),
      transcription: this.open(settings.transcription),
    };
  }

  /**
   * Seal any plaintext key left by an older build. Runs once at startup; a
   * key that cannot be opened later is simply treated as absent.
   */
  async migrate(): Promise<void> {
    const settings = this.store.getState().settings;
    const stale = KEY_TARGETS.some((target) => {
      const key = settings[target].apiKey;
      return key !== undefined && key.length > 0 && !this.secrets.isSealed(key);
    });
    if (!stale) return;
    await this.store.update((state) => {
      for (const target of KEY_TARGETS) {
        const key = state.settings[target].apiKey;
        if (key !== undefined && key.length > 0 && !this.secrets.isSealed(key)) {
          state.settings[target].apiKey = this.secrets.seal(key);
        }
      }
    });
  }

  private open<T extends { apiKey?: string }>(config: T): T {
    if (!config.apiKey) return config;
    const plain = this.secrets.open(config.apiKey);
    const { apiKey: _sealed, ...rest } = config;
    return (plain === undefined ? rest : { ...rest, apiKey: plain }) as T;
  }

  private seal<T extends { apiKey?: string | null }>(config: T): T {
    const key = config.apiKey;
    if (!key || this.secrets.isSealed(key)) return config;
    return { ...config, apiKey: this.secrets.seal(key) };
  }

  async update(input: AssistantInput): Promise<AssistantView> {
    await this.store.update((state) => {
      const current = state.settings;
      if (input.agent) {
        state.settings.agent = mergeConfig(
          current.agent,
          this.seal(input.agent),
        );
      }
      if (input.reply) {
        state.settings.reply = mergeConfig(
          current.reply,
          this.seal(input.reply),
        );
      }
      if (input.transcription) {
        state.settings.transcription = mergeConfig(
          current.transcription,
          this.seal(input.transcription),
        );
      }
    });
    return this.view();
  }

  /** First boot only: show the config-file endpoint in the settings panel. */
  async seedAgent(config: AssistantAgentConfig): Promise<void> {
    const current = this.store.getState().settings.agent;
    if (current.baseUrl.trim() || current.model.trim()) return;
    await this.store.update((state) => {
      state.settings.agent = {
        ...state.settings.agent,
        enabled: config.enabled,
        baseUrl: config.baseUrl,
        model: config.model,
        timeoutMs: config.timeoutMs,
        maxContextMessages: config.maxContextMessages,
        allowWrite: config.allowWrite,
      };
    });
  }

  async testAgent(input: AssistantAgentTestInput): Promise<AssistantAgentTest> {
    const started = Date.now();
    const key = input.apiKey?.trim() || this.config().agent.apiKey;
    try {
      const response = await fetch(`${trimSlash(input.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content: "Reply with OK." }],
          temperature: 0,
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return {
        ok: response.ok,
        status: response.status,
        latencyMs: Date.now() - started,
        model: input.model,
        ...(response.ok ? {} : { error: `Endpoint returned HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        model: input.model,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listModels(
    target: "agent" | "reply" | "transcription",
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
    agent: {
      enabled: config.agent.enabled,
      baseUrl: config.agent.baseUrl,
      model: config.agent.model,
      timeoutMs: config.agent.timeoutMs,
      maxContextMessages: config.agent.maxContextMessages,
      allowWrite: config.agent.allowWrite,
      hasApiKey: Boolean(config.agent.apiKey),
    },
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
