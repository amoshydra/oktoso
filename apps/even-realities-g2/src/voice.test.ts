import { describe, expect, it } from "vitest";
import type { AssistantView, ReplyOption } from "@amoshydra/oktoso-contracts";
import {
  GLASSES_PCM,
  pcmChunksToWav,
  pcmToWav,
  transcriptionConfigured,
  withVoiceOption,
} from "./voice";

function assistantView(
  transcription: Partial<AssistantView["transcription"]> = {},
): AssistantView {
  return {
    reply: {
      enabled: true,
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "gemma",
      timeoutMs: 8_000,
      hasApiKey: false,
      disableThinking: true,
    },
    transcription: {
      enabled: true,
      baseUrl: "http://127.0.0.1:9000/v1",
      model: "whisper",
      timeoutMs: 20_000,
      hasApiKey: false,
      ...transcription,
    },
  };
}

const options: ReplyOption[] = [
  { id: "continue", label: "Continue", text: "Continue.", source: "canned", action: "send" },
  { id: "phone", label: "Phone keyboard", text: "", source: "canned", action: "phone" },
];

describe("G2 voice helpers", () => {
  it("uses the documented 16 kHz mono PCM format", () => {
    const pcm = new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(GLASSES_PCM.channels);
    expect(view.getUint32(24, true)).toBe(GLASSES_PCM.sampleRate);
    expect(view.getUint16(34, true)).toBe(GLASSES_PCM.bitsPerSample);
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);
    expect([...wav.slice(44)]).toEqual([...pcm]);
  });

  it("concatenates PCM chunks in order", () => {
    const wav = pcmChunksToWav([
      new Uint8Array([1, 0]),
      new Uint8Array([2, 0, 3, 0]),
    ]);

    expect([...wav.slice(44)]).toEqual([1, 0, 2, 0, 3, 0]);
  });

  it("hides voice when transcription is not configured", () => {
    expect(transcriptionConfigured(undefined)).toBe(false);
    expect(
      transcriptionConfigured(assistantView({ enabled: false })),
    ).toBe(false);
    expect(transcriptionConfigured(assistantView({ baseUrl: "" }))).toBe(false);
    expect(transcriptionConfigured(assistantView({ model: "" }))).toBe(false);
    expect(transcriptionConfigured(assistantView())).toBe(true);
  });

  it("inserts voice before the phone keyboard option", () => {
    const withVoice = withVoiceOption(options, true);
    expect(withVoice.map((option) => option.action)).toEqual([
      "send",
      "voice",
      "phone",
    ]);
    expect(withVoiceOption(options, false)).toBe(options);
    expect(withVoiceOption(withVoice, true)).toBe(withVoice);
  });
});
