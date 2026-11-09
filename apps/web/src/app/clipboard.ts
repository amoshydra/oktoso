export interface ClipboardDataLike {
  files?: ArrayLike<File>;
  items?: ArrayLike<{
    kind: string;
    getAsFile(): File | null;
  }>;
}

/**
 * Extract files from a clipboard payload. Browsers populate `files` for most
 * pasted files, but some image sources only expose a file item, so fall back to
 * scanning the items list. Do not duplicate when both are present.
 */
export function pastedFiles(data: ClipboardDataLike | null | undefined): File[] {
  if (!data) return [];
  const files = data.files ? Array.from(data.files) : [];
  if (files.length > 0) return files;
  if (!data.items) return [];
  const result: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) result.push(file);
  }
  return result;
}
