export const SESSION_PROFILES = ["phone", "g2"] as const;

export type SessionProfile = (typeof SESSION_PROFILES)[number];

export const AUTH_SCOPES = [
  "sessions.read",
  "sessions.write",
  "handoffs",
  "attention.read",
  "attention.act",
  "search.read",
  "providers.read",
  "providers.write",
  "settings.read",
  "settings.write",
  "assistant",
  "automation.read",
  "automation.act",
  "automation.write",
  "notifications",
  "data.read",
  "data.write",
  "transcribe",
  "reply",
  "events",
  "admin",
] as const;

export type AuthScope = (typeof AUTH_SCOPES)[number];

const PHONE_SCOPES: readonly AuthScope[] = AUTH_SCOPES.filter(
  (scope) => scope !== "admin",
);

const G2_SCOPES: readonly AuthScope[] = [
  "sessions.read",
  "sessions.write",
  "attention.read",
  "attention.act",
  "search.read",
  "providers.read",
  "settings.read",
  "automation.read",
  "automation.act",
  "transcribe",
  "reply",
  "events",
];

export const PROFILE_SCOPES: Record<SessionProfile, readonly AuthScope[]> = {
  phone: PHONE_SCOPES,
  g2: G2_SCOPES,
};

export function scopesForProfile(profile: SessionProfile): AuthScope[] {
  return [...PROFILE_SCOPES[profile]];
}

export function isSessionProfile(value: unknown): value is SessionProfile {
  return value === "phone" || value === "g2";
}
