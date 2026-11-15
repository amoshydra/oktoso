import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { zHubConfig } from "./schema";

describe("hub.config.example.json", () => {
  it("parses with the shipped schema", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("../../../../hub.config.example.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    raw.token = "example-token-000000000000000001";
    raw.dataDir = ".data";
    // The example uses env references; the schema parses resolved values.
    (raw.providers as Array<Record<string, unknown>>)[1]!.baseUrl =
      "https://openwebui.example.com";

    const parsed = zHubConfig.parse(raw);
    expect(parsed.providers.length).toBeGreaterThan(0);
    expect(parsed.notifications.enabled).toBe(false);
  });
});
