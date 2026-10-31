import type {
  AssistantConfig,
  Message,
  ReplyMode,
  ReplyOption,
  ReplyOptions,
} from "@amoshydra/oktoso-contracts";
import type { Logger } from "../lib/logger";
import type { AssistantSettingsService } from "./assistant-settings";
import type { SessionService } from "./session-service";

interface CacheEntry {
  expiresAt: number;
  value: ReplyOptions;
}

const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CONTEXT_MESSAGES = 8;

const ALTERNATIVES_PROMPT =
  "Do not proceed yet. Propose 2-3 concrete alternatives, each in eight words or fewer, as a numbered list.";
const EXPLAIN_PROMPT =
  "Explain the main risk and the safest next step in a few short bullet points.";

export class ReplyService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly settings: AssistantSettingsService,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
  ) {}

  async list(ref: string, mode: ReplyMode): Promise<ReplyOptions> {
    const page = await this.sessions.messages(ref, {
      limit: MAX_CONTEXT_MESSAGES,
      order: "desc",
    });
    const messages = [...page.data].reverse();
    const last = messages.at(-1);
    const cacheKey = `${ref}:${mode}:${last?.id ?? "empty"}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const config = this.settings.config();
    const options =
      mode === "choices"
        ? await this.choices(messages, config)
        : await this.replies(messages, config);

    const value: ReplyOptions = {
      data: options,
      generatedAt: Date.now(),
      mode,
      ...(config.reply.enabled ? { model: config.reply.model } : {}),
    };
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    if (this.cache.size > 100) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    return value;
  }

  private async replies(
    messages: Message[],
    config: AssistantConfig,
  ): Promise<ReplyOption[]> {
    const canned: ReplyOption[] = [
      {
        id: "continue",
        label: "Continue",
        text: "Continue.",
        source: "canned",
        action: "send",
      },
      {
        id: "alternatives",
        label: "Show alternatives",
        text: ALTERNATIVES_PROMPT,
        source: "canned",
        action: "send",
      },
      {
        id: "explain",
        label: "Explain risk",
        text: EXPLAIN_PROMPT,
        source: "canned",
        action: "send",
      },
      {
        id: "stop",
        label: "Stop",
        text: "",
        source: "canned",
        action: "interrupt",
      },
      {
        id: "choices",
        label: "Find choices",
        text: "",
        source: "canned",
        action: "choices",
      },
      {
        id: "phone",
        label: "Phone keyboard",
        text: "",
        source: "canned",
        action: "phone",
      },
    ];
    // Voice stays hidden until the G2 audio/STT path is wired end-to-end.
    if (!config.reply.enabled || !config.reply.baseUrl || !config.reply.model) {
      return canned;
    }

    try {
      const suggestions = await this.modelSuggestions(messages, config);
      return [
        ...canned.slice(0, 1),
        ...suggestions.map((text, index) => ({
          id: `model-${index}`,
          label: truncateLabel(text),
          text,
          source: "model" as const,
          action: "send" as const,
        })),
        ...canned.slice(1),
      ];
    } catch (error) {
      this.logger.warn("Reply suggestion generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return canned;
    }
  }

  private async choices(
    messages: Message[],
    config: AssistantConfig,
  ): Promise<ReplyOption[]> {
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) return [];
    const assistantText = messageText(lastAssistant);
    let choices = parseChoices(assistantText);
    if (choices.length < 2 && config.reply.enabled && config.reply.baseUrl) {
      try {
        choices = await this.modelChoices(assistantText, config);
      } catch (error) {
        this.logger.warn("Reply choice extraction failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return choices.slice(0, 5).map((text, index) => ({
      id: `choice-${index}`,
      label: truncateLabel(text),
      text,
      source: "agent" as const,
      action: "send" as const,
    }));
  }

  private async modelSuggestions(
    messages: Message[],
    config: AssistantConfig,
  ): Promise<string[]> {
    const context = messages
      .map((message) => `${message.role}: ${messageText(message).slice(0, 500)}`)
      .filter((line) => line.trim().length > 0)
      .join("\n");
    const content = await this.completion(
      config,
      [
        {
          role: "system",
          content:
            "Suggest 2-3 short replies the user might send next in this chat with an AI agent. Each reply must be a decision or clarification, at most seven words. Return only a JSON array of strings.",
        },
        { role: "user", content: context || "The agent has not replied yet." },
      ],
      180,
    );
    return normalizeSuggestions(content).slice(0, 3);
  }

  private async modelChoices(
    assistantText: string,
    config: AssistantConfig,
  ): Promise<string[]> {
    const content = await this.completion(
      config,
      [
        {
          role: "system",
          content:
            "Extract 2-5 short choices from the assistant question below. Preserve the option wording, remove numbering and explanations, and return only a JSON array of strings.",
        },
        { role: "user", content: assistantText.slice(0, 4_000) },
      ],
      180,
    );
    return normalizeSuggestions(content).slice(0, 5);
  }

  private async completion(
    config: AssistantConfig,
    messages: Array<{ role: "system" | "user"; content: string }>,
    maxTokens: number,
  ): Promise<string> {
    const response = await fetch(`${trimSlash(config.reply.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(config.reply.apiKey
          ? { Authorization: `Bearer ${config.reply.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: config.reply.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
        ...(config.reply.disableThinking
          ? { chat_template_kwargs: { enable_thinking: false } }
          : {}),
      }),
      signal: AbortSignal.timeout(config.reply.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Reply model returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }
}

function messageText(message: Message): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseChoices(text: string): string[] {
  const choices: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/);
    if (!match?.[1]) continue;
    const choice = match[1]
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (choice.length > 0 && choice.length <= 100) choices.push(choice);
  }
  return [...new Set(choices)];
}

function normalizeSuggestions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const jsonCandidate =
    fenced ??
    (trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed : undefined);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      if (Array.isArray(parsed)) {
        candidates = parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      // Fall through to line parsing.
    }
  }
  if (candidates.length === 0) {
    // The local 4B model often returns one quoted suggestion per line.
    candidates = trimmed
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .split("\n");
  }

  return [
    ...new Set(
      candidates
        .map((item) =>
          item
            .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
            .replace(/^["'`]+|["'`]+$/g, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(
          (item) =>
            item.length > 0 &&
            item.length <= 100 &&
            !item.toLowerCase().startsWith("here are"),
        ),
    ),
  ];
}

function truncateLabel(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
