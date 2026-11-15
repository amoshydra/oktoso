import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createBackup,
  dataDirFromConfig,
  describeBackup,
  restoreBackup,
} from "../backup";
import { defaultDataDir } from "../config/paths";

export interface BackupCommandOptions {
  action: "backup" | "restore";
  configPath: string;
  version: string;
  out?: string;
  from?: string;
  force?: boolean;
}

/**
 * Offline backup and restore.
 *
 * Restoring swaps the whole data directory, so a running hub must stop first:
 * the check asks the configured host and port for health before touching disk.
 */
export async function runBackupCommand(
  options: BackupCommandOptions,
): Promise<void> {
  const dataDir = await dataDirFromConfig(
    options.configPath,
    defaultDataDir(process.env),
  );

  if (options.action === "backup") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = resolve(options.out ?? `oktoso-backup-${stamp}`);
    const manifest = await createBackup({
      dataDir,
      outDir,
      version: options.version,
    });
    process.stdout.write(`${describeBackup(manifest, outDir)}\n`);
    process.stdout.write(
      "Copy the config file separately; it holds the owner token and provider credentials.\n",
    );
    return;
  }

  if (!options.from) {
    throw new Error("Restore needs --from <backup directory>");
  }
  await assertHubStopped(options.configPath);
  const result = await restoreBackup({
    fromDir: options.from,
    dataDir,
    ...(options.force ? { force: true } : {}),
  });
  process.stdout.write(
    `Restored ${result.restored} files into ${dataDir}\n`,
  );
  if (result.movedAside) {
    process.stdout.write(`Previous data kept at ${result.movedAside}\n`);
  }
  process.stdout.write(
    "Start the hub, then check Settings → Local data and the notification devices.\n",
  );
}

async function assertHubStopped(configPath: string): Promise<void> {
  let host = "127.0.0.1";
  let port = 8787;
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      host?: unknown;
      port?: unknown;
    };
    if (typeof raw.host === "string") host = raw.host;
    if (typeof raw.port === "number") port = raw.port;
  } catch {
    return;
  }
  const url = `http://${host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host}:${port}/api/v1/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(700) });
    if (response.ok) {
      throw new Error(
        `The hub is running at ${url}. Stop it before restoring, or the running process will overwrite the restored state.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Stop it before restoring")) {
      throw error;
    }
    // Unreachable means stopped, which is what restore needs.
  }
}
