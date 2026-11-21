import { describe, expect, it } from "vitest";
import {
  MAX_MEDIA_RESOURCE_BYTES,
  MAX_RESOURCE_BYTES,
} from "@amoshydra/oktoso-providers";
import { mediaMaxBytes } from "./resource-response";

describe("mediaMaxBytes", () => {
  it("gives audio and video the streaming cap", () => {
    expect(MAX_MEDIA_RESOURCE_BYTES).toBeGreaterThan(MAX_RESOURCE_BYTES);
    for (const path of [
      "tmp/site/clip.mp4",
      "clip.mov",
      "clip.webm",
      "clip.m4v",
      "track.mp3",
      "track.wav",
      "https://provider.test/api/fs/read/a/clip.mp4?location=%2Frepo",
    ]) {
      expect(mediaMaxBytes(path)).toBe(MAX_MEDIA_RESOURCE_BYTES);
    }
  });

  it("keeps the 20 MB cap for everything else", () => {
    expect(mediaMaxBytes("notes/plan.md")).toBeUndefined();
    expect(mediaMaxBytes("plots/chart.png")).toBeUndefined();
    expect(mediaMaxBytes("bundle.zip")).toBeUndefined();
    expect(mediaMaxBytes(undefined)).toBeUndefined();
  });
});
