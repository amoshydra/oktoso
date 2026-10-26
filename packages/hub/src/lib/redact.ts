const SENSITIVE_KEY = /password|passwd|token|authorization|api[-_]?key|secret|cookie/i;

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redactValue(child, seen, depth + 1);
  }
  return output;
}

export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}
