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
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const BACKUP_FORMAT = 1;

export const zBackupFile = z.object({
  path: z
    .string()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.startsWith("\\") &&
        !value.split(/[\\/]/).includes("..") &&
        !/^[a-zA-Z]:/.test(value),
      "Backup paths must be relative and stay inside the snapshot",
    ),
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

  const existing = await readdir(outDir).catch(() => [] as string[]);
  if (existing.length > 0) {
    throw new Error(`The backup directory is not empty: ${outDir}`);
  }
  const sourceEntries = await readdir(dataDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new Error(`The data directory does not exist: ${dataDir}`);
    }
    throw error;
  });
  void sourceEntries;

  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const files: BackupManifest["files"] = [];
  const sourceRoot = join(outDir, "data");
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });

  for (const entry of await walk(dataDir)) {
    if (EXCLUDED_ROOTS.some((root) => entry === root || entry.startsWith(`${root}/`))) {
      continue;
    }
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    const source = safeJoin(dataDir, entry);
    const target = safeJoin(sourceRoot, entry);
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
    dataDir: basename(dataDir),
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
    const source = safeJoin(join(fromDir, "data"), file.path);
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

  try {
    const { access, constants } = await import("node:fs/promises");
    await access(dirname(dataDir), constants.W_OK);
  } catch {
    throw new Error(
      `Cannot restore into ${dataDir}: its parent directory is not writable. Run restore from the host, or move dataDir under a writable parent.`,
    );
  }

  const stamp = new Date(options.now?.() ?? Date.now())
    .toISOString()
    .replace(/[:.]/g, "-");
  const staging = `${dataDir}.restore-${stamp}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });

  for (const file of manifest.files) {
    const target = safeJoin(staging, file.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(safeJoin(join(fromDir, "data"), file.path), target);
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
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  let configured: string | undefined;
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8")) as {
      dataDir?: unknown;
    };
    if (typeof raw.dataDir === "string" && raw.dataDir.length > 0) {
      configured = raw.dataDir.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) =>
        env[name] ?? match,
      );
    }
  } catch {
    // A missing or unreadable config falls back to the platform default.
  }
  // Same precedence as loadConfig: HUB_DATA_DIR wins, then the file, then the
  // platform default. Resolving differently here would back up the wrong tree.
  return resolve(env.HUB_DATA_DIR ?? configured ?? fallback);
}

/** Refuses an absolute path or one that climbs out of the root. */
function safeJoin(root: string, relative: string): string {
  if (
    relative.length === 0 ||
    relative.startsWith("/") ||
    relative.startsWith("\\") ||
    relative.split(/[\\/]/).includes("..") ||
    /^[a-zA-Z]:/.test(relative)
  ) {
    throw new Error(`Refusing an unsafe backup path: ${relative}`);
  }
  const base = resolve(root);
  const target = resolve(base, relative);
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`Refusing a backup path outside the snapshot: ${relative}`);
  }
  return target;
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
    } else if (entry.isSymbolicLink()) {
      throw new Error(
        `Backup does not follow symlinks: ${path}. Copy the target instead.`,
      );
    } else {
      throw new Error(`Backup does not support special files: ${path}`);
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
