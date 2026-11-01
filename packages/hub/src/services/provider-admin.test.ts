import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@amoshydra/oktoso-contracts";
import type { Logger } from "../lib/logger";
import type { ProviderConfig } from "../config/schema";
import type { AttentionService } from "./attention-service";
import type { ProviderEventService } from "./provider-events";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";
import { ProviderAdminService } from "./provider-admin";

const roots: string[] = [];
const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

async function fixture(): Promise<{ path: string; config: ProviderConfig }> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-provider-"));
  roots.push(root);
  const path = join(root, "hub.config.json");
  await writeFile(
    path,
    JSON.stringify({ token: "test-token-long-enough", providers: [] }, null, 2),
    { mode: 0o600 },
  );
  const config: ProviderConfig = {
    id: "openwebui",
    type: "openwebui",
    name: "Open WebUI",
    baseUrl: "https://openwebui.example",
    auth: { kind: "bearer", token: "secret-token" },
    enabled: true,
  };
  return { path, config };
}

function provider(config: ProviderConfig): Provider {
  return {
    id: config.id,
    type: config.type,
    name: config.name ?? config.id,
    baseUrl: config.baseUrl,
    enabled: config.enabled,
    authKind: config.auth?.kind ?? "none",
    status: "online",
    capabilities: {
      list: true,
      read: true,
      send: false,
      create: false,
      stream: true,
      interrupt: false,
      permissions: false,
      forms: false,
      attachments: false,
      search: false,
      options: false,
      markRead: false,
    },
  };
}

function harness(options: { path: string; config: ProviderConfig }) {
  let current = options.config;
  const invalidateSessions = vi.fn();
  const invalidateAttention = vi.fn();
  const registry = {
    add: vi.fn((config: ProviderConfig) => {
      current = config;
    }),
    replace: vi.fn((config: ProviderConfig) => {
      current = config;
    }),
    check: vi.fn(async () => ({ status: "online" as const })),
    get: vi.fn(() => provider(current)),
    adapter: vi.fn(() => undefined),
  } as unknown as ProviderRegistry;
  const service = new ProviderAdminService(
    registry,
    { invalidate: invalidateSessions } as unknown as SessionService,
    { invalidate: invalidateAttention } as unknown as AttentionService,
    undefined as ProviderEventService | undefined,
    logger,
    options.path,
  );
  return { service, registry, invalidateSessions, invalidateAttention };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("ProviderAdminService", () => {
  it("persists and hot-adds a provider", async () => {
    const { path, config } = await fixture();
    const { service, registry, invalidateSessions, invalidateAttention } =
      harness({ path, config });

    const saved = await service.add({
      id: config.id,
      type: "openwebui",
      name: config.name,
      baseUrl: config.baseUrl,
      auth: { kind: "bearer", token: "secret-token" },
      enabled: true,
    });

    expect(saved).toMatchObject({ id: "openwebui", status: "online" });
    expect(registry.add).toHaveBeenCalledOnce();
    expect(registry.check).toHaveBeenCalledWith("openwebui");
    expect(invalidateSessions).toHaveBeenCalledOnce();
    expect(invalidateAttention).toHaveBeenCalledOnce();

    const raw = JSON.parse(await readFile(path, "utf8")) as {
      providers: ProviderConfig[];
    };
    expect(raw.providers).toEqual([
      {
        id: "openwebui",
        type: "openwebui",
        name: "Open WebUI",
        baseUrl: "https://openwebui.example",
        auth: { kind: "bearer", token: "secret-token" },
        enabled: true,
      },
    ]);
  });

  it("refuses to touch a config that other accounts can read", async () => {
    const { path, config } = await fixture();
    await chmod(path, 0o644);
    const { service } = harness({ path, config });

    await expect(
      service.add({
        id: "second",
        type: "openwebui",
        baseUrl: config.baseUrl,
        auth: { kind: "bearer", token: "another-secret" },
        enabled: true,
      }),
    ).rejects.toThrow(/must be 0600/);
  });

  it("rejects a duplicate provider without writing again", async () => {
    const { path, config } = await fixture();
    const { service } = harness({ path, config });
    await service.add({
      id: config.id,
      type: "openwebui",
      baseUrl: config.baseUrl,
      auth: { kind: "bearer", token: "secret-token" },
      enabled: true,
    });

    await expect(
      service.add({
        id: config.id,
        type: "openwebui",
        baseUrl: config.baseUrl,
        auth: { kind: "bearer", token: "other-token" },
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps the existing secret when an update omits it", async () => {
    const { path, config } = await fixture();
    await writeFile(
      path,
      JSON.stringify({ token: "test-token-long-enough", providers: [config] }, null, 2),
      { mode: 0o600 },
    );
    const { service } = harness({ path, config });

    await service.update("openwebui", {
      type: "openwebui",
      name: "Open WebUI renamed",
      baseUrl: "https://openwebui.example/v2",
      auth: { kind: "bearer" },
      enabled: false,
    });

    const raw = JSON.parse(await readFile(path, "utf8")) as {
      providers: ProviderConfig[];
    };
    expect(raw.providers[0]).toMatchObject({
      name: "Open WebUI renamed",
      baseUrl: "https://openwebui.example/v2",
      enabled: false,
      auth: { kind: "bearer", token: "secret-token" },
    });
  });

  it("requires a secret when changing authentication kind", async () => {
    const { path, config } = await fixture();
    await writeFile(
      path,
      JSON.stringify({ token: "test-token-long-enough", providers: [config] }, null, 2),
      { mode: 0o600 },
    );
    const { service } = harness({ path, config });

    await expect(
      service.update("openwebui", {
        type: "openwebui",
        baseUrl: config.baseUrl,
        auth: { kind: "basic", username: "opencode" },
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
