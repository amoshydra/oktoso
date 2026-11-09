import { describe, expect, it } from "vitest";
import { pastedFiles } from "./clipboard";

function image(name = "clipboard.png", type = "image/png"): File {
  return new File(["image"], name, { type });
}

describe("pastedFiles", () => {
  it("uses the files list when present", () => {
    const file = image();
    expect(pastedFiles({ files: [file] })).toEqual([file]);
  });

  it("falls back to file items when files are empty", () => {
    const file = image("pasted.webp", "image/webp");
    const result = pastedFiles({
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => file },
        { kind: "file", getAsFile: () => null },
      ],
    });
    expect(result).toEqual([file]);
  });

  it("does not duplicate files when both lists are present", () => {
    const file = image();
    const result = pastedFiles({
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
    });
    expect(result).toEqual([file]);
  });

  it("returns an empty list for empty or missing clipboard data", () => {
    expect(pastedFiles(undefined)).toEqual([]);
    expect(pastedFiles(null)).toEqual([]);
    expect(pastedFiles({})).toEqual([]);
  });
});
