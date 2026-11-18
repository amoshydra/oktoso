import { describe, expect, it } from "vitest";
import type { AssistantView, ReplyOption } from "@amoshydra/oktoso-contracts";
import {
  GLASSES_PCM,
  pcmBytes,
  pcmChunksToWav,
  orderReplyOptions,
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

  it("puts the expected answer first on the three-choice screen", () => {
    const ordered = orderReplyOptions([
      { id: "continue", label: "Continue", text: "Continue.", source: "canned", action: "send" },
      { id: "ask", label: "Ask: Which one?", text: "Which one?", source: "model", action: "send", role: "ask" },
      { id: "ack", label: "Thanks, looks good.", text: "Thanks, looks good.", source: "canned", action: "send", role: "answer" },
      { id: "next", label: "Next: Show the diff.", text: "Show the diff.", source: "model", action: "send", role: "next" },
    ]);

    expect(ordered.map((option) => option.id)).toEqual([
      "ack",
      "ask",
      "next",
      "continue",
    ]);
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

  it("reads a typed-array audio frame as its own bytes", () => {
    const frame = new Uint8Array([0, 1, 2, 3]);

    expect(pcmBytes(frame)).toBe(frame);
  });

  it("reads a plain number list as bytes", () => {
    expect([...pcmBytes([0, 1, 255, 256, -1])!]).toEqual([0, 1, 255, 0, 255]);
  });

  it("reads an ArrayBuffer and a view over one", () => {
    const buffer = new Uint8Array([9, 8, 7, 6]).buffer;
    expect([...pcmBytes(buffer)!]).toEqual([9, 8, 7, 6]);
    expect([...pcmBytes(new Uint16Array(buffer, 0, 1))!]).toEqual([9, 8]);
  });

  it("reads a base64 frame", () => {
    expect([...pcmBytes(btoa("\x00\x01\x02\xff"))!]).toEqual([0, 1, 2, 255]);
  });

  it("rejects anything that is not a byte frame", () => {
    expect(pcmBytes(undefined)).toBeUndefined();
    expect(pcmBytes(null)).toBeUndefined();
    expect(pcmBytes({ audioPcm: [1, 2] })).toBeUndefined();
    expect(pcmBytes([1, "2"])).toBeUndefined();
    expect(pcmBytes([1, Number.NaN])).toBeUndefined();
    expect(pcmBytes("not base64 !!")).toBeUndefined();
  });
});
