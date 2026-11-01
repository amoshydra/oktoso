import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

/**
 * The hub config holds the owner token and provider credentials. It belongs to
 * the user, not to whatever directory the CLI happens to be started from, so
 * the default follows the platform conventions instead of the cwd.
 */
export function defaultConfigDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Oktoso");
  }
  if (platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Oktoso");
  }
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "oktoso");
}

export function defaultConfigPath(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  return join(defaultConfigDir(env, platform, home), "hub.config.json");
}

/**
 * Runtime state follows the logs: platform-native and independent of the
 * working directory, so read markers and drafts do not fork per launch.
 */
export function defaultDataDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Oktoso", "data");
  }
  if (platform === "win32") {
    return join(
      env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
      "Oktoso",
      "data",
    );
  }
  return join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "oktoso");
}

export interface ResolveConfigPathOptions {
  /** `--config` or `HUB_CONFIG`; never rewritten or created implicitly. */
  explicitPath?: string;
  env?: Env;
  platform?: NodeJS.Platform;
  home?: string;
  cwd?: string;
  exists?: (path: string) => boolean;
}

export interface ResolvedConfigPath {
  path: string;
  /** True when an older repo-local `./hub.config.json` was picked up. */
  legacy: boolean;
}

/**
 * Chooses the config file for this run. An explicit path always wins. Otherwise
 * the platform path is used when it exists, then a legacy `./hub.config.json`,
 * and finally the platform path so first run creates it in the right place.
 */
export function resolveConfigPath(
  options: ResolveConfigPathOptions = {},
): ResolvedConfigPath {
  if (options.explicitPath) {
    return { path: options.explicitPath, legacy: false };
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;
  const preferred = defaultConfigPath(env, platform, options.home);
  if (exists(preferred)) return { path: preferred, legacy: false };

  const legacyPath = join(options.cwd ?? process.cwd(), "hub.config.json");
  if (exists(legacyPath)) return { path: legacyPath, legacy: true };

  return { path: preferred, legacy: false };
}
