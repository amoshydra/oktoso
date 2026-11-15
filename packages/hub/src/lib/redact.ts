/**
 * Whole-key matches only, compared with separators and case removed.
 *
 * Substring matching masked diagnostics such as `contextTokens`,
 * `statusText`, and `contentType`, which is exactly what an operator needs when
 * a provider call fails.
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "apikey",
  "secret",
  "secretkey",
  "cookie",
  "credential",
  "credentials",
  "text",
  "body",
  "content",
  "prompt",
  "draft",
  "completion",
  "transcript",
  "messages",
  "systemprompt",
  "context",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Values registered at startup: the owner token, provider credentials, VAPID
 * private key, MCP tokens. Matching happens on the raw string, so a secret
 * echoed inside an error message is masked even when the key is innocent.
 */
const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (typeof value !== "string" || value.length < 8) return;
  secrets.add(value);
}

export function registerSecrets(values: Array<string | undefined | null>): void {
  for (const value of values) registerSecret(value);
}

/** Tests only: forget registered secrets between cases. */
export function resetSecrets(): void {
  secrets.clear();
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]"],
  [/(Basic\s+)[A-Za-z0-9+/=]+/gi, "$1[REDACTED]"],
  [
    /([?&](?:token|api[_-]?key|access[_-]?token|password|secret)=)[^&\s"']+/gi,
    "$1[REDACTED]",
  ],
];

/** Masks registered secrets and token-shaped substrings inside any string. */
export function redactText(value: string): string {
  let output = value;
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    output = output.split(secret).join("[REDACTED]");
  }
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (value instanceof Error) {
    // message/stack/cause are non-enumerable, so the plain walk would log {}.
    return redactValue(
      {
        name: value.name,
        message: value.message,
        stack: value.stack,
        cause: value.cause,
      },
      seen,
      depth + 1,
    );
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }
  if (value instanceof Map) {
    return redactValue(Object.fromEntries(value), seen, depth + 1);
  }
  if (value instanceof Set) {
    return [...value].map((item) => redactValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key)
      ? "[REDACTED]"
      : redactValue(child, seen, depth + 1);
  }
  return output;
}

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}
