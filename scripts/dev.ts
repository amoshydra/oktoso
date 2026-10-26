import { spawn, type ChildProcess } from "node:child_process";
import { createFakeProviderServers } from "@agent-hub/testing";

const token = "dev-token-agent-hub";
const providers = await createFakeProviderServers();
const children: ChildProcess[] = [];
let shuttingDown = false;

for (const provider of providers) {
  console.log(`${provider.kind} fake provider: ${provider.url}`);
}

const env = {
  ...process.env,
  HUB_TOKEN: token,
  OPENCODE_PASSWORD: "dev-opencode-password",
  OPENWEBUI_API_KEY: "dev-openwebui-key",
  HERMES_API_KEY: "dev-hermes-key",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "debug",
};

const hub = spawn(
  "pnpm",
  ["exec", "tsx", "packages/hub/src/main.ts", "--config", "hub.config.dev.json"],
  { stdio: "inherit", env },
);
const web = spawn(
  "pnpm",
  ["--filter", "@agent-hub/web", "dev"],
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
