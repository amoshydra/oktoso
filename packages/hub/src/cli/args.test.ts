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

  it("parses template list and start", () => {
    const list = parseArgs(["template"]);
    expect(list.command).toBe("template");
    expect(list.templateAction).toBe("list");

    const start = parseArgs(["template", "start", "--id", "nightly"]);
    expect(start.command).toBe("template");
    expect(start.templateAction).toBe("start");
    expect(start.templateID).toBe("nightly");

    expect(() => parseArgs(["template", "list", "--id", "nightly"])).toThrow(
      /--id only applies to template start/,
    );
    expect(() => parseArgs(["--id", "nightly"])).toThrow(
      /--id only applies to template start/,
    );
  });

  it("parses backup and restore with their flags", () => {
    const backup = parseArgs(["backup", "--out", "./snapshots/a"]);
    expect(backup.command).toBe("backup");
    expect(backup.out).toBe("./snapshots/a");
    expect(backup.force).toBe(false);

    const restore = parseArgs([
      "restore",
      "--from",
      "./snapshots/a",
      "--force",
    ]);
    expect(restore.command).toBe("restore");
    expect(restore.from).toBe("./snapshots/a");
    expect(restore.force).toBe(true);
  });

  it("rejects a flag that expects a value but gets none", () => {
    expect(() => parseArgs(["restore", "--from"])).toThrow(/--from requires a value/);
  });

  it("parses the mcp command and read-write opt-in", () => {
    const readOnly = parseArgs(["mcp", "--url", "http://127.0.0.1:8787"]);
    expect(readOnly.command).toBe("mcp");
    expect(readOnly.allowWrite).toBe(false);
    expect(readOnly.url).toBe("http://127.0.0.1:8787");

    const readWrite = parseArgs(["mcp", "--allow-write"]);
    expect(readWrite.command).toBe("mcp");
    expect(readWrite.allowWrite).toBe(true);
  });

  it("parses automation commands", () => {
    const status = parseArgs(["automation"]);
    expect(status.command).toBe("automation");
    expect(status.automationAction).toBe("status");

    const pause = parseArgs(["automation", "pause", "--watcher", "w1"]);
    expect(pause.command).toBe("automation");
    expect(pause.automationAction).toBe("pause");
    expect(pause.automationWatcher).toBe("w1");

    const resume = parseArgs(["automation", "resume"]);
    expect(resume.automationAction).toBe("resume");
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
