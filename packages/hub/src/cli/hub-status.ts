import { connect } from "node:net";
import type { HubConfig } from "../config/schema";
import {
  formatHost,
  isWildcardHost,
  pairingRequestUrl,
  webUrl,
} from "./urls";

export interface HubProbe {
  endpoint: string;
  version: string;
  pid?: number;
  uptimeMs: number;
  eventSeq: number;
}

export async function probeHub(
  config: Pick<HubConfig, "host" | "port">,
): Promise<HubProbe | undefined> {
  const endpoint = pairingRequestUrl(config);
  try {
    const response = await fetch(`${endpoint}/api/v1/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return undefined;

    const body = (await response.json()) as {
      ok?: unknown;
      version?: unknown;
      pid?: unknown;
      uptimeMs?: unknown;
      eventSeq?: unknown;
    };
    if (body.ok !== true || typeof body.version !== "string") {
      return undefined;
    }

    return {
      endpoint,
      version: body.version,
      ...(typeof body.pid === "number" ? { pid: body.pid } : {}),
      uptimeMs:
        typeof body.uptimeMs === "number" && Number.isFinite(body.uptimeMs)
          ? body.uptimeMs
          : 0,
      eventSeq:
        typeof body.eventSeq === "number" && Number.isFinite(body.eventSeq)
          ? body.eventSeq
          : 0,
    };
  } catch {
    return undefined;
  }
}

export function isPortOpen(
  config: Pick<HubConfig, "host" | "port">,
): Promise<boolean> {
  const host = isWildcardHost(config.host)
    ? "127.0.0.1"
    : formatHost(config.host).replace(/^\[|\]$/g, "");

  return new Promise((resolve) => {
    const socket = connect({ host, port: config.port });
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(400);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(uptimeMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatHubStatus(
  probe: HubProbe,
  config: Pick<HubConfig, "host" | "port">,
  options: { alreadyRunning?: boolean } = {},
): string {
  const url = webUrl(config);
  const lines = [
    `Oktoso ${probe.version} is ${options.alreadyRunning ? "already " : ""}running at ${url}`,
    `  ${probe.pid ? `pid ${probe.pid} · ` : ""}up ${formatUptime(probe.uptimeMs)} · event seq ${probe.eventSeq}`,
    "",
    `  Web UI   ${url}`,
    "  Pair     npx @amoshydra/oktoso pair",
    "  Status   npx @amoshydra/oktoso status",
  ];

  if (probe.pid) {
    lines.push(
      `  Stop     Ctrl+C in the original terminal, or ${
        process.platform === "win32"
          ? `taskkill /PID ${probe.pid}`
          : `kill ${probe.pid}`
      }`,
    );
  } else {
    lines.push("  Stop     Ctrl+C in the original terminal");
  }

  return lines.join("\n");
}
