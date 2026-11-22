import { describe, expect, it } from "vitest";
import type { ProviderResourceOpen } from "@amoshydra/oktoso-providers";
import {
  MAX_MEDIA_RESOURCE_BYTES,
  MAX_RESOURCE_BYTES,
} from "@amoshydra/oktoso-providers";
import {
  applyRange,
  mediaMaxBytes,
  openBufferedResource,
} from "./resource-response";

function streamOf(text: string, chunk = 3): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunk));
      offset += chunk;
    },
  });
}

async function bodyOf(opened: ProviderResourceOpen): Promise<string> {
  if (opened.status === 416) throw new Error("unsatisfiable");
  return new Response(opened.stream).text();
}

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

describe("applyRange", () => {
  const opened = (): ProviderResourceOpen => ({
    status: 200,
    stream: streamOf("abcdefghij"),
    contentType: "video/mp4",
    contentLength: 10,
  });

  it("relays a range the provider already honored", () => {
    const ranged: ProviderResourceOpen = {
      status: 206,
      stream: streamOf("cd"),
      contentLength: 2,
      contentRange: "bytes 2-3/10",
      totalBytes: 10,
    };
    expect(applyRange(ranged, "bytes=2-3")).toBe(ranged);
  });

  it("slices a provider that ignored the range", async () => {
    const ranged = applyRange(opened(), "bytes=2-5");
    expect(ranged.status).toBe(206);
    if (ranged.status === 416) throw new Error("unsatisfiable");
    expect(ranged.contentLength).toBe(4);
    expect(ranged.contentRange).toBe("bytes 2-5/10");
    expect(await bodyOf(ranged)).toBe("cdef");
  });

  it("serves a suffix range from the end", async () => {
    const ranged = applyRange(opened(), "bytes=-2");
    if (ranged.status === 416) throw new Error("unsatisfiable");
    expect(ranged.contentRange).toBe("bytes 8-9/10");
    expect(await bodyOf(ranged)).toBe("ij");
  });

  it("reports an unsatisfiable range with the resource size", () => {
    const ranged = applyRange(opened(), "bytes=99-100");
    expect(ranged).toEqual({ status: 416, totalBytes: 10 });
  });

  it("leaves a size-less response whole, because 206 needs a length", async () => {
    const unknown: ProviderResourceOpen = { status: 200, stream: streamOf("abcdefghij") };
    const ranged = applyRange(unknown, "bytes=2-5");
    expect(ranged.status).toBe(200);
    expect(await bodyOf(ranged)).toBe("abcdefghij");
  });
});

describe("openBufferedResource", () => {
  it("serves an adapter without a streaming path through the same shape", async () => {
    const opened = openBufferedResource(
      {
        body: new TextEncoder().encode("abcdefghij"),
        contentType: "text/plain",
        filename: "notes.txt",
      },
      "bytes=1-3",
    );
    expect(opened.status).toBe(206);
    if (opened.status === 416) throw new Error("unsatisfiable");
    expect(opened.contentRange).toBe("bytes 1-3/10");
    expect(opened.filename).toBe("notes.txt");
    expect(await bodyOf(opened)).toBe("bcd");
  });
});
