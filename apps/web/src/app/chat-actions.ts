import type { Message } from "@amoshydra/oktoso-contracts";

/** The text a message copy action should place on the clipboard. */
export function messageCopyText(message: Message): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

/** Appends a dictation transcript to the current draft without losing a space. */
export function appendTranscript(current: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return current;
  if (!current) return next;
  return /[\s\n]$/.test(current) ? `${current}${next}` : `${current} ${next}`;
}

/** Formats the recording timer as m:ss. */
export function formatDictationDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Picks the first audio container the browser can record. Returns undefined
 * when the browser has no MediaRecorder support or no known type.
 */
export function pickAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}
