import { describe, expect, it } from "vitest";
import { collectToolImages, sanitizeToolOutput } from "./tool-images";

describe("collectToolImages", () => {
  it("collects the file part shape returned by image-aware tools", () => {
    expect(
      collectToolImages([
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: "data:image/jpeg;base64,/9j/AAAA" },
      ]),
    ).toEqual([
      {
        url: "data:image/jpeg;base64,/9j/AAAA",
        name: "Image 1",
        mimeType: undefined,
      },
    ]);
  });

  it("collects provider base64, image_url, and image URL shapes", () => {
    expect(
      collectToolImages({
        source: {
          type: "base64",
          media_type: "image/png",
          data: "AAAA",
        },
      }),
    ).toEqual([
      {
        url: "data:image/png;base64,AAAA",
        name: "Image 1",
        mimeType: "image/png",
      },
    ]);

    expect(
      collectToolImages({
        image_url: { url: "https://example.test/shot.png" },
      }),
    ).toEqual([
      {
        url: "https://example.test/shot.png",
        name: "Image 1",
        mimeType: undefined,
      },
    ]);
  });

  it("ignores text and non-image URLs", () => {
    expect(
      collectToolImages([
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: "https://example.test/report.pdf" },
      ]),
    ).toEqual([]);
  });

  it("deduplicates repeated image URLs", () => {
    expect(
      collectToolImages([
        { type: "file", uri: "data:image/png;base64,AAAA" },
        { type: "file", uri: "data:image/png;base64,AAAA" },
      ]),
    ).toHaveLength(1);
  });
});

describe("sanitizeToolOutput", () => {
  it("replaces data image payloads but keeps surrounding text", () => {
    expect(
      sanitizeToolOutput([
        { type: "text", text: "Image read successfully" },
        { type: "file", uri: "data:image/jpeg;base64,/9j/AAAA" },
      ]),
    ).toEqual([
      { type: "text", text: "Image read successfully" },
      { type: "file", uri: "[image]" },
    ]);
  });

  it("replaces a provider base64 data field", () => {
    expect(
      sanitizeToolOutput({
        type: "base64",
        media_type: "image/png",
        data: "AAAA",
      }),
    ).toEqual({
      type: "base64",
      media_type: "image/png",
      data: "[image]",
    });
  });
});
