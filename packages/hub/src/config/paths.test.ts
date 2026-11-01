import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  defaultConfigPath,
  defaultDataDir,
  resolveConfigPath,
} from "./paths";

const home = "/home/tester";

describe("defaultConfigPath", () => {
  it("uses XDG_CONFIG_HOME on Linux and Termux", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/xdg/config" }, "linux", home)).toBe(
      join("/xdg/config", "oktoso", "hub.config.json"),
    );
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    expect(defaultConfigPath({}, "linux", home)).toBe(
      join(home, ".config", "oktoso", "hub.config.json"),
    );
  });

  it("uses Application Support on macOS", () => {
    expect(defaultConfigPath({}, "darwin", home)).toBe(
      join(home, "Library", "Application Support", "Oktoso", "hub.config.json"),
    );
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      defaultConfigPath({ LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" }, "win32", home),
    ).toBe(
      join("C:\\Users\\tester\\AppData\\Local", "Oktoso", "hub.config.json"),
    );
  });
});

describe("defaultDataDir", () => {
  it("uses XDG_STATE_HOME on Linux and Termux", () => {
    expect(defaultDataDir({ XDG_STATE_HOME: "/xdg/state" }, "linux", home)).toBe(
      join("/xdg/state", "oktoso"),
    );
  });

  it("keeps state under Application Support on macOS", () => {
    expect(defaultDataDir({}, "darwin", home)).toBe(
      join(home, "Library", "Application Support", "Oktoso", "data"),
    );
  });

  it("keeps state next to the logs on Windows", () => {
    expect(defaultDataDir({ LOCALAPPDATA: "D:\\Local" }, "win32", home)).toBe(
      join("D:\\Local", "Oktoso", "data"),
    );
  });
});

describe("resolveConfigPath", () => {
  const platform = "linux" as const;
  const env = { XDG_CONFIG_HOME: "/xdg/config" };
  const preferred = join("/xdg/config", "oktoso", "hub.config.json");
  const legacy = join("/work/repo", "hub.config.json");

  it("never rewrites an explicit path", () => {
    expect(
      resolveConfigPath({
        explicitPath: "/etc/oktoso/hub.json",
        env,
        platform,
        home,
        cwd: "/work/repo",
        exists: () => true,
      }),
    ).toEqual({ path: "/etc/oktoso/hub.json", legacy: false });
  });

  it("prefers the platform config when it exists", () => {
    expect(
      resolveConfigPath({
        env,
        platform,
        home,
        cwd: "/work/repo",
        exists: (path) => path === preferred || path === legacy,
      }),
    ).toEqual({ path: preferred, legacy: false });
  });

  it("falls back to a legacy working-directory config", () => {
    expect(
      resolveConfigPath({
        env,
        platform,
        home,
        cwd: "/work/repo",
        exists: (path) => path === legacy,
      }),
    ).toEqual({ path: legacy, legacy: true });
  });

  it("returns the platform path so first run creates it there", () => {
    expect(
      resolveConfigPath({
        env,
        platform,
        home,
        cwd: "/work/repo",
        exists: () => false,
      }),
    ).toEqual({ path: preferred, legacy: false });
  });
});
