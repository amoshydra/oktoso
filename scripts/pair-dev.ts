import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // .env.local is optional; the dev default matches scripts/dev.ts.
}

const configPath = "hub.config.dev.json";
// The hub refuses a config that other accounts can read. Git cannot store 0600.
await chmod(configPath, 0o600).catch(() => undefined);

const env = {
  ...process.env,
  HUB_TOKEN: process.env.HUB_TOKEN ?? "dev-token-oktoso",
};

const child = spawn(
  "pnpm",
  [
    "exec",
    "tsx",
    "packages/hub/src/main.ts",
    "--pair",
    "--config",
    configPath,
  ],
  { stdio: "inherit", env },
);

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
