import { spawn, type ChildProcess } from "node:child_process";
import { chmod } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { createFakeProviderServers } from "@amoshydra/oktoso-testing";

try {
  loadEnvFile(".env.local");
} catch {
  // .env.local is optional; the fake OpenCode provider is the default.
}

const configPath = "hub.config.dev.json";
// The hub refuses a config that other accounts can read. Git cannot store 0600,
// so fix the committed dev config before every run.
await chmod(configPath, 0o600).catch(() => undefined);

const token = "dev-token-oktoso";
const providers = await createFakeProviderServers();
const children: ChildProcess[] = [];
let shuttingDown = false;

for (const provider of providers) {
  console.log(`${provider.kind} fake provider: ${provider.url}`);
}

const env = {
  ...process.env,
  HUB_TOKEN: token,
  OPENCODE_BASE_URL: process.env.OPENCODE_BASE_URL ?? "http://127.0.0.1:4101",
  OPENCODE_USERNAME: process.env.OPENCODE_USERNAME ?? "opencode",
  OPENCODE_PASSWORD: process.env.OPENCODE_PASSWORD ?? "dev-opencode-password",
  OPENWEBUI_BASE_URL: process.env.OPENWEBUI_BASE_URL ?? "http://127.0.0.1:4102",
  OPENWEBUI_API_KEY: process.env.OPENWEBUI_API_KEY ?? "dev-openwebui-key",
  HERMES_API_KEY: process.env.HERMES_API_KEY ?? "dev-hermes-key",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "debug",
  // Vite also owns the dev terminal's stdin. Use the plain output and
  // `pnpm pair:dev` instead of a TUI in development.
  HUB_PAIRING_PROMPT: "0",
  HUB_TUI: "0",
};

console.log(
  `OpenCode: ${env.OPENCODE_BASE_URL === "http://127.0.0.1:4101" ? "fake" : env.OPENCODE_BASE_URL}`,
);
console.log(
  `Open WebUI: ${env.OPENWEBUI_BASE_URL === "http://127.0.0.1:4102" ? "fake" : env.OPENWEBUI_BASE_URL}`,
);

const hub = spawn(
  "pnpm",
  ["exec", "tsx", "packages/hub/src/main.ts", "--config", configPath],
  { stdio: "inherit", env },
);
const web = spawn(
  "pnpm",
  ["--filter", "@amoshydra/oktoso-web", "dev"],
  {
    stdio: "inherit",
    env: { ...env, VITE_DEV_TOKEN: token },
  },
);
children.push(hub, web);

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await Promise.all(providers.map((provider) => provider.close()));
  setTimeout(() => process.exit(0), 250);
};

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (signal || code === 0) return;
    console.error(`child exited with code ${code}`);
    void shutdown();
  });
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
console.log(`hub dev token: ${token}`);
console.log("web: http://localhost:5175");
