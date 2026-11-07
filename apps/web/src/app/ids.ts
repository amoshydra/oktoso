/**
 * Generate an identifier that also works on insecure origins.
 *
 * `crypto.randomUUID()` is only exposed in secure contexts (HTTPS or
 * localhost). The hub is commonly reached over plain HTTP on a LAN, so fall
 * back to `crypto.getRandomValues()` (available in insecure contexts) and
 * finally to time plus randomness.
 */
export function createID(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") {
    return source.randomUUID();
  }
  if (typeof source?.getRandomValues === "function") {
    const bytes = source.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
