import type { ModelOption } from "@amoshydra/oktoso-contracts";

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  azure: "Azure",
  cerebras: "Cerebras",
  commandcode: "Command Code",
  deepseek: "DeepSeek",
  "fireworks-ai": "Fireworks AI",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  groq: "Groq",
  "llama.cpp": "llama.cpp",
  mistral: "Mistral",
  openai: "OpenAI",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  openwebui: "Open WebUI",
  togetherai: "Together AI",
  vercel: "Vercel",
  xai: "xAI",
};

export interface ModelOptionGroup {
  provider: string;
  label: string;
  models: ModelOption[];
}

export interface GroupedModelOptions {
  ungrouped: ModelOption[];
  groups: ModelOptionGroup[];
}

export function modelProviderLabel(provider: string): string {
  const known = PROVIDER_LABELS[provider];
  if (known) return known;
  return provider
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function groupModelOptions(models: ModelOption[]): GroupedModelOptions {
  const groups = new Map<string, ModelOptionGroup>();
  const ungrouped: ModelOption[] = [];

  for (const model of models) {
    if (!model.provider) {
      ungrouped.push(model);
      continue;
    }
    const existing = groups.get(model.provider);
    if (existing) {
      existing.models.push(model);
    } else {
      groups.set(model.provider, {
        provider: model.provider,
        label: modelProviderLabel(model.provider),
        models: [model],
      });
    }
  }

  return { ungrouped, groups: [...groups.values()] };
}
