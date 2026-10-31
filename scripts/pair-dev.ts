import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env.local");
} catch {
  // .env.local is optional; the dev default matches scripts/dev.ts.
}

const env = {
  ...process.env,
  HUB_TOKEN: process.env.HUB_TOKEN ?? "dev-token-agent-hub",
};

const child = spawn(
  "pnpm",
  [
    "exec",
    "tsx",
    "packages/hub/src/main.ts",
    "--pair",
    "--config",
    "hub.config.dev.json",
  ],
  { stdio: "inherit", env },
);

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
