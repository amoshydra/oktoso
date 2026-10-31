import stringWidth from "string-width";

export interface Theme {
  color: boolean;
  accent(value: string): string;
  muted(value: string): string;
  faint(value: string): string;
  success(value: string): string;
  warning(value: string): string;
  danger(value: string): string;
  bold(value: string): string;
}

export function createTheme(color: boolean): Theme {
  const sgr = (code: string) => (value: string) =>
    color ? `\x1b[${code}m${value}\x1b[0m` : value;

  return {
    color,
    accent: sgr("36"),
    muted: sgr("90"),
    faint: sgr("2"),
    success: sgr("32"),
    warning: sgr("33"),
    danger: sgr("31"),
    bold: sgr("1"),
  };
}

export function visibleWidth(value: string): number {
  return stringWidth(value);
}

export function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;

  let output = "";
  for (const char of value) {
    if (visibleWidth(`${output}${char}`) > width - 1) break;
    output += char;
  }
  return `${output}…`;
}

export function padEnd(value: string, width: number): string {
  const remaining = width - visibleWidth(value);
  return remaining > 0 ? `${value}${" ".repeat(remaining)}` : value;
}

export function padStart(value: string, width: number): string {
  const remaining = width - visibleWidth(value);
  return remaining > 0 ? `${" ".repeat(remaining)}${value}` : value;
}

export function center(value: string, width: number): string {
  const remaining = Math.max(0, width - visibleWidth(value));
  const left = Math.floor(remaining / 2);
  return `${" ".repeat(left)}${value}`;
}

export function wrap(value: string, width: number): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];

  for (const paragraph of value.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (visibleWidth(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (visibleWidth(word) <= width) {
        current = word;
        continue;
      }
      let chunk = "";
      for (const char of word) {
        if (visibleWidth(`${chunk}${char}`) > width) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    if (current) lines.push(current);
  }

  return lines;
}
