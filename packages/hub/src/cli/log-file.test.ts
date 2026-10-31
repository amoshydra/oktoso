import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLogDir, RotatingFileSink } from "./log-file";
import type { LogRecord } from "../lib/logger";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-log-"));
  roots.push(root);
  return root;
}

function record(message: string): LogRecord {
  return {
    time: new Date().toISOString(),
    level: "info",
    msg: message,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resolveLogDir", () => {
  it("uses the platform log convention", () => {
    expect(resolveLogDir({}, "linux")).toContain(".local/state/oktoso/logs");
    expect(resolveLogDir({}, "darwin")).toContain("Library/Logs/Oktoso");
    expect(resolveLogDir({ LOCALAPPDATA: "C:\\Logs" }, "win32")).toBe(
      join("C:\\Logs", "Oktoso", "Logs"),
    );
  });

  it("honors HUB_LOG_DIR", () => {
    expect(resolveLogDir({ HUB_LOG_DIR: "/tmp/custom" }, "linux")).toBe(
      "/tmp/custom",
    );
  });
});

describe("RotatingFileSink", () => {
  it("moves the previous run to hub.log.prev on startup", async () => {
    const root = await tempRoot();
    const filePath = join(root, "hub.log");
    await writeFile(filePath, "previous run\n", "utf8");

    const sink = new RotatingFileSink({ filePath, maxBytes: 10_000 });
    sink.write(record("one"));
    sink.write(record("two"));
    await sink.close();

    const current = await readFile(filePath, "utf8");
    const previous = await readFile(`${filePath}.prev`, "utf8");
    expect(previous).toContain("previous run");
    expect(current).toContain("one");
    expect(current).toContain("two");

    const mode = (await stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("rotates at the size cap and keeps the last two segments", async () => {
    const root = await tempRoot();
    const filePath = join(root, "hub.log");
    await writeFile(filePath, "previous run\n", "utf8");

    const sink = new RotatingFileSink({
      filePath,
      maxBytes: 120,
      onError: (error) => {
        throw error;
      },
    });
    sink.write(record("one"));
    sink.write(record("two"));
    sink.write(record("three"));
    await sink.close();

    const current = await readFile(filePath, "utf8");
    const previous = await readFile(`${filePath}.prev`, "utf8");
    expect(previous).toContain("two");
    expect(current).toContain("three");
    expect(current.length).toBeLessThan(400);
  });
});
