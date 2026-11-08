import { describe, expect, it } from "vitest";
import type { ModelOption } from "@amoshydra/oktoso-contracts";
import { groupModelOptions, modelProviderLabel } from "./model-options";

const model = (
  id: string,
  label: string,
  provider?: string,
): ModelOption => ({
  id,
  label,
  ...(provider ? { provider } : {}),
});

describe("model option grouping", () => {
  it("preserves provider and model order while grouping", () => {
    const grouped = groupModelOptions([
      model("opencode/a", "Alpha", "opencode"),
      model("commandcode/b", "Beta", "commandcode"),
      model("opencode/c", "Charlie", "opencode"),
      model("commandcode/d", "Delta", "commandcode"),
    ]);

    expect(grouped.ungrouped).toEqual([]);
    expect(grouped.groups.map((group) => group.label)).toEqual([
      "OpenCode",
      "Command Code",
    ]);
    expect(grouped.groups[0]?.models.map((item) => item.label)).toEqual([
      "Alpha",
      "Charlie",
    ]);
    expect(grouped.groups[1]?.models.map((item) => item.label)).toEqual([
      "Beta",
      "Delta",
    ]);
  });

  it("keeps models without a provider ungrouped", () => {
    const grouped = groupModelOptions([
      model("plain", "Plain model"),
      model("opencode/a", "Alpha", "opencode"),
    ]);

    expect(grouped.ungrouped.map((item) => item.id)).toEqual(["plain"]);
    expect(grouped.groups).toHaveLength(1);
  });

  it("humanizes known and unknown provider IDs", () => {
    expect(modelProviderLabel("opencode-go")).toBe("OpenCode Go");
    expect(modelProviderLabel("openwebui")).toBe("Open WebUI");
    expect(modelProviderLabel("llama.cpp")).toBe("llama.cpp");
    expect(modelProviderLabel("some-new-provider")).toBe("Some New Provider");
  });
});
