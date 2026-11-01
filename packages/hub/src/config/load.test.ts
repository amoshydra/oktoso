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
