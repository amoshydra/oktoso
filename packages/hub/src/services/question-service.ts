import { createHash } from "node:crypto";
import type {
  PendingQuestionSummary,
  QuestionPrompt,
} from "@amoshydra/oktoso-contracts";
import type { SessionService } from "./session-service";
import { parseQuestion } from "./question-parser";

export interface QuestionServiceOptions {
  ttlMs?: number;
  summaryTtlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  expiresAt: number;
  value: QuestionPrompt | null;
}

interface SummaryCacheEntry {
  expiresAt: number;
  value: PendingQuestionSummary | null;
}

const MAX_SUMMARY_REFS = 10;

function summarize(prompt: QuestionPrompt): PendingQuestionSummary {
  const first = prompt.questions[0]!;
  return {
    sessionRef: prompt.sessionRef,
    messageId: prompt.messageId,
    revision: prompt.revision,
    askedAt: prompt.askedAt,
    questionCount: prompt.questions.length,
    text: first.text,
    ...(first.context ? { context: first.context } : {}),
    ...(prompt.attentionID ? { attentionID: prompt.attentionID } : {}),
  };
}

export class QuestionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly summaryCache = new Map<string, SummaryCacheEntry>();
  private readonly ttlMs: number;
  private readonly summaryTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly sessions: SessionService,
    options: QuestionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.summaryTtlMs = options.summaryTtlMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  async get(ref: string): Promise<QuestionPrompt | null> {
    const page = await this.sessions.messages(ref, {
      limit: 6,
      order: "desc",
    });
    const latest = page.data[0];
    if (!latest) {
      this.rememberSummary(ref, null);
      return null;
    }
    if (latest.streaming === true) {
      this.rememberSummary(ref, null);
      return null;
    }

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
    if (cached && cached.expiresAt > this.now()) {
      this.rememberSummary(ref, cached.value);
      return cached.value;
    }

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
    this.rememberSummary(ref, value);
    return value;
  }

  /**
   * Cheap discovery for the glass home and inbox. Results are cached briefly
   * and provider failures are reported separately so callers do not treat an
   * outage as a resolved question.
   */
  async summaries(refs: string[]): Promise<{
    data: PendingQuestionSummary[];
    failed: string[];
  }> {
    const unique = [...new Set(refs.map((ref) => ref.trim()).filter(Boolean))];
    const limited = unique.slice(0, MAX_SUMMARY_REFS);
    const failed: string[] = [];
    const results = await Promise.all(
      limited.map(async (ref) => {
        const cached = this.summaryCache.get(ref);
        if (cached && cached.expiresAt > this.now()) return cached.value;
        try {
          const prompt = await this.get(ref);
          return prompt ? summarize(prompt) : null;
        } catch {
          failed.push(ref);
          return null;
        }
      }),
    );
    return {
      data: results.filter(
        (item): item is PendingQuestionSummary => item !== null,
      ),
      failed,
    };
  }

  clear(): void {
    this.cache.clear();
    this.summaryCache.clear();
  }

  invalidate(ref?: string): void {
    if (ref) {
      this.summaryCache.delete(ref);
      return;
    }
    this.summaryCache.clear();
  }

  private rememberSummary(
    ref: string,
    prompt: QuestionPrompt | null,
  ): void {
    this.summaryCache.set(ref, {
      value: prompt ? summarize(prompt) : null,
      expiresAt: this.now() + this.summaryTtlMs,
    });
    if (this.summaryCache.size > 100) {
      const oldest = this.summaryCache.keys().next().value;
      if (oldest) this.summaryCache.delete(oldest);
    }
  }
}
