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
  const normalized = value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const text = rawLine.replace(/ +/g, " ").trim();
    if (!text) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }

    let line = "";
    for (const rawWord of text.split(" ")) {
      let word = rawWord;
      while (word.length > maxCharactersPerLine) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(word.slice(0, maxCharactersPerLine));
        word = word.slice(maxCharactersPerLine);
      }
      if (!word) continue;
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxCharactersPerLine) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const truncated = lines.length > maxLines;
  if (truncated) lines.length = Math.max(0, maxLines);
  if (truncated && maxLines > 0) {
    const last = lines[maxLines - 1] ?? "";
    lines[maxLines - 1] =
      last.length >= maxCharactersPerLine
        ? `${last.slice(0, Math.max(0, maxCharactersPerLine - 1))}…`
        : `${last}…`;
  }
  return lines;
}

export function plainTextForGlass(value: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(rawLine)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      lines.push(rawLine);
      continue;
    }

    let line = rawLine
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*]\s+/, "• ")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "");
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) line = "";
    lines.push(line);
  }
  return lines.join("\n");
}

export function frameSignature(
  header: string,
  body: string,
  footer: string,
  listItems?: string[],
): string {
  return [
    listItems ? "list" : "text",
    header,
    body,
    footer,
    listItems?.join("\u001f") ?? "",
  ].join("\u001e");
}

export function chatScrollStep(burst: number): number {
  if (burst >= 4) return 4;
  if (burst >= 2) return 2;
  return 1;
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
