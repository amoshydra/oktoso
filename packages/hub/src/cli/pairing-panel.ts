import { renderUnicodeCompact } from "uqr";
import type { Theme } from "./terminal";
import { center, padEnd, truncate, visibleWidth } from "./terminal";
import type { PairingLinkInfo } from "./types";

export function pairingUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/pair/${code}`;
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

function isIpv4Url(value: string): boolean {
  try {
    return /^\d+\.\d+\.\d+\.\d+$/.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function primaryPairingUrl(urls: string[]): string | undefined {
  return (
    urls.find((url) => !isLoopbackUrl(url) && isIpv4Url(url)) ??
    urls.find((url) => !isLoopbackUrl(url)) ??
    urls[0]
  );
}

export function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatCountdown(expiresAt: number, now = Date.now()): string {
  const remaining = Math.max(0, expiresAt - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function renderQrLines(
  value: string,
  maxWidth: number,
): string[] | undefined {
  const qr = renderUnicodeCompact(value, { ecc: "L", border: 1 });
  const lines = qr.split("\n");
  const width = Math.max(...lines.map((line) => visibleWidth(line)));
  return width > maxWidth ? undefined : lines;
}

export function boxedPanel(input: {
  lines: string[];
  width: number;
  title: string;
  right?: string;
  theme: Theme;
}): string[] {
  const { theme } = input;
  const width = Math.max(24, input.width);
  const inner = width - 4;
  const plain = input.lines.map((line) => truncate(line, inner));

  const title = truncate(input.title, Math.max(8, inner - 4));
  const right = input.right ? truncate(input.right, Math.max(4, inner - 8)) : "";
  const fixed = right ? 8 + visibleWidth(right) : 6;
  const fill = Math.max(1, width - fixed - visibleWidth(title));

  const top = `${theme.muted("╭─")} ${theme.bold(title)} ${theme.muted("─".repeat(fill))}${
    right ? `${theme.muted("─")} ${theme.accent(right)}` : ""
  } ${theme.muted("╮")}`;

  const rows = plain.map(
    (line) => `${theme.muted("│")} ${padEnd(line, inner)} ${theme.muted("│")}`,
  );
  const bottom = `${theme.muted("╰")}${theme.muted("─".repeat(width - 2))}${theme.muted("╯")}`;

  return [top, ...rows, bottom];
}

export function buildPairingPanel(input: {
  pairing: PairingLinkInfo;
  urls: string[];
  theme: Theme;
  width: number;
  hint: string;
  now?: number;
}): string[] {
  const linkBase = primaryPairingUrl(input.urls);
  if (!linkBase) {
    return ["No server URLs available. Bind a reachable host or pass --url."];
  }

  const link = pairingUrl(linkBase, input.pairing.code);
  const expires = formatExpiry(input.pairing.expiresAt);
  const remaining = Math.max(
    1,
    Math.round((input.pairing.expiresAt - (input.now ?? Date.now())) / 60_000),
  );
  const qr = renderQrLines(link, Math.max(18, input.width - 6));

  const lines: string[] = [
    truncate(link, Math.max(18, input.width - 6)),
    `Expires at ${expires} (in ${remaining} minute${remaining === 1 ? "" : "s"})`,
    "",
    ...(qr
      ? qr.map((line) => center(line, Math.max(18, input.width - 6)))
      : (["QR hidden: terminal is too narrow.", ""] as string[])),
    "",
    "Scan with your phone camera or open the link.",
    input.hint,
  ];

  return boxedPanel({
    lines,
    width: input.width,
    title: "Pair a device",
    right: qr ? formatCountdown(input.pairing.expiresAt, input.now) : undefined,
    theme: input.theme,
  });
}
