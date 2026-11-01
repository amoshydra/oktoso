import { HubClient } from "@amoshydra/oktoso-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadPairingConfig } from "../config/load";
import { VERSION } from "../version";
import { createOktosoMcpServer } from "./mcp";
import { pairingRequestUrl } from "./urls";

export interface McpCommandOptions {
  configPath: string;
  url?: string;
  allowWrite: boolean;
}

export async function runMcpCommand(
  options: McpCommandOptions,
): Promise<void> {
  const config = await loadPairingConfig(options.configPath);
  const baseUrl =
    options.url ?? process.env.HUB_URL ?? pairingRequestUrl(config);
  const client = new HubClient({ baseUrl, token: config.token });
  const server = createOktosoMcpServer({
    api: client,
    version: VERSION,
    allowWrite: options.allowWrite,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `oktoso mcp: ${baseUrl} (${options.allowWrite ? "read-write" : "read-only"})\n`,
  );

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
