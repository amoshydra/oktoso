import { PairingService, type PairingCode } from "./pairing";
import {
  SESSION_REFRESH_WINDOW_MS,
  SESSION_TTL_SECONDS,
  mintSessionToken,
  tokensMatch,
  verifySessionToken,
  type SessionInfo,
  type SessionToken,
} from "./session";
import {
  scopesForProfile,
  type AuthScope,
  type SessionProfile,
} from "./profiles";

export type AuthIdentity =
  | { kind: "owner" }
  | {
      kind: "session";
      expiresAt: number;
      profile: SessionProfile;
      scopes: AuthScope[];
    };

export interface AuthServiceOptions {
  now?: () => number;
  sessionTtlSeconds?: number;
  refreshWindowMs?: number;
  pairingTtlMs?: number;
  pairingCapacity?: number;
}

/**
 * Owns the hub credential model:
 * - the configured owner token is the permanent recovery/admin credential;
 * - paired devices receive stateless, expiring session tokens derived from it;
 * - pairing codes are short lived and single use.
 */
export class AuthService {
  private readonly ownerToken: string;
  private readonly now: () => number;
  private readonly sessionTtlSeconds: number;
  private readonly refreshWindowMs: number;
  private readonly pairings: PairingService;

  constructor(ownerToken: string, options: AuthServiceOptions = {}) {
    this.ownerToken = ownerToken;
    this.now = options.now ?? Date.now;
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? SESSION_TTL_SECONDS;
    this.refreshWindowMs =
      options.refreshWindowMs ?? SESSION_REFRESH_WINDOW_MS;
    this.pairings = new PairingService({
      now: this.now,
      ttlMs: options.pairingTtlMs,
      capacity: options.pairingCapacity,
    });
  }

  isOwner(token: string): boolean {
    return tokensMatch(token, this.ownerToken);
  }

  nowMs(): number {
    return this.now();
  }

  mintSession(profile: SessionProfile = "phone"): SessionToken {
    return mintSessionToken(
      this.ownerToken,
      this.now(),
      this.sessionTtlSeconds,
      profile,
    );
  }

  verifySession(token: string): SessionInfo | undefined {
    return verifySessionToken(token, this.ownerToken, this.now());
  }

  identityForSession(info: SessionInfo): AuthIdentity {
    return {
      kind: "session",
      expiresAt: info.expiresAt,
      profile: info.profile,
      scopes: scopesForProfile(info.profile),
    };
  }

  shouldRefresh(expiresAt: number): boolean {
    return expiresAt - this.now() <= this.refreshWindowMs;
  }

  inspectPairing(code: string): PairingCode | undefined {
    return this.pairings.inspect(code);
  }

  issuePairing(profile: SessionProfile = "phone"): PairingCode {
    return this.pairings.issue(profile);
  }

  consumePairing(code: string): SessionProfile | undefined {
    return this.pairings.consume(code)?.profile;
  }
}
