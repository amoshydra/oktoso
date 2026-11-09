import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  zReplyFeedbackEntry,
  type ReplyFeedbackEntry,
  type ReplyFeedbackInput,
} from "@amoshydra/oktoso-contracts";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export interface ReplyFeedbackStoreOptions {
  filePath: string;
  now?: () => number;
}

/**
 * Append-only JSONL store for reply audit feedback. Feedback is intentionally
 * kept out of the hub state file: it grows without bound and is only read by
 * the debug page and offline analysis.
 */
export class ReplyFeedbackStore {
  private readonly filePath: string;
  private readonly now: () => number;

  constructor(options: ReplyFeedbackStoreOptions) {
    this.filePath = options.filePath;
    this.now = options.now ?? Date.now;
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
  }

  async append(input: ReplyFeedbackInput): Promise<ReplyFeedbackEntry> {
    const entry: ReplyFeedbackEntry = {
      ...input,
      id: `rfb_${randomUUID()}`,
      createdAt: this.now(),
    };
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    });
    return entry;
  }

  async list(limit = DEFAULT_LIMIT): Promise<ReplyFeedbackEntry[]> {
    const bounded = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
    const raw = await this.read().catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    const entries: ReplyFeedbackEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = zReplyFeedbackEntry.safeParse(JSON.parse(trimmed));
        if (parsed.success) entries.push(parsed.data);
      } catch {
        // Ignore a corrupt line; the rest of the audit history stays readable.
      }
    }
    return entries.reverse().slice(0, bounded);
  }

  async export(): Promise<string> {
    return this.read().catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
  }

  private read(): Promise<string> {
    return readFile(this.filePath, "utf8");
  }
}
