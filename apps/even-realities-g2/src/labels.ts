import type {
  Attention,
  AttentionType,
  Session,
} from "@amoshydra/oktoso-contracts";
import { clampLine } from "@amoshydra/oktoso-wearable-core";

export const SUBAGENT_GLYPH = "›";

const ATTENTION_GLYPHS: Record<AttentionType, string> = {
  permission: "■",
  approval: "▲",
  question: "?",
  unread: "●",
  error: "!",
};

export function attentionGlyph(type: AttentionType): string {
  return ATTENTION_GLYPHS[type] ?? "◆";
}

export function subagentPrefix(parentRef?: string): string {
  return parentRef ? SUBAGENT_GLYPH : "";
}

export function attentionRowLabel(item: Attention): string {
  return clampLine(
    `${subagentPrefix(item.parentRef)}${attentionGlyph(item.type)} ${item.title}`,
    54,
  );
}

export function attentionHeader(item: Attention): string {
  return clampLine(
    `${subagentPrefix(item.parentRef)}${attentionGlyph(item.type)} ${item.title}`,
    40,
  );
}

export function sessionMarker(
  parentRef: string | undefined,
  hasQuestion: boolean,
): string {
  const parent = subagentPrefix(parentRef);
  const glyph = hasQuestion ? "?" : "";
  return parent && glyph
    ? `${parent}${glyph} `
    : parent
      ? `${parent} `
      : glyph
        ? `${glyph} `
        : "";
}

export function sessionGlyph(
  session: Session,
  hasQuestion: boolean,
): string {
  if (hasQuestion) return "?";
  if (session.status === "error") return "!";
  if (session.unread) return "●";
  if (session.status === "running") return "▶";
  if (session.status === "offline") return "▼";
  return "◇";
}

export function sessionRowLabel(
  session: Session,
  hasQuestion: boolean,
): string {
  return clampLine(
    `${subagentPrefix(session.parentRef)}${sessionGlyph(session, hasQuestion)} ${session.title}`,
    54,
  );
}

export function sessionHeader(
  session: Pick<Session, "parentRef" | "project" | "title">,
): string {
  const title = session.project
    ? `${session.project} · ${session.title}`
    : session.title;
  return clampLine(`${subagentPrefix(session.parentRef)}${title}`, 40);
}
