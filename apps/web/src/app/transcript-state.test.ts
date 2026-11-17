import { describe, expect, it } from "vitest";
import { transcriptPhase } from "./transcript-state";

const base = { loading: false, error: undefined, messageCount: 0, running: false };

describe("transcriptPhase", () => {
  it("is ready whenever there is a message, even while loading or failing", () => {
    expect(transcriptPhase({ ...base, messageCount: 1 })).toBe("ready");
    expect(transcriptPhase({ ...base, messageCount: 1, loading: true })).toBe("ready");
    expect(transcriptPhase({ ...base, messageCount: 2, error: "boom" })).toBe("ready");
  });

  it("is loading during the first fetch", () => {
    expect(transcriptPhase({ ...base, loading: true })).toBe("loading");
  });

  it("is an error before it is empty", () => {
    expect(transcriptPhase({ ...base, error: "Unable to load" })).toBe("error");
    expect(
      transcriptPhase({ ...base, error: "Unable to load", loading: true }),
    ).toBe("error");
  });

  it("waits while a running session has written nothing yet", () => {
    expect(transcriptPhase({ ...base, running: true })).toBe("waiting");
  });

  it("is empty only after a successful load returns nothing", () => {
    expect(transcriptPhase(base)).toBe("empty");
  });
});
