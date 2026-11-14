import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadHubTarget, loadPairingConfig } from "./load";

async function writeConfig(content: unknown): Promise<{ root: string; filePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-config-"));
  const filePath = join(root, "hub.config.json");
  await writeFile(filePath, JSON.stringify(content), {
    encoding: "utf8",
    mode: 0o600,
  });
  return { root, filePath };
}

describe("loadConfig", () => {
  it("interpolates environment variables and applies overrides", async () => {
    const { root, filePath } = await writeConfig({
      token: "${HUB_TOKEN}",
      providers: [
        {
          id: "desktop",
          type: "opencode",
          baseUrl: "http://127.0.0.1:4096",
          auth: { kind: "basic", password: "${OPENCODE_PASSWORD}" },
        },
      ],
    });
    try {
      const config = await loadConfig(filePath, {
        HUB_TOKEN: "this-is-a-long-dev-token",
        OPENCODE_PASSWORD: "secret",
        HUB_PORT: "9999",
      });

      expect(config.port).toBe(9999);
      expect(config.token).toBe("this-is-a-long-dev-token");
      expect(config.providers[0]?.auth).toEqual({
        kind: "basic",
        username: "opencode",
        password: "secret",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults the data directory to the platform state directory", async () => {
    const { root, filePath } = await writeConfig({ token: "this-is-a-long-dev-token" });
    try {
      const config = await loadConfig(filePath, {
        XDG_STATE_HOME: "/var/lib/oktoso-state",
      });

      expect(config.dataDir).toBe("/var/lib/oktoso-state/oktoso");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when a referenced secret is missing", async () => {
    const { root, filePath } = await writeConfig({ token: "${MISSING_TOKEN}" });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Missing environment variable MISSING_TOKEN/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads pairing fields without resolving provider secrets", async () => {
    const { root, filePath } = await writeConfig({
      host: "0.0.0.0",
      port: 8787,
      token: "${HUB_TOKEN}",
      dataDir: "${HUB_DATA_DIR}",
      publicUrl: "https://oktoso.example.com",
      providers: [
        {
          id: "desktop",
          type: "opencode",
          baseUrl: "${OPENCODE_BASE_URL}",
          auth: { kind: "basic", password: "${OPENCODE_PASSWORD}" },
        },
      ],
    });
    try {
      const config = await loadPairingConfig(filePath, {
        HUB_TOKEN: "this-is-a-long-dev-token",
      });

      expect(config).toEqual({
        host: "0.0.0.0",
        port: 8787,
        token: "this-is-a-long-dev-token",
        publicUrl: "https://oktoso.example.com",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads a probe target without a token or provider secrets", async () => {
    const { root, filePath } = await writeConfig({
      host: "0.0.0.0",
      port: 8787,
      token: "${MISSING_TOKEN}",
      providers: [
        {
          id: "desktop",
          type: "opencode",
          baseUrl: "${MISSING_PROVIDER_URL}",
        },
      ],
    });
    try {
      const target = await loadHubTarget(filePath, {});
      expect(target).toEqual({ host: "0.0.0.0", port: 8787 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults MCP off with no tokens", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
    });
    try {
      const config = await loadConfig(filePath, {});
      expect(config.mcp.enabled).toBe(false);
      expect(config.mcp.tokens).toEqual([]);
      expect(config.mcp.audit.enabled).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults provider timeouts and the health interval", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      providers: [
        {
          id: "remote",
          type: "opencode",
          baseUrl: "http://192.0.2.10:4096",
        },
      ],
    });
    try {
      const config = await loadConfig(filePath, {});
      expect(config.healthCheckIntervalMs).toBe(30_000);
      expect(config.providers[0]?.timeoutMs).toBe(20_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts a custom health interval and provider timeout", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      healthCheckIntervalMs: 0,
      providers: [
        {
          id: "remote",
          type: "openwebui",
          baseUrl: "https://openwebui.example",
          timeoutMs: 45_000,
        },
      ],
    });
    try {
      const config = await loadConfig(filePath, {});
      expect(config.healthCheckIntervalMs).toBe(0);
      expect(config.providers[0]?.timeoutMs).toBe(45_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads scoped MCP tokens with defaults", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      mcp: {
        enabled: true,
        tokens: [
          {
            id: "controller",
            token: "${MCP_TOKEN}",
            allowWrite: true,
            providers: ["opencode"],
            tools: ["providers_list", "sessions_send"],
          },
        ],
      },
    });
    try {
      const config = await loadConfig(filePath, {
        MCP_TOKEN: "mcp-token-long-enough",
      });
      expect(config.mcp.enabled).toBe(true);
      expect(config.mcp.tokens[0]).toMatchObject({
        id: "controller",
        token: "mcp-token-long-enough",
        allowWrite: true,
        providers: ["opencode"],
        tools: ["providers_list", "sessions_send"],
        timeoutMs: 60_000,
        rateLimit: { windowMs: 60_000, max: 120 },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects MCP enabled without tokens", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      mcp: { enabled: true },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /mcp\.enabled requires at least one token/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate MCP client IDs and secrets", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      mcp: {
        enabled: true,
        tokens: [
          { id: "controller", token: "mcp-token-long-enough" },
          { id: "controller", token: "mcp-token-long-enough" },
        ],
      },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Duplicate MCP client ID[\s\S]*Duplicate MCP token/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("config file permissions", () => {
  it("refuses a config that other accounts can read", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
    });
    try {
      await chmod(filePath, 0o644);

      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /must be 0600[\s\S]*chmod 600/,
      );
      await expect(loadPairingConfig(filePath, {})).rejects.toThrow(/must be 0600/);
      await expect(loadHubTarget(filePath, {})).rejects.toThrow(/must be 0600/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an owner-only config", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
    });
    try {
      await chmod(filePath, 0o600);

      await expect(loadConfig(filePath, {})).resolves.toMatchObject({
        token: "this-is-a-long-dev-token",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("notification config", () => {
  it("defaults notifications off", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
    });
    try {
      const config = await loadConfig(filePath, {});

      expect(config.notifications.enabled).toBe(false);
      expect(config.notifications.channels).toEqual([]);
      expect(config.notifications.routing.immediate).toEqual([
        "permission",
        "approval",
      ]);
      expect(config.notifications.maxAttempts).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("interpolates notification channel secrets", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      notifications: {
        enabled: true,
        channels: [
          {
            kind: "ntfy",
            url: "https://ntfy.example.com",
            topic: "oktoso",
            token: "${NTFY_TOKEN}",
          },
          {
            kind: "telegram",
            botToken: "${TELEGRAM_BOT_TOKEN}",
            chatID: "12345",
          },
        ],
      },
    });
    try {
      const config = await loadConfig(filePath, {
        NTFY_TOKEN: "ntfy-secret",
        TELEGRAM_BOT_TOKEN: "telegram-secret",
      });

      expect(config.notifications.channels[0]).toMatchObject({
        kind: "ntfy",
        token: "ntfy-secret",
      });
      expect(config.notifications.channels[1]).toMatchObject({
        kind: "telegram",
        botToken: "telegram-secret",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate notification channels", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      notifications: {
        channels: [
          { kind: "webhook", url: "https://one.example.com" },
          { kind: "webhook", url: "https://two.example.com" },
        ],
      },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Duplicate notification channel: webhook/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads a start watcher with a known template", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      automation: {
        templates: [
          {
            id: "nightly-review",
            providerID: "opencode",
            title: "Nightly review",
            text: "Review the repository",
          },
        ],
        watchers: [
          {
            id: "start-review",
            trigger: { kind: "schedule", everyMs: 60_000 },
            action: { kind: "start", template: "nightly-review" },
          },
        ],
      },
    });
    try {
      const config = await loadConfig(filePath, {});
      expect(config.automation.templates[0]).toMatchObject({
        id: "nightly-review",
        title: "Nightly review",
      });
      expect(config.automation.watchers[0]?.action).toEqual({
        kind: "start",
        template: "nightly-review",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a start watcher with an unknown template", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      automation: {
        templates: [],
        watchers: [
          {
            id: "start-review",
            trigger: { kind: "schedule", everyMs: 60_000 },
            action: { kind: "start", template: "missing" },
          },
        ],
      },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Unknown template: missing/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate template IDs", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      automation: {
        templates: [
          { id: "same", providerID: "opencode", title: "One" },
          { id: "same", providerID: "opencode", title: "Two" },
        ],
      },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Duplicate template ID: same/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects half a VAPID key pair", async () => {
    const { root, filePath } = await writeConfig({
      token: "this-is-a-long-dev-token",
      notifications: {
        vapid: { publicKey: "only-public" },
      },
    });
    try {
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /vapid.publicKey and vapid.privateKey must be set together/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
