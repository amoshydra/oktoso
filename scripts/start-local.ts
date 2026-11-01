import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // .env.local is optional for a local built server.
}

const configPath = process.env.HUB_CONFIG ?? "hub.config.dev.json";
// The hub refuses a config that other accounts can read. Git cannot store 0600.
await chmod(configPath, 0o600).catch(() => undefined);

const env = {
  ...process.env,
  HUB_CONFIG: configPath,
  HUB_HOST: process.env.HUB_HOST ?? "0.0.0.0",
  HUB_TOKEN: process.env.HUB_TOKEN ?? "dev-token-oktoso",
  OPENCODE_BASE_URL: process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4101",
  OPENCODE_USERNAME: process.env.OPENCODE_USERNAME ?? "opencode",
  OPENCODE_PASSWORD: process.env.OPENCODE_PASSWORD ?? "dev-opencode-password",
  OPENWEBUI_BASE_URL: process.env.OPENWEBUI_BASE_URL ?? "http://127.0.0.1:4102",
  OPENWEBUI_API_KEY: process.env.OPENWEBUI_API_KEY ?? "dev-openwebui-key",
  HERMES_API_KEY: process.env.HERMES_API_KEY ?? "dev-hermes-key",
};

const child = spawn(process.execPath, ["dist/hub.js"], {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
