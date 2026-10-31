import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

describe("CLI arguments", () => {
  it("parses the status command and host overrides", () => {
    const options = parseArgs([
      "status",
      "--config",
      "./hub.json",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
    ]);

    expect(options.command).toBe("status");
    expect(options.configPath).toBe("./hub.json");
    expect(options.explicitConfig).toBe(true);
    expect(options.host).toBe("0.0.0.0");
    expect(options.port).toBe(9000);
  });

  it("parses pair and service flags", () => {
    const options = parseArgs([
      "pair",
      "--url",
      "https://hub.example.com",
      "--plain",
      "--verbose",
    ]);

    expect(options.command).toBe("pair");
    expect(options.url).toBe("https://hub.example.com");
    expect(options.plain).toBe(true);
    expect(options.verbose).toBe(true);
  });

  it("rejects invalid ports and unknown options", () => {
    expect(() => parseArgs(["--port", "0"])).toThrow(/--port/);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
  });
});
