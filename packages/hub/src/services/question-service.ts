import { createHash } from "node:crypto";
import type { QuestionPrompt } from "@agent-hub/contracts";
import type { SessionService } from "./session-service";
import { parseQuestion } from "./question-parser";

export interface QuestionServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  value: QuestionPrompt | null;
}

export class QuestionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly sessions: SessionService,
    options: QuestionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async get(ref: string): Promise<QuestionPrompt | null> {
    const page = await this.sessions.messages(ref, {
      limit: 6,
      order: "desc",
    });
    const latest = page.data[0];
    if (!latest) return null;
    if (latest.streaming === true) return null;

    const text = latest.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const hash = createHash("sha256")
      .update(text)
      .digest("hex")
      .slice(0, 8);
    const key = `${ref}:${latest.id}:${hash}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    const value = parseQuestion(page.data, {
      sessionRef: ref,
      now: this.now(),
    });
    this.cache.set(key, {
      value,
      expiresAt: this.now() + this.ttlMs,
    });
    if (this.cache.size > 100) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    return value;
  }

  clear(): void {
    this.cache.clear();
  }
}
