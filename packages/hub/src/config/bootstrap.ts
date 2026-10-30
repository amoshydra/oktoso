import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { Logger } from "../lib/logger";

export interface EnsureConfigOptions {
  explicit: boolean;
  env?: NodeJS.ProcessEnv;
  logger: Logger;
}

export interface EnsureConfigResult {
  created: boolean;
  generatedToken?: string;
}

/**
 * Creates an empty local config on first run. An explicitly requested config
 * path is never created implicitly; production paths should be prepared.
 */
export async function ensureConfig(
  configPath: string,
  options: EnsureConfigOptions,
): Promise<EnsureConfigResult> {
  if (existsSync(configPath)) return { created: false };
  if (options.explicit) {
    throw new Error(`Hub config not found: ${configPath}`);
  }

  const envToken = options.env?.HUB_TOKEN?.trim();
  const token = envToken || randomBytes(32).toString("base64url");
  const config = {
    host: "127.0.0.1",
    port: 8787,
    token,
    dataDir: ".data",
    cors: [],
    providers: [],
  };

  try {
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    // Another process may have created it between existsSync and writeFile.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { created: false };
    }
    throw error;
  }

  options.logger.info("created empty hub config", {
    path: configPath,
    providers: 0,
  });
  return { created: true, generatedToken: envToken ? undefined : token };
}
