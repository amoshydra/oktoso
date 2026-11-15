export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Splits text into plain and matched parts for a search snippet.
 *
 * Matches whole words only, case-insensitively, so "auth" does not light up
 * inside "author". The caller renders the matched parts as `<mark>`.
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 1),
    ),
  ];
  if (terms.length === 0) return [{ text, match: false }];

  const escaped = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped.join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  );

  const parts: HighlightPart[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: match[0], match: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
