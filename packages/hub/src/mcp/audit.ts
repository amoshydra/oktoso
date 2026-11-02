import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Logger } from "../lib/logger";
import type { McpCallRecord } from "./server";

export interface McpAuditEntry extends McpCallRecord {
  clientId: string;
  time: string;
}

export interface McpAuditOptions {
  file?: string;
  logger: Logger;
}

export interface McpAudit {
  record(clientId: string, call: McpCallRecord): void;
  flush(): Promise<void>;
}

/**
 * Append-only JSONL audit log for hosted MCP tool calls. The log deliberately
 * records tool names and targets, never prompts or message text.
 */
export function createMcpAudit(options: McpAuditOptions): McpAudit {
  const { file, logger } = options;
  let queue = file
    ? mkdir(dirname(file), { recursive: true }).then(
        () => undefined,
        (error: unknown) => {
          logger.error("MCP audit directory could not be created", {
            error: error instanceof Error ? error.message : String(error),
          });
        },
      )
    : Promise.resolve();

  return {
    record(clientId, call) {
      const entry: McpAuditEntry = {
        time: new Date().toISOString(),
        clientId,
        ...call,
        ...(call.error ? { error: call.error.slice(0, 500) } : {}),
      };
      if (!file) {
        logger.info("MCP tool call", { ...entry });
        return;
      }
      const line = `${JSON.stringify(entry)}\n`;
      queue = queue
        .then(() => appendFile(file, line, { mode: 0o600 }))
        .catch((error: unknown) => {
          logger.error("MCP audit write failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    async flush() {
      await queue;
    },
  };
}
