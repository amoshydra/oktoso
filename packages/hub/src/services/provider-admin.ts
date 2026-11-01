import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  Provider,
  ProviderAuthUpdate,
  ProviderInput,
  ProviderUpdateInput,
} from "@amoshydra/oktoso-contracts";
import { zProviderConfig, type ProviderConfig } from "../config/schema";
import { assertConfigFilePermissions } from "../config/permissions";
import { badRequest, conflict, notFound } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { AttentionService } from "./attention-service";
import type { ProviderEventService } from "./provider-events";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";

interface RawHubConfig {
  providers?: ProviderConfig[];
  [key: string]: unknown;
}

export class ProviderAdminService {
  private readonly configPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly sessions: SessionService,
    private readonly attention: AttentionService,
    private readonly providerEvents: ProviderEventService | undefined,
    private readonly logger: Logger,
    configPath: string,
  ) {
    this.configPath = resolve(configPath);
  }

  add(input: ProviderInput): Promise<Provider> {
    return this.serialize(async () => {
      const raw = await this.read();
      const providers = raw.providers ?? [];
      if (providers.some((provider) => provider.id === input.id)) {
        throw conflict(`Provider ${input.id} is already configured`);
      }

      const config = this.toConfig(input);
      await this.write({
        ...raw,
        providers: [...providers, config],
      });
      this.registry.add(config);
      this.invalidate();
      const adapter = this.registry.adapter(config.id);
      if (adapter) void this.providerEvents?.subscribe(adapter);
      const saved = await this.check(config.id);
      this.logger.info("provider added", {
        providerID: config.id,
        status: saved.status,
      });
      return saved;
    });
  }

  update(id: string, input: ProviderUpdateInput): Promise<Provider> {
    return this.serialize(async () => {
      const raw = await this.read();
      const providers = raw.providers ?? [];
      const index = providers.findIndex((provider) => provider.id === id);
      if (index < 0) throw notFound(`Provider ${id} is not configured`);

      const current = providers[index]!;
      const auth = input.auth
        ? this.mergeAuth(current.auth, input.auth)
        : current.auth;
      this.assertTypeAuth(input.type, auth);
      const config = zProviderConfig.parse({
        ...current,
        type: input.type,
        ...(input.name ? { name: input.name } : {}),
        baseUrl: input.baseUrl,
        enabled: input.enabled,
        ...(auth ? { auth } : {}),
      }) as ProviderConfig;

      const next = [...providers];
      next[index] = config;
      await this.write({ ...raw, providers: next });
      this.registry.replace(config);
      this.invalidate();
      const adapter = this.registry.adapter(config.id);
      if (adapter) void this.providerEvents?.subscribe(adapter);
      const saved = await this.check(config.id);
      this.logger.info("provider updated", {
        providerID: config.id,
        status: saved.status,
      });
      return saved;
    });
  }

  private toConfig(input: ProviderInput): ProviderConfig {
    this.assertTypeAuth(input.type, input.auth);
    return zProviderConfig.parse({
      id: input.id,
      type: input.type,
      ...(input.name ? { name: input.name } : {}),
      baseUrl: input.baseUrl,
      ...(input.auth ? { auth: input.auth } : {}),
      enabled: input.enabled,
    }) as ProviderConfig;
  }

  private assertTypeAuth(
    type: ProviderUpdateInput["type"],
    auth: ProviderConfig["auth"] | undefined,
  ): void {
    if (!auth || auth.kind === "none") return;
    if (type === "openwebui" && auth.kind !== "bearer") {
      throw badRequest("Open WebUI requires bearer authentication");
    }
    if (type === "opencode" && auth.kind !== "basic") {
      throw badRequest("OpenCode requires basic authentication");
    }
  }

  private mergeAuth(
    current: ProviderConfig["auth"] | undefined,
    input: ProviderAuthUpdate,
  ): ProviderConfig["auth"] {
    if (input.kind === "none") return { kind: "none" };
    if (input.kind === "basic") {
      const password =
        input.password ??
        (current?.kind === "basic" ? current.password : undefined);
      if (!password) {
        throw badRequest("A password is required for basic authentication");
      }
      return { kind: "basic", username: input.username, password };
    }
    const token =
      input.token ??
      (current?.kind === "bearer" ? current.token : undefined);
    if (!token) {
      throw badRequest("A token is required for bearer authentication");
    }
    return { kind: "bearer", token };
  }

  private invalidate(): void {
    this.sessions.invalidate();
    this.attention.invalidate();
  }

  private async check(id: string): Promise<Provider> {
    try {
      await this.registry.check(id);
    } catch (error) {
      this.logger.warn("provider health check failed", {
        providerID: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const provider = this.registry.get(id);
    if (!provider) throw notFound(`Provider ${id} is not configured`);
    return provider;
  }

  private async read(): Promise<RawHubConfig> {
    await assertConfigFilePermissions(this.configPath);
    const raw = JSON.parse(await readFile(this.configPath, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw badRequest("Hub config must be a JSON object");
    }
    return raw as RawHubConfig;
  }

  private async write(config: RawHubConfig): Promise<void> {
    const content = `${JSON.stringify(config, null, 2)}\n`;
    const directory = dirname(this.configPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.configPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, content, { mode: 0o600 });
    await rename(tempPath, this.configPath);
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action, action);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
