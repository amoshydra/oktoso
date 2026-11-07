import type {
  Provider,
  ProviderHealth,
  ProviderStatus,
} from "@amoshydra/oktoso-contracts";
import {
  emptyCapabilities,
  OpenCodeAdapter,
  OpenWebUIAdapter,
  type ProviderAdapter,
} from "@amoshydra/oktoso-providers";
import type { ProviderConfig } from "../config/schema";
import { buildProviderEndpoint } from "../config/load";
import type { Logger } from "../lib/logger";

interface ProviderRuntimeState {
  config: ProviderConfig;
  status: ProviderStatus;
  adapter?: ProviderAdapter;
  version?: string;
  lastCheckedAt?: number;
  lastError?: string;
  consecutiveFailures: number;
  nextCheckAt: number;
}

const HEALTH_BACKOFF_BASE_MS = 5_000;
const HEALTH_BACKOFF_MAX_MS = 300_000;
const HEALTH_TIMEOUT_MS = 4_000;

function healthBackoffMs(failures: number): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 6);
  return Math.min(HEALTH_BACKOFF_MAX_MS, HEALTH_BACKOFF_BASE_MS * 2 ** exponent);
}

const HEALTH_PATHS: Record<string, string> = {
  opencode: "/api/info",
  openwebui: "/api/v1/models",
  hermes: "/v1/capabilities",
};

export class ProviderRegistry {
  private readonly runtimes = new Map<string, ProviderRuntimeState>();
  private readonly inflight = new Map<string, Promise<ProviderHealth>>();

  constructor(
    providers: ProviderConfig[],
    private readonly logger: Logger,
    private readonly onStatusChange?: (provider: Provider) => void,
  ) {
    for (const config of providers) {
      this.runtimes.set(config.id, this.createRuntime(config));
    }
  }

  add(config: ProviderConfig): void {
    if (this.runtimes.has(config.id)) {
      throw new Error(`Provider ${config.id} is already configured`);
    }
    this.runtimes.set(config.id, this.createRuntime(config));
  }

  remove(id: string): void {
    this.runtimes.delete(id);
  }

  replace(config: ProviderConfig): void {
    if (!this.runtimes.has(config.id)) {
      throw new Error(`Provider ${config.id} is not configured`);
    }
    this.runtimes.set(config.id, this.createRuntime(config));
  }

  private createRuntime(config: ProviderConfig): ProviderRuntimeState {
    return {
      config,
      status: "unknown",
      consecutiveFailures: 0,
      nextCheckAt: 0,
      ...(config.type === "opencode"
        ? {
            adapter: new OpenCodeAdapter({
              id: config.id,
              baseUrl: config.baseUrl,
              username: config.auth?.kind === "basic" ? config.auth.username : undefined,
              password: config.auth?.kind === "basic" ? config.auth.password : "",
            }),
          }
        : config.type === "openwebui"
          ? {
              adapter: new OpenWebUIAdapter({
                id: config.id,
                baseUrl: config.baseUrl,
                token: config.auth?.kind === "bearer" ? config.auth.token : "",
              }),
            }
          : {}),
    };
  }

  adapters(): ProviderAdapter[] {
    return [...this.runtimes.values()]
      .filter((runtime) => runtime.config.enabled)
      .map((runtime) => runtime.adapter)
      .filter((adapter): adapter is ProviderAdapter => Boolean(adapter));
  }

  adapter(id: string): ProviderAdapter | undefined {
    return this.runtimes.get(id)?.adapter;
  }

  list(): Provider[] {
    return [...this.runtimes.values()].map((runtime) => this.toProvider(runtime));
  }

  get(id: string): Provider | undefined {
    const runtime = this.runtimes.get(id);
    return runtime ? this.toProvider(runtime) : undefined;
  }

  diagnostics(): Array<{
    id: string;
    type: string;
    status: ProviderStatus;
    lastCheckedAt?: number;
    lastError?: string;
  }> {
    return [...this.runtimes.values()].map((runtime) => ({
      id: runtime.config.id,
      type: runtime.config.type,
      status: runtime.status,
      ...(runtime.lastCheckedAt ? { lastCheckedAt: runtime.lastCheckedAt } : {}),
      ...(runtime.lastError ? { lastError: runtime.lastError } : {}),
    }));
  }

  check(id: string): Promise<ProviderHealth> {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      return Promise.reject(new Error(`Unknown provider ${id}`));
    }
    const existing = this.inflight.get(id);
    if (existing) return existing;

    const run = this.runCheck(id, runtime).finally(() => {
      this.inflight.delete(id);
    });
    this.inflight.set(id, run);
    return run;
  }

  /**
   * Check providers whose backoff window has elapsed. The background loop uses
   * this so a down host is not retried on every tick.
   */
  async checkDue(): Promise<ProviderHealth[]> {
    const now = Date.now();
    const due = [...this.runtimes.entries()]
      .filter(([, runtime]) => runtime.nextCheckAt <= now)
      .map(([id]) => id);
    return Promise.all(due.map((id) => this.check(id)));
  }

  async checkAll(): Promise<ProviderHealth[]> {
    return Promise.all([...this.runtimes.keys()].map((id) => this.check(id)));
  }

  timeoutMs(id: string): number {
    return this.runtimes.get(id)?.config.timeoutMs ?? 20_000;
  }

  private async runCheck(
    id: string,
    runtime: ProviderRuntimeState,
  ): Promise<ProviderHealth> {
    const { config } = runtime;
    const started = Date.now();
    const signal = AbortSignal.timeout(
      Math.min(config.timeoutMs, HEALTH_TIMEOUT_MS),
    );

    if (runtime.adapter) {
      try {
        const health = await runtime.adapter.health(signal);
        return this.update(
          runtime,
          health.status,
          Date.now() - started,
          health.message,
          health.version,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.debug("Provider health check failed", {
          providerID: id,
          error: message,
        });
        return this.update(runtime, "offline", Date.now() - started, message);
      }
    }

    const url = buildProviderEndpoint(
      config.baseUrl,
      HEALTH_PATHS[config.type] ?? "/",
    );

    try {
      const response = await fetch(url, {
        headers: this.authHeaders(config),
        signal,
      });
      const latencyMs = Date.now() - started;

      if (response.status === 401 || response.status === 403) {
        return this.update(runtime, "auth-error", latencyMs, "Authentication rejected");
      }
      if (!response.ok) {
        return this.update(
          runtime,
          "offline",
          latencyMs,
          `Provider returned HTTP ${response.status}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      const version =
        payload && typeof payload === "object" && "version" in payload
          ? String((payload as { version: unknown }).version)
          : undefined;
      return this.update(runtime, "online", latencyMs, undefined, version);
    } catch (error) {
      const latencyMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.debug("Provider health check failed", {
        providerID: config.id,
        error: message,
      });
      return this.update(runtime, "offline", latencyMs, message);
    }
  }

  private update(
    runtime: ProviderRuntimeState,
    status: ProviderStatus,
    latencyMs: number,
    message?: string,
    version?: string,
  ): ProviderHealth {
    const now = Date.now();
    const previous = runtime.status;
    runtime.status = status;
    runtime.lastCheckedAt = now;
    runtime.lastError = status === "online" ? undefined : message;
    if (version) runtime.version = version;
    if (status === "online") {
      runtime.consecutiveFailures = 0;
      runtime.nextCheckAt = 0;
    } else {
      runtime.consecutiveFailures += 1;
      runtime.nextCheckAt =
        now + healthBackoffMs(runtime.consecutiveFailures);
    }
    if (previous !== status) {
      try {
        this.onStatusChange?.(this.toProvider(runtime));
      } catch (error) {
        this.logger.warn("Provider status listener failed", {
          providerID: runtime.config.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { status, latencyMs, message, version };
  }

  private authHeaders(config: ProviderConfig): Record<string, string> {
    const auth = config.auth;
    if (!auth || auth.kind === "none") return {};
    if (auth.kind === "bearer") return { Authorization: `Bearer ${auth.token}` };
    return {
      Authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
    };
  }

  private toProvider(runtime: ProviderRuntimeState): Provider {
    return {
      id: runtime.config.id,
      type: runtime.config.type,
      name: runtime.config.name ?? runtime.config.id,
      baseUrl: runtime.config.baseUrl,
      enabled: runtime.config.enabled,
      authKind: runtime.config.auth?.kind ?? "none",
      ...(runtime.config.auth?.kind === "basic"
        ? { authUsername: runtime.config.auth.username }
        : {}),
      status: runtime.status,
      ...(runtime.version ? { version: runtime.version } : {}),
      ...(runtime.lastCheckedAt ? { lastCheckedAt: runtime.lastCheckedAt } : {}),
      capabilities: runtime.adapter?.capabilities ?? emptyCapabilities,
    };
  }
}
