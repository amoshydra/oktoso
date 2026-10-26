export const WEARABLE_CHOICES_PER_PAGE = 3;

export interface WearableChoice {
  id: string;
  label: string;
  text?: string;
  action?: string;
}

export function wrapText(
  value: string,
  maxCharactersPerLine: number,
  maxLines: number,
): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + 1 + word.length <= maxCharactersPerLine) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines) {
    const joined = lines.join(" ");
    if (joined.length < value.replace(/\s+/g, " ").trim().length) {
      const last = lines[maxLines - 1] ?? "";
      lines[maxLines - 1] =
        last.length >= maxCharactersPerLine
          ? `${last.slice(0, Math.max(0, maxCharactersPerLine - 1))}…`
          : `${last}…`;
    }
  }
  return lines;
}

export function clampLine(value: string, maxCharacters: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxCharacters
    ? clean
    : `${clean.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

export function parseNumberedChoices(text: string, limit = 5): string[] {
  const choices: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/);
    if (!match?.[1]) continue;
    const choice = match[1]
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (choice) choices.push(choice);
    if (choices.length >= limit) break;
  }
  return [...new Set(choices)];
}

export function pageChoices<T>(
  choices: T[],
  page: number,
  perPage = WEARABLE_CHOICES_PER_PAGE,
): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(choices.length / perPage));
  const current = Math.min(Math.max(page, 0), pages - 1);
  return {
    items: choices.slice(current * perPage, current * perPage + perPage),
    page: current,
    pages,
  };
}
