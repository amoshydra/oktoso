import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLogger } from "../lib/logger";
import { ensureConfig } from "./bootstrap";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ensureConfig", () => {
  it("creates an empty config with a generated token", async () => {
    const root = await mkdtemp(join(tmpdir(), "oktoso-bootstrap-"));
    roots.push(root);
    const configPath = join(root, "hub.config.json");

    const result = await ensureConfig(configPath, {
      explicit: false,
      env: {},
      logger,
    });
    expect(result.created).toBe(true);
    expect(result.generatedToken).toBeTruthy();

    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      token: string;
      providers: unknown[];
      dataDir: string;
    };
    expect(config.token).toBe(result.generatedToken);
    expect(config.providers).toEqual([]);
    expect(config.dataDir).toBe(".data");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);

    const second = await ensureConfig(configPath, {
      explicit: false,
      env: {},
      logger,
    });
    expect(second.created).toBe(false);
    expect(await readFile(configPath, "utf8")).toContain(config.token);
  });

  it("uses HUB_TOKEN when one is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "oktoso-bootstrap-"));
    roots.push(root);
    const configPath = join(root, "hub.config.json");
    const token = "a".repeat(32);

    const result = await ensureConfig(configPath, {
      explicit: false,
      env: { HUB_TOKEN: token },
      logger,
    });
    expect(result.created).toBe(true);
    expect(result.generatedToken).toBeUndefined();
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({ token });
  });

  it("does not create an explicitly requested config", async () => {
    const root = await mkdtemp(join(tmpdir(), "oktoso-bootstrap-"));
    roots.push(root);

    await expect(
      ensureConfig(join(root, "missing.json"), {
        explicit: true,
        env: {},
        logger,
      }),
    ).rejects.toThrow(/Hub config not found/);
  });
});
