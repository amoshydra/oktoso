import { networkInterfaces } from "node:os";
import type { HubConfig } from "../config/schema";

export function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}

export type UrlConfig = Pick<HubConfig, "host" | "port"> & {
  publicUrl?: string;
};

function externalUrl(config: UrlConfig): string | undefined {
  const value = config.publicUrl?.trim();
  return value ? value.replace(/\/+$/, "") : undefined;
}

export function hubBaseUrls(config: UrlConfig): string[] {
  const external = externalUrl(config);
  if (external) return [external];

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

export function pairingRequestUrl(config: UrlConfig): string {
  const external = externalUrl(config);
  if (external) return external;
  if (!isWildcardHost(config.host)) {
    return `http://${formatHost(config.host)}:${config.port}`;
  }
  return `http://127.0.0.1:${config.port}`;
}

export function webUrl(config: UrlConfig): string {
  const external = externalUrl(config);
  if (external) return external;
  const host = isWildcardHost(config.host)
    ? "127.0.0.1"
    : formatHost(config.host);
  return `http://${host}:${config.port}`;
}
