import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface LocalHubConfig {
  host?: unknown;
  port?: unknown;
  token?: unknown;
}

function readHubConfig(): LocalHubConfig {
  try {
    const path = resolve(process.env.HUB_CONFIG ?? "hub.config.json");
    return JSON.parse(readFileSync(path, "utf8")) as LocalHubConfig;
  } catch {
    return {};
  }
}

function resolveValue(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const resolved = value.trim().replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
    (_, name: string) => process.env[name] ?? "",
  );
  return resolved || undefined;
}

const config = readHubConfig();
const host = process.env.HUB_HOST ?? resolveValue(config.host) ?? "127.0.0.1";
const proxyHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
const port = process.env.HUB_PORT ?? resolveValue(config.port) ?? "8787";
const token =
  process.env.HUB_DEV_TOKEN?.trim() ??
  process.env.HUB_TOKEN?.trim() ??
  resolveValue(config.token) ??
  "";

const env = {
  ...process.env,
  HUB_DEV_API: process.env.HUB_DEV_API ?? `http://${proxyHost}:${port}`,
  ...(token ? { HUB_DEV_TOKEN: token } : {}),
};

const child = spawn(
  "pnpm",
  ["--filter", "@amoshydra/oktoso-even-g2", "dev"],
  { env, stdio: "inherit" },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
