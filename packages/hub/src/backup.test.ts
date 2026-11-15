import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackup,
  dataDirFromConfig,
  restoreBackup,
  zBackupManifest,
} from "./backup";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oktoso-backup-"));
  roots.push(path);
  return path;
}

async function seed(dataDir: string): Promise<void> {
  await mkdir(join(dataDir, "transcripts"), { recursive: true, mode: 0o700 });
  await mkdir(join(dataDir, "attachments"), { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, "state.json"), '{"schemaVersion":1}\n', {
    mode: 0o600,
  });
  await writeFile(join(dataDir, "transcripts", "a.json"), '{"ref":"a"}\n', {
    mode: 0o600,
  });
  await writeFile(join(dataDir, "attachments", "upload.png"), "png", {
    mode: 0o600,
  });
  await writeFile(join(dataDir, "state.json.tmp"), "partial", { mode: 0o600 });
}

describe("createBackup", () => {
  it("copies state and transcripts, skipping uploads and temp files", async () => {
    const base = await root();
    const dataDir = join(base, "data");
    await seed(dataDir);

    const out = join(base, "snapshot");
    const manifest = await createBackup({
      dataDir,
      outDir: out,
      version: "0.2.1",
      now: () => 1_793_000_000_000,
    });

    expect(manifest.format).toBe(1);
    expect(manifest.files.map((file) => file.path).sort()).toEqual([
      "state.json",
      "transcripts/a.json",
    ]);
    expect(manifest.excluded).toContain("attachments");
    expect(manifest.excluded).toContain("logs");
    expect(manifest.createdAt).toBe(new Date(1_793_000_000_000).toISOString());

    const onDisk = zBackupManifest.parse(
      JSON.parse(await readFile(join(out, "manifest.json"), "utf8")),
    );
    expect(onDisk.files).toHaveLength(2);
    await expect(stat(join(out, "data", "attachments"))).rejects.toThrow();
  });

  it("refuses to write inside the data directory", async () => {
    const base = await root();
    const dataDir = join(base, "data");
    await seed(dataDir);

    await expect(
      createBackup({ dataDir, outDir: join(dataDir, "backup"), version: "0" }),
    ).rejects.toThrow(/outside the hub data directory/);
  });
});

describe("restoreBackup", () => {
  it("restores into an empty directory with owner-only files", async () => {
    const base = await root();
    const dataDir = join(base, "data");
    await seed(dataDir);
    const out = join(base, "snapshot");
    await createBackup({ dataDir, outDir: out, version: "0.2.1" });

    const target = join(base, "restored");
    const result = await restoreBackup({ fromDir: out, dataDir: target });

    expect(result.restored).toBe(2);
    expect(result.movedAside).toBeUndefined();
    expect(await readFile(join(target, "state.json"), "utf8")).toContain(
      '"schemaVersion":1',
    );
    expect((await stat(join(target, "state.json"))).mode & 0o777).toBe(0o600);
  });

  it("refuses a non-empty target unless forced, then keeps the old data", async () => {
    const base = await root();
    const dataDir = join(base, "data");
    await seed(dataDir);
    const out = join(base, "snapshot");
    await createBackup({ dataDir, outDir: out, version: "0.2.1" });

    const target = join(base, "live");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "state.json"), "old", { mode: 0o600 });

    await expect(restoreBackup({ fromDir: out, dataDir: target })).rejects.toThrow(
      /not empty/,
    );

    const forced = await restoreBackup({
      fromDir: out,
      dataDir: target,
      force: true,
      now: () => 1_793_000_000_000,
    });
    expect(forced.movedAside).toContain("before-restore");
    expect(await readFile(join(target, "state.json"), "utf8")).toContain(
      '"schemaVersion":1',
    );
    expect(
      await readFile(join(forced.movedAside!, "state.json"), "utf8"),
    ).toBe("old");
  });

  it("rejects a backup whose bytes do not match the manifest", async () => {
    const base = await root();
    const dataDir = join(base, "data");
    await seed(dataDir);
    const out = join(base, "snapshot");
    await createBackup({ dataDir, outDir: out, version: "0.2.1" });

    await writeFile(join(out, "data", "state.json"), "tampered", { mode: 0o600 });

    await expect(
      restoreBackup({ fromDir: out, dataDir: join(base, "target") }),
    ).rejects.toThrow(/corrupt/);
    expect(await readdir(join(base, "target")).catch(() => [])).toEqual([]);
  });
});

describe("dataDirFromConfig", () => {
  it("reads dataDir and falls back when it is absent", async () => {
    const base = await root();
    const withData = join(base, "a.json");
    await writeFile(withData, JSON.stringify({ dataDir: "./state" }));
    expect(await dataDirFromConfig(withData, join(base, "fallback"))).toBe(
      join(process.cwd(), "state"),
    );

    const without = join(base, "b.json");
    await writeFile(without, JSON.stringify({}));
    expect(await dataDirFromConfig(without, join(base, "fallback"))).toBe(
      join(base, "fallback"),
    );
  });
});
