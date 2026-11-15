import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";

export const BACKUP_FORMAT = 1;

export const zBackupFile = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
});

export const zBackupManifest = z.object({
  format: z.literal(BACKUP_FORMAT),
  createdAt: z.string(),
  version: z.string(),
  dataDir: z.string(),
  files: z.array(zBackupFile),
  excluded: z.array(z.string()),
});

export type BackupManifest = z.infer<typeof zBackupManifest>;

/** Uploads, logs, and half-written files are not part of a backup. */
const EXCLUDED_ROOTS = ["attachments", "logs"];
const EXCLUDED_SUFFIXES = [".tmp"];

export interface CreateBackupOptions {
  dataDir: string;
  outDir: string;
  version: string;
  now?: () => number;
}

/**
 * Copies the hub's data directory into a validated snapshot.
 *
 * The owner token and provider credentials live in the config file, not here,
 * so a backup is safe to move but still owner-only: it holds drafts, approvals,
 * notification keys, and transcripts.
 */
export async function createBackup(
  options: CreateBackupOptions,
): Promise<BackupManifest> {
  const dataDir = resolve(options.dataDir);
  const outDir = resolve(options.outDir);
  if (outDir === dataDir || outDir.startsWith(`${dataDir}/`)) {
    throw new Error("The backup directory must live outside the hub data directory");
  }

  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const files: BackupManifest["files"] = [];
  const sourceRoot = join(outDir, "data");
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });

  for (const entry of await walk(dataDir)) {
    if (EXCLUDED_ROOTS.some((root) => entry === root || entry.startsWith(`${root}/`))) {
      continue;
    }
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    const source = join(dataDir, entry);
    const target = join(sourceRoot, entry);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
    const info = await stat(source);
    await chmod(target, info.mode & 0o777);
    files.push({
      path: entry,
      bytes: info.size,
      sha256: sha256(await readFile(source)),
    });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    createdAt: new Date(options.now?.() ?? Date.now()).toISOString(),
    version: options.version,
    dataDir,
    files,
    excluded: [...EXCLUDED_ROOTS, ...EXCLUDED_SUFFIXES.map((suffix) => `*${suffix}`)],
  };
  // The manifest is the commit point: it is written only after every file.
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return manifest;
}

export interface RestoreBackupOptions {
  fromDir: string;
  dataDir: string;
  force?: boolean;
  now?: () => number;
}

export interface RestoreResult {
  restored: number;
  movedAside?: string;
}

/** Restores a snapshot into the data directory, refusing a corrupt one. */
export async function restoreBackup(
  options: RestoreBackupOptions,
): Promise<RestoreResult> {
  const fromDir = resolve(options.fromDir);
  const dataDir = resolve(options.dataDir);

  const manifest = zBackupManifest.parse(
    JSON.parse(await readFile(join(fromDir, "manifest.json"), "utf8")),
  );

  for (const file of manifest.files) {
    const source = join(fromDir, "data", file.path);
    const content = await readFile(source);
    if (content.byteLength !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`Backup is corrupt: ${file.path} does not match its manifest`);
    }
  }

  const existing = await readdir(dataDir).catch(() => [] as string[]);
  if (existing.length > 0 && !options.force) {
    throw new Error(
      `The data directory is not empty (${dataDir}). Stop the hub and pass --force to replace it.`,
    );
  }

  const stamp = new Date(options.now?.() ?? Date.now())
    .toISOString()
    .replace(/[:.]/g, "-");
  const staging = `${dataDir}.restore-${stamp}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });

  for (const file of manifest.files) {
    const target = join(staging, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(fromDir, "data", file.path), target);
    await chmod(target, 0o600);
  }

  let movedAside: string | undefined;
  if (existing.length > 0) {
    movedAside = `${dataDir}.before-restore-${stamp}`;
    await rename(dataDir, movedAside);
  }
  try {
    await mkdir(dirname(dataDir), { recursive: true, mode: 0o700 });
    await rename(staging, dataDir);
    await chmod(dataDir, 0o700);
  } catch (error) {
    if (movedAside) await rename(movedAside, dataDir).catch(() => undefined);
    throw error;
  }

  return {
    restored: manifest.files.length,
    ...(movedAside ? { movedAside } : {}),
  };
}

/** Reads only `dataDir` from the config; restore must not need provider secrets. */
export async function dataDirFromConfig(
  configPath: string,
  fallback: string,
): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      dataDir?: unknown;
    };
    if (typeof raw.dataDir === "string" && raw.dataDir.length > 0) {
      return resolve(raw.dataDir);
    }
  } catch {
    // A missing or unreadable config falls back to the platform default.
  }
  return resolve(fallback);
}

async function walk(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(root, path)));
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
  return out;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function describeBackup(manifest: BackupManifest, dir: string): string {
  const bytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
  return `Backup ${manifest.createdAt} · ${manifest.files.length} files · ${(
    bytes / 1_000_000
  ).toFixed(1)} MB · ${relative(process.cwd(), dir) || "."}`;
}
