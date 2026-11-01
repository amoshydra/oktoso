const DESTRUCTIVE =
  /\b(delete|remove|drop|reset|overwrite|wipe|truncate|force[- ]push|revoke|rotate|destroy|kill|rm\s+-rf)\b/i;
const SENSITIVE =
  /\b(password|passphrase|token|secret|api[- ]key|credential|private[- ]key)\b/i;

export function isDestructiveText(value: string): boolean {
  return DESTRUCTIVE.test(value);
}

export function isSensitiveText(value: string): boolean {
  return SENSITIVE.test(value);
}
