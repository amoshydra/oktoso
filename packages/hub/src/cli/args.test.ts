import { describe, expect, it } from "vitest";
import { join } from "node:path";
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

  it("defaults to the platform config directory instead of the cwd", () => {
    const linux = parseArgs([], { XDG_CONFIG_HOME: "/xdg/config" }, "linux");
    expect(linux.configPath).toBe(join("/xdg/config", "oktoso", "hub.config.json"));
    expect(linux.explicitConfig).toBe(false);

    const darwin = parseArgs([], {}, "darwin");
    expect(darwin.configPath).toContain(
      join("Library", "Application Support", "Oktoso", "hub.config.json"),
    );
  });

  it("keeps HUB_CONFIG and --config explicit", () => {
    const fromEnv = parseArgs([], { HUB_CONFIG: "/etc/oktoso/hub.json" }, "linux");
    expect(fromEnv.configPath).toBe("/etc/oktoso/hub.json");
    expect(fromEnv.explicitConfig).toBe(true);

    const fromFlag = parseArgs(["--config", "./hub.json"], {}, "linux");
    expect(fromFlag.configPath).toBe("./hub.json");
    expect(fromFlag.explicitConfig).toBe(true);
  });
});
