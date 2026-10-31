import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, loadHubTarget, loadPairingConfig } from "./load";

describe("loadConfig", () => {
  it("interpolates environment variables and applies overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-hub-config-"));
    const filePath = join(root, "hub.config.json");
    try {
      await writeFile(
        filePath,
        JSON.stringify({
          token: "${HUB_TOKEN}",
          providers: [
            {
              id: "desktop",
              type: "opencode",
              baseUrl: "http://127.0.0.1:4096",
              auth: { kind: "basic", password: "${OPENCODE_PASSWORD}" },
            },
          ],
        }),
        "utf8",
      );

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

  it("fails when a referenced secret is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-hub-config-"));
    const filePath = join(root, "hub.config.json");
    try {
      await writeFile(filePath, JSON.stringify({ token: "${MISSING_TOKEN}" }), "utf8");
      await expect(loadConfig(filePath, {})).rejects.toThrow(
        /Missing environment variable MISSING_TOKEN/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads pairing fields without resolving provider secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-hub-config-"));
    const filePath = join(root, "hub.config.json");
    try {
      await writeFile(
        filePath,
        JSON.stringify({
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
        }),
        "utf8",
      );

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
    const root = await mkdtemp(join(tmpdir(), "agent-hub-config-"));
    const filePath = join(root, "hub.config.json");
    try {
      await writeFile(
        filePath,
        JSON.stringify({
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
        }),
        "utf8",
      );

      const target = await loadHubTarget(filePath, {});
      expect(target).toEqual({ host: "0.0.0.0", port: 8787 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
