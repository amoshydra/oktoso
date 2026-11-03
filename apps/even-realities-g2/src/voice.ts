import type { AssistantView, ReplyOption } from "@amoshydra/oktoso-contracts";

/** Even G2 microphone format: 16 kHz, signed 16-bit little-endian, mono. */
export const GLASSES_PCM = {
  sampleRate: 16_000,
  channels: 1,
  bitsPerSample: 16,
} as const;

export function transcriptionConfigured(
  view: AssistantView | undefined,
): boolean {
  const transcription = view?.transcription;
  return Boolean(
    transcription?.enabled &&
      transcription.baseUrl.trim() &&
      transcription.model.trim(),
  );
}

/**
 * Add a local voice action only when the hub has a usable transcription
 * endpoint. The hub does not generate this action because the web client has
 * its own dictation control.
 */
export function withVoiceOption(
  options: ReplyOption[],
  enabled: boolean,
): ReplyOption[] {
  if (!enabled || options.some((option) => option.action === "voice")) {
    return options;
  }
  const voice: ReplyOption = {
    id: "voice",
    label: "Voice reply",
    text: "",
    source: "canned",
    action: "voice",
  };
  const phoneIndex = options.findIndex((option) => option.action === "phone");
  if (phoneIndex < 0) return [...options, voice];
  return [
    ...options.slice(0, phoneIndex),
    voice,
    ...options.slice(phoneIndex),
  ];
}

export function pcmChunksToWav(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const pcm = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pcmToWav(pcm);
}

export function pcmToWav(
  pcm: Uint8Array,
  format: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  } = GLASSES_PCM,
): Uint8Array<ArrayBuffer> {
  const headerSize = 44;
  const bytesPerSample = format.bitsPerSample / 8;
  const blockAlign = format.channels * bytesPerSample;
  const byteRate = format.sampleRate * blockAlign;
  const buffer = new ArrayBuffer(headerSize + pcm.byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channels, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(pcm, headerSize);
  return bytes;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
