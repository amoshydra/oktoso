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
}

const HEALTH_PATHS: Record<string, string> = {
  opencode: "/api/info",
  openwebui: "/api/v1/models",
  hermes: "/v1/capabilities",
};

export class ProviderRegistry {
  private readonly runtimes = new Map<string, ProviderRuntimeState>();

  constructor(
    providers: ProviderConfig[],
    private readonly logger: Logger,
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

  async check(id: string): Promise<ProviderHealth> {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`Unknown provider ${id}`);
    const { config } = runtime;
    const started = Date.now();
    if (runtime.adapter) {
      const health = await runtime.adapter.health(AbortSignal.timeout(5_000));
      const latencyMs = Date.now() - started;
      return this.update(
        runtime,
        health.status,
        latencyMs,
        health.message,
        health.version,
      );
    }

    const url = buildProviderEndpoint(
      config.baseUrl,
      HEALTH_PATHS[config.type] ?? "/",
    );

    try {
      const response = await fetch(url, {
        headers: this.authHeaders(config),
        signal: AbortSignal.timeout(5_000),
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

  async checkAll(): Promise<ProviderHealth[]> {
    return Promise.all([...this.runtimes.keys()].map((id) => this.check(id)));
  }

  private update(
    runtime: ProviderRuntimeState,
    status: ProviderStatus,
    latencyMs: number,
    message?: string,
    version?: string,
  ): ProviderHealth {
    runtime.status = status;
    runtime.lastCheckedAt = Date.now();
    runtime.lastError = status === "online" ? undefined : message;
    if (version) runtime.version = version;
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
