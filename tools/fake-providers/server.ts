import { createFakeProviderServers } from "@agent-hub/testing";

const providers = await createFakeProviderServers();
for (const provider of providers) {
  console.log(`${provider.kind} fake provider: ${provider.url}`);
}

const shutdown = async () => {
  await Promise.all(providers.map((provider) => provider.close()));
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
