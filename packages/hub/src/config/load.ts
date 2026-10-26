import { readFile } from "node:fs/promises";
import { zHubConfig, type HubConfig } from "./schema";

type Env = Record<string, string | undefined>;

function interpolate(value: unknown, env: Env): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
      const replacement = env[name];
      if (replacement === undefined) {
        throw new Error(`Missing environment variable ${name}`);
      }
      return replacement;
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, env));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, interpolate(child, env)]),
    );
  }
  return value;
}

export async function loadConfig(
  filePath: string,
  env: Env = process.env,
): Promise<HubConfig> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const interpolated = interpolate(raw, env) as Record<string, unknown>;

  if (env.HUB_HOST) interpolated.host = env.HUB_HOST;
  if (env.HUB_PORT) interpolated.port = env.HUB_PORT;
  if (env.HUB_TOKEN) interpolated.token = env.HUB_TOKEN;
  if (env.HUB_DATA_DIR) interpolated.dataDir = env.HUB_DATA_DIR;
  if (env.HUB_CORS !== undefined) {
    interpolated.cors = env.HUB_CORS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  return zHubConfig.parse(interpolated);
}

export function buildProviderEndpoint(
  baseUrl: string,
  path: string,
): URL {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const suffix = path.startsWith("/") ? path.slice(1) : path;
  return new URL(suffix, base);
}
