import { HubClient } from "@amoshydra/oktoso-client";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadPairingConfig } from "../config/load";
import { VERSION } from "../version";
import { createOktosoMcpServer, type McpHubApi } from "../mcp/server";
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
  const api: McpHubApi = {
    providers: () => client.providers(),
    checkProvider: (id) => client.checkProvider(id),
    sessions: (query) => client.sessions(query),
    session: (ref) => client.session(ref),
    messages: (ref, query) => client.messages(ref, query),
    question: (ref) => client.question(ref),
    attention: (query) => client.attention(query),
    sendMessage: (ref, input, options) =>
      client.sendMessage(ref, input, options),
    createSession: (input) => client.createSession(input),
    interrupt: (ref) => client.interrupt(ref),
    markRead: (ref) => client.markRead(ref),
    actOnAttention: (id, action, input) =>
      client.actOnAttention(id, action, input),
    automation: () => client.automation(),
    automationRuns: (limit) => client.automationRuns(limit),
    approvals: () => client.automationApprovals(),
    setAutomation: (input) => client.saveAutomation(input),
    setWatcherPaused: (id, paused) => client.pauseWatcher(id, paused),
    actOnApproval: (id, action) => client.actOnApproval(id, action),
  };
  const server = createOktosoMcpServer({
    api,
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
