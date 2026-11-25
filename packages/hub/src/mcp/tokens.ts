import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretBox } from "../lib/secret-box";

const TOKEN_PREFIX = "okt_mcp_";
const ID_PREFIX = "mcp_";
const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 60 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_ACTIVE = 50;

export interface McpTokenRateLimit {
  windowMs: number;
  max: number;
}

export interface McpTokenScope {
  id: string;
  providers?: string[];
  tools?: string[];
  sessionRef?: string;
  allowWrite: boolean;
  maxSessions: number;
  rateLimit: McpTokenRateLimit;
  timeoutMs: number;
  createdAt: number;
  expiresAt: number;
  createdBy?: string;
}

export interface IssuedMcpToken extends McpTokenScope {
  token: string;
}

export interface IssueMcpTokenInput {
  ttlSeconds?: number;
  providers?: string[];
  tools?: string[];
  sessionRef?: string;
  allowWrite?: boolean;
  maxSessions?: number;
  rateLimit?: McpTokenRateLimit;
  timeoutMs?: number;
  createdBy?: string;
}

interface StoredMcpToken extends McpTokenScope {
  digest: Buffer;
  sealedToken: string;
}

export interface McpTokenServiceOptions {
  secretBox: SecretBox;
  now?: () => number;
  defaultTtlSeconds?: number;
  maxTtlSeconds?: number;
  maxActive?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function publicScope(record: StoredMcpToken): McpTokenScope {
  return {
    id: record.id,
    ...(record.providers ? { providers: record.providers } : {}),
    ...(record.tools ? { tools: record.tools } : {}),
    ...(record.sessionRef ? { sessionRef: record.sessionRef } : {}),
    allowWrite: record.allowWrite,
    maxSessions: record.maxSessions,
    rateLimit: { ...record.rateLimit },
    timeoutMs: record.timeoutMs,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(record.createdBy ? { createdBy: record.createdBy } : {}),
  };
}

/**
 * Short-lived, owner-issued MCP credentials.
 *
 * The plaintext is sealed with the owner-token-derived key and kept only for
 * the token's lifetime, so the owner can reveal it again from chat. Expiry is
 * checked on every lookup; an expired token fails authentication even if an
 * MCP session was opened earlier.
 */
export class McpTokenService {
  private readonly tokens = new Map<string, StoredMcpToken>();
  private readonly now: () => number;
  private readonly defaultTtlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly maxActive: number;

  constructor(private readonly options: McpTokenServiceOptions) {
    this.now = options.now ?? Date.now;
    this.defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.maxTtlSeconds = options.maxTtlSeconds ?? MAX_TTL_SECONDS;
    this.maxActive = options.maxActive ?? MAX_ACTIVE;
  }

  issue(input: IssueMcpTokenInput = {}): IssuedMcpToken {
    this.prune();
    if (this.tokens.size >= this.maxActive) {
      throw new Error(
        `Too many active MCP tokens (maximum ${this.maxActive}); revoke or wait for one to expire.`,
      );
    }
    const ttlSeconds = clamp(
      Math.floor(input.ttlSeconds ?? this.defaultTtlSeconds),
      MIN_TTL_SECONDS,
      this.maxTtlSeconds,
    );
    const id = `${ID_PREFIX}${randomBytes(8).toString("base64url")}`;
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
    const createdAt = this.now();
    const record: StoredMcpToken = {
      id,
      digest: digest(token),
      sealedToken: this.options.secretBox.seal(token),
      ...(input.providers && input.providers.length > 0
        ? { providers: [...new Set(input.providers)] }
        : {}),
      ...(input.tools && input.tools.length > 0
        ? { tools: [...new Set(input.tools)] }
        : {}),
      ...(input.sessionRef ? { sessionRef: input.sessionRef } : {}),
      allowWrite: input.allowWrite === true,
      maxSessions: clamp(Math.floor(input.maxSessions ?? 1), 1, 5),
      rateLimit: {
        windowMs: input.rateLimit?.windowMs ?? 60_000,
        max: input.rateLimit?.max ?? 120,
      },
      timeoutMs: clamp(Math.floor(input.timeoutMs ?? 60_000), 1_000, 600_000),
      createdAt,
      expiresAt: createdAt + ttlSeconds * 1_000,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    };
    this.tokens.set(record.id, record);
    return { ...publicScope(record), token };
  }

  authenticate(token: string): McpTokenScope | undefined {
    this.prune();
    if (!token) return undefined;
    const presented = digest(token);
    for (const record of this.tokens.values()) {
      if (
        presented.length === record.digest.length &&
        timingSafeEqual(presented, record.digest)
      ) {
        return publicScope(record);
      }
    }
    return undefined;
  }

  list(): McpTokenScope[] {
    this.prune();
    return [...this.tokens.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(publicScope);
  }

  reveal(id: string): IssuedMcpToken | undefined {
    this.prune();
    const record = this.tokens.get(id);
    if (!record) return undefined;
    const token = this.options.secretBox.open(record.sealedToken);
    if (!token) return undefined;
    return { ...publicScope(record), token };
  }

  revoke(id: string): boolean {
    return this.tokens.delete(id);
  }

  prune(): void {
    const now = this.now();
    for (const [id, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(id);
    }
  }

  get size(): number {
    this.prune();
    return this.tokens.size;
  }
}

/** Replace short-lived MCP tokens in model context while keeping the token id. */
export function redactMcpTokens(text: string): string {
  return text.replace(
    /okt_mcp_[A-Za-z0-9_-]{20,}/g,
    "[redacted mcp token; reveal it again with the token id]",
  );
}
