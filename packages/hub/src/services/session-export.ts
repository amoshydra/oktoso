import type { Message, Session } from "@amoshydra/oktoso-contracts";

export interface SessionExportInput {
  session: Session;
  messages: Message[];
  exportedAt: number;
}

/** Markdown transcript with a header block and one section per message. */
export function exportMarkdown(input: SessionExportInput): string {
  const { session, messages, exportedAt } = input;
  const lines: string[] = [];
  lines.push(`# ${session.title}`, "");
  lines.push(`- Session: \`${session.ref}\``);
  lines.push(`- Provider: ${session.providerID}`);
  if (session.project) lines.push(`- Project: ${session.project}`);
  if (session.directory) lines.push(`- Directory: \`${session.directory}\``);
  if (session.agent) lines.push(`- Agent: ${session.agent}`);
  if (session.model) lines.push(`- Model: \`${session.model}\``);
  lines.push(`- Status: ${session.status}`);
  lines.push(`- Created: ${new Date(session.createdAt).toISOString()}`);
  lines.push(`- Updated: ${new Date(session.updatedAt).toISOString()}`);
  lines.push(`- Exported: ${new Date(exportedAt).toISOString()}`, "");

  if (messages.length === 0) {
    lines.push("_No messages._", "");
    return lines.join("\n");
  }

  lines.push("---", "");
  for (const message of messages) {
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim();
    const tools = message.parts.filter((part) => part.type === "tool").length;
    const attachments = message.parts.filter((part) => part.type === "file").length;
    lines.push(
      `## ${message.role} · ${new Date(message.createdAt).toISOString()}`,
      "",
    );
    if (text) lines.push(text, "");
    if (tools > 0) {
      lines.push(`_${tools} tool call${tools === 1 ? "" : "s"} omitted._`, "");
    }
    if (attachments > 0) {
      lines.push(
        `_${attachments} attachment${attachments === 1 ? "" : "s"} not embedded._`,
        "",
      );
    }
    if (!text && tools === 0 && attachments === 0) {
      lines.push("_No text._", "");
    }
  }
  return lines.join("\n");
}

/** Machine-readable export: the session, the transcript, and the export time. */
export function exportJson(input: SessionExportInput): string {
  return JSON.stringify(
    {
      exportedAt: new Date(input.exportedAt).toISOString(),
      session: input.session,
      messages: input.messages,
    },
    null,
    2,
  );
}

export function exportFilename(
  session: Session,
  format: "md" | "json",
): string {
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const date = new Date(session.updatedAt).toISOString().slice(0, 10);
  const base = slug.length > 0 ? slug : "session";
  return `${session.providerID}-${base}-${date}.${format}`;
}
