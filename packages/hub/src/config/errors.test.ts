import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ConfigFileError,
  formatConfigError,
  formatConfigPath,
  parseConfig,
  parseConfigJson,
} from "./errors";

describe("config error formatting", () => {
  it("builds a dotted path with array indexes", () => {
    expect(
      formatConfigPath(["automation", "templates", 0, "providerID"]),
    ).toBe("automation.templates[0].providerID");
    expect(formatConfigPath(["token"])).toBe("token");
    expect(formatConfigPath([])).toBe("");
  });

  it("turns a schema error into a file and field message", () => {
    const schema = z.object({
      automation: z.object({
        templates: z.array(z.object({ providerID: z.string(), title: z.string() })),
      }),
    });

    let failure: unknown;
    try {
      parseConfig(
        schema,
        { automation: { templates: [{ title: "Nightly" }] } },
        "/tmp/hub.config.json",
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ConfigFileError);
    expect((failure as Error).message).toContain(
      "/tmp/hub.config.json is not valid:",
    );
    expect((failure as Error).message).toContain(
      "automation.templates[0].providerID:",
    );
    expect((failure as Error).message).toContain("Fix the field above");
    expect((failure as Error).message).not.toContain("invalid_type");
  });

  it("names the file when the JSON itself is broken", () => {
    expect(() => parseConfigJson("{", "/tmp/hub.config.json")).toThrow(
      /\/tmp\/hub\.config\.json could not be parsed:/,
    );
  });

  it("leaves unrelated errors alone", () => {
    const error = new Error("permissions too open");
    expect(formatConfigError(error, "/tmp/hub.config.json")).toBe(error);
  });
});
