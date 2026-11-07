import { AppError } from "../domain/errors";
import type { ProviderRegistry } from "./provider-registry";

export const DEFAULT_SYNC_TIMEOUT_MS = 3_000;
export const DEFAULT_SESSION_COLD_START_MS = 1_200;
export const DEFAULT_ATTENTION_COLD_START_MS = 2_000;
export const DEFAULT_UNKNOWN_OPERATION_TIMEOUT_MS = 2_000;

export function providerUnavailableReason(
  registry: ProviderRegistry,
  providerID: string,
): string | undefined {
  const provider = registry.get?.(providerID);
  if (!provider) return undefined;
  if (!provider.enabled) return "disabled";
  if (provider.status === "offline" || provider.status === "auth-error") {
    return provider.status;
  }
  return undefined;
}

export function syncSignal(
  registry: ProviderRegistry,
  providerID: string,
  maxTimeoutMs: number,
): AbortSignal {
  return AbortSignal.timeout(
    Math.min(registry.timeoutMs(providerID), maxTimeoutMs),
  );
}

export function operationSignal(
  registry: ProviderRegistry,
  providerID: string,
  fallbackTimeoutMs: number,
  unknownTimeoutMs = DEFAULT_UNKNOWN_OPERATION_TIMEOUT_MS,
): AbortSignal {
  const provider = registry.get?.(providerID);
  const ceiling =
    provider?.status === "unknown"
      ? Math.min(fallbackTimeoutMs, unknownTimeoutMs)
      : fallbackTimeoutMs;
  return AbortSignal.timeout(
    Math.min(registry.timeoutMs(providerID), ceiling),
  );
}

export function providerOfflineError(
  providerID: string,
  reason: string,
): AppError {
  return new AppError(
    "provider_offline",
    `Provider ${providerID} is ${reason}`,
    502,
    {
      retryable: true,
      details: { providerID, status: reason },
    },
  );
}

export function waitAtMost(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  if (timeoutMs <= 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([promise.then(() => undefined), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
