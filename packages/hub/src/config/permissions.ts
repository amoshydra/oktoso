import { stat } from "node:fs/promises";

/** Owner read/write only. The config stores the owner and provider secrets. */
export const CONFIG_FILE_MODE = 0o600;

export function formatFileMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

/**
 * Refuses to read a config that any other account can read or write. Windows
 * does not enforce POSIX modes through Node, so the check is skipped there.
 */
export async function assertConfigFilePermissions(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") return;

  const info = await stat(filePath);
  const actual = info.mode & 0o777;
  if (actual === CONFIG_FILE_MODE) return;

  throw new Error(
    `Hub config ${filePath} has mode ${formatFileMode(actual)}, but it stores credentials and must be 0600.\n` +
      `Fix it with: chmod 600 ${filePath}`,
  );
}
