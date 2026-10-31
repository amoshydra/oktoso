import { createWriteStream, type WriteStream } from "node:fs";
import { chmod, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { LogRecord } from "../lib/logger";

export const DEFAULT_LOG_MAX_BYTES = 25 * 1024 * 1024;

type Env = Record<string, string | undefined>;

export function resolveLogDir(
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.HUB_LOG_DIR) return env.HUB_LOG_DIR;

  if (platform === "darwin") {
    return join(homedir(), "Library", "Logs", "Oktoso");
  }
  if (platform === "win32") {
    return join(
      env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "Oktoso",
      "Logs",
    );
  }
  return join(
    env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "oktoso",
    "logs",
  );
}

export function defaultLogFile(env: Env = process.env): string {
  return join(resolveLogDir(env), "hub.log");
}

export interface RotatingFileSinkOptions {
  filePath: string;
  maxBytes?: number;
  onError?: (error: Error) => void;
}

/**
 * Two-file log: the current run in hub.log and the previous run in
 * hub.log.prev. A long run rotates at maxBytes and replaces the previous run,
 * keeping the last two segments and a hard size bound.
 */
export class RotatingFileSink {
  private readonly filePath: string;
  private readonly previousPath: string;
  private readonly maxBytes: number;
  private readonly onError?: (error: Error) => void;
  private readonly queue: string[] = [];
  private stream?: WriteStream;
  private size = 0;
  private running = false;
  private closed = false;
  private failed = false;
  private errorReported = false;

  constructor(options: RotatingFileSinkOptions) {
    this.filePath = options.filePath;
    this.previousPath = `${options.filePath}.prev`;
    this.maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
    this.onError = options.onError;
  }

  write(record: LogRecord): void {
    if (this.closed || this.failed) return;
    this.queue.push(`${JSON.stringify(record)}\n`);
    void this.drain();
  }

  async close(): Promise<void> {
    this.closed = true;
    while (this.running || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (this.stream) {
      await new Promise<void>((resolve) => this.stream?.end(resolve));
      this.stream = undefined;
    }
  }

  private async drain(): Promise<void> {
    if (this.running || this.failed) return;
    this.running = true;

    try {
      await this.open();
      while (this.queue.length > 0) {
        const line = this.queue.shift()!;
        const bytes = Buffer.byteLength(line);
        if (this.size > 0 && this.size + bytes > this.maxBytes) {
          await this.rotate();
        }
        await this.writeLine(line);
        this.size += bytes;
      }
    } catch (error) {
      this.failed = true;
      this.queue.length = 0;
      if (!this.errorReported) {
        this.errorReported = true;
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.running = false;
      if (!this.closed && !this.failed && this.queue.length > 0) {
        void this.drain();
      }
    }
  }

  private async open(): Promise<void> {
    if (this.stream) return;

    const directory = dirname(this.filePath);
    const existingDirectory = await stat(directory)
      .then(() => true)
      .catch(() => false);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!existingDirectory) {
      await chmod(directory, 0o700).catch(() => undefined);
    }

    // Move a completed run to .prev. An empty file is just removed.
    const existing = await stat(this.filePath).catch(() => undefined);
    if (existing) {
      if (existing.size > 0) {
        await rm(this.previousPath, { force: true });
        await rename(this.filePath, this.previousPath);
      } else {
        await rm(this.filePath, { force: true });
      }
    }

    this.stream = createWriteStream(this.filePath, {
      flags: "a",
      mode: 0o600,
    });
    await new Promise<void>((resolve, reject) => {
      this.stream?.once("open", () => resolve());
      this.stream?.once("error", reject);
    });
    await chmod(this.filePath, 0o600).catch(() => undefined);
    this.size = 0;
  }

  private async rotate(): Promise<void> {
    if (!this.stream) return;
    const stream = this.stream;
    this.stream = undefined;
    await new Promise<void>((resolve) => stream.end(resolve));

    await rm(this.previousPath, { force: true });
    await rename(this.filePath, this.previousPath);

    this.stream = createWriteStream(this.filePath, {
      flags: "a",
      mode: 0o600,
    });
    await new Promise<void>((resolve, reject) => {
      this.stream?.once("open", () => resolve());
      this.stream?.once("error", reject);
    });
    await chmod(this.filePath, 0o600).catch(() => undefined);
    this.size = 0;
  }

  private writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        reject(new Error("Log stream is not open"));
        return;
      }
      this.stream.write(line, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
