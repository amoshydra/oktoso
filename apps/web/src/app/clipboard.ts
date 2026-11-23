export interface ClipboardDataLike {
  files?: ArrayLike<File>;
  items?: ArrayLike<{
    kind: string;
    getAsFile(): File | null;
  }>;
}

/**
 * Copy text, falling back to a hidden selection on non-secure origins where
 * `navigator.clipboard` is unavailable.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection fallback.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
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
