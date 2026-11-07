export interface SendKeyState {
  key?: string;
  text?: string;
}

export function newSendKey(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  return (
    generated ??
    `send-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Reuse a key only while the payload text is unchanged. A retry of the same
 * answer or choice must keep its key; editing it must create a new one.
 */
export function selectSendKey(
  current: SendKeyState,
  text: string,
  create: () => string = newSendKey,
): { key: string; text: string } {
  return current.key && current.text === text
    ? { key: current.key, text }
    : { key: create(), text };
}
