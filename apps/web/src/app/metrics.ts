/**
 * Metric formatters for activity tiles.
 *
 * Tiles have room for about eight characters at 10px, so every value is
 * abbreviated and the exact figure moves to the tooltip and the step panel.
 */

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "–";
  const n = Math.max(0, value);
  if (n < 1000) return String(Math.round(n));
  if (n < 999_500) {
    const k = n / 1000;
    return `${k < 10 ? trim(k.toFixed(1)) : Math.round(k)}k`;
  }
  if (n < 999_500_000) {
    const m = n / 1_000_000;
    return `${m < 10 ? trim(m.toFixed(1)) : Math.round(m)}M`;
  }
  const b = n / 1_000_000_000;
  return `${b < 10 ? trim(b.toFixed(1)) : Math.round(b)}B`;
}

export function formatBytes(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  const n = Math.max(0, ms);
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${trim((n / 1000).toFixed(1))} s`;
  if (n < 3_600_000) return `${trim((n / 60_000).toFixed(1))} m`;
  if (n < 86_400_000) return `${trim((n / 3_600_000).toFixed(1))} h`;
  return `${trim((n / 86_400_000).toFixed(1))} d`;
}

export function formatChars(chars: number): string {
  return `${compactNumber(chars)} ch`;
}

export function formatLines(lines: number): string {
  return `${compactNumber(lines)} ln`;
}

export function formatHits(hits: number): string {
  return hits < 1000 ? `${hits} ${hits === 1 ? "hit" : "hits"}` : compactNumber(hits);
}

export function formatFiles(files: number): string {
  return files < 1000 ? `${files} ${files === 1 ? "file" : "files"}` : compactNumber(files);
}

export function formatExit(code: number, signal?: number | string): string {
  if (signal !== undefined && signal !== null && signal !== 0) {
    return `sig ${signal}`;
  }
  return `exit ${code}`;
}

export function formatDiff(adds: number, removes: number): string {
  if (adds + removes >= 1000) return `+${compactNumber(adds + removes)}`;
  return `+${adds} −${removes}`;
}

export function formatPixels(width: number, height: number): string {
  const side = (value: number) =>
    value < 1000 ? String(value) : `${Math.round(value / 1000)}k`;
  return `${side(width)}×${side(height)}`;
}

function trim(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
