import { randomBytes } from "node:crypto";
import { PAIRING_TTL_SECONDS } from "./session";

export interface PairingCode {
  code: string;
  expiresAt: number;
}

export interface PairingServiceOptions {
  ttlMs?: number;
  capacity?: number;
  now?: () => number;
}

/**
 * In-memory, single-use pairing codes. Codes do not survive a hub restart.
 * The fixed TTL means insertion order is also expiry order.
 */
export class PairingService {
  private readonly codes = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(options: PairingServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? PAIRING_TTL_SECONDS * 1000;
    this.capacity = options.capacity ?? 1000;
    this.now = options.now ?? Date.now;
  }

  issue(): PairingCode {
    const now = this.now();
    this.prune(now);

    while (this.codes.size >= this.capacity) {
      const oldest = this.codes.keys().next().value;
      if (oldest === undefined) break;
      this.codes.delete(oldest);
    }

    const code = randomBytes(16).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.codes.set(code, expiresAt);
    return { code, expiresAt };
  }

  consume(code: string): PairingCode | undefined {
    const expiresAt = this.codes.get(code);
    if (expiresAt === undefined) return undefined;

    // Consume even an expired code so a replay cannot succeed later.
    this.codes.delete(code);
    if (expiresAt <= this.now()) return undefined;

    return { code, expiresAt };
  }

  /** Read a code without consuming it, for a confirmation page. */
  inspect(code: string): PairingCode | undefined {
    const expiresAt = this.codes.get(code);
    if (expiresAt === undefined) return undefined;
    if (expiresAt <= this.now()) return undefined;
    return { code, expiresAt };
  }

  get size(): number {
    return this.codes.size;
  }

  private prune(now: number): void {
    for (const [code, expiresAt] of this.codes) {
      if (expiresAt > now) break;
      this.codes.delete(code);
    }
  }
}
