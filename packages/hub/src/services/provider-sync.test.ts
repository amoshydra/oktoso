import { describe, expect, it } from "vitest";
import type { ProviderRegistry } from "./provider-registry";
import { operationSignal } from "./provider-sync";

function registryWith(
  status: "unknown" | "online" | "offline",
  timeoutMs = 60_000,
): ProviderRegistry {
  return {
    get: (id: string) => ({ id, enabled: true, status }),
    timeoutMs: () => timeoutMs,
  } as unknown as ProviderRegistry;
}

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("provider operation signals", () => {
  it("caps an unknown provider at the unknown-operation timeout", async () => {
    const signal = operationSignal(registryWith("unknown"), "test", 15_000, 20);
    await aborted(signal);
    expect(signal.aborted).toBe(true);
  });

  it("uses the fallback timeout once the provider is online", async () => {
    const signal = operationSignal(registryWith("online"), "test", 20, 5);
    await aborted(signal);
    expect(signal.aborted).toBe(true);
  });

  it("never exceeds the configured provider timeout", async () => {
    const signal = operationSignal(registryWith("online", 10), "test", 500, 5);
    await aborted(signal);
    expect(signal.aborted).toBe(true);
  });
});
