import { networkInterfaces } from "node:os";
import type { HubConfig } from "../config/schema";

export function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

export function hubBaseUrls(
  config: Pick<HubConfig, "host" | "port">,
): string[] {
  const hosts: string[] = [];

  if (isWildcardHost(config.host)) {
    hosts.push("127.0.0.1");
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.internal) continue;
        if (entry.family === "IPv4") {
          hosts.push(entry.address);
        } else if (
          entry.family === "IPv6" &&
          !entry.address.toLowerCase().startsWith("fe80:")
        ) {
          hosts.push(`[${entry.address}]`);
        }
      }
    }
  } else {
    hosts.push(formatHost(config.host));
  }

  return [...new Set(hosts)].map((host) => `http://${host}:${config.port}`);
}

export function pairingRequestUrl(
  config: Pick<HubConfig, "host" | "port">,
): string {
  if (!isWildcardHost(config.host)) {
    return `http://${formatHost(config.host)}:${config.port}`;
  }
  return `http://127.0.0.1:${config.port}`;
}

export function webUrl(config: Pick<HubConfig, "host" | "port">): string {
  const host = isWildcardHost(config.host)
    ? "127.0.0.1"
    : formatHost(config.host);
  return `http://${host}:${config.port}`;
}
