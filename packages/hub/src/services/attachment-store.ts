import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from "@amoshydra/oktoso-contracts";
import { badRequest, notFound } from "../domain/errors";

export const ATTACHMENT_TTL_MS = 60 * 60 * 1_000;

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/markdown",
  "text/csv",
]);

const SAFE_ID = /^att_[a-f0-9-]{36}$/;

export interface AttachmentInput {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface StagedAttachment {
  attachment: Attachment;
  data: Uint8Array;
}

export class AttachmentStore {
  private readonly root: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private lastSweep = 0;

  constructor(options: {
    root: string;
    ttlMs?: number;
    now?: () => number;
  }) {
    this.root = options.root;
    this.ttlMs = options.ttlMs ?? ATTACHMENT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.sweep(true);
  }

  async stage(input: AttachmentInput): Promise<Attachment> {
    if (input.data.byteLength === 0) {
      throw badRequest("The attachment is empty");
    }
    if (input.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw badRequest("The attachment is too large");
    }
    const mimeType = normalizeMime(input.mimeType);
    if (!ALLOWED_TYPES.has(mimeType)) {
      throw badRequest("Unsupported attachment type", { mimeType });
    }

    await this.maybeSweep();

    const id = `att_${randomUUID()}`;
    const attachment: Attachment = {
      id,
      name: safeName(input.name),
      mimeType,
      size: input.data.byteLength,
      createdAt: this.now(),
    };
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(this.filePath(id), input.data, { mode: 0o600 });
    await writeFile(
      this.metaPath(id),
      JSON.stringify(attachment),
      { mode: 0o600, encoding: "utf8" },
    );
    return attachment;
  }

  async read(id: string): Promise<StagedAttachment> {
    assertId(id);
    let raw: string;
    try {
      raw = await readFile(this.metaPath(id), "utf8");
    } catch {
      throw notFound("Attachment not found or expired");
    }
    let attachment: Attachment;
    try {
      attachment = JSON.parse(raw) as Attachment;
    } catch {
      throw notFound("Attachment metadata is invalid");
    }
    if (
      !attachment ||
      attachment.id !== id ||
      attachment.createdAt + this.ttlMs < this.now()
    ) {
      await this.remove(id);
      throw notFound("Attachment not found or expired");
    }
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(this.filePath(id)));
    } catch {
      throw notFound("Attachment data not found");
    }
    return { attachment, data };
  }

  async remove(id: string): Promise<void> {
    assertId(id);
    await Promise.all([
      unlink(this.filePath(id)).catch(() => undefined),
      unlink(this.metaPath(id)).catch(() => undefined),
    ]);
  }

  async sweep(force = false): Promise<void> {
    const now = this.now();
    if (!force && now - this.lastSweep < 5 * 60 * 1_000) return;
    this.lastSweep = now;
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -5);
      if (!SAFE_ID.test(id)) continue;
      try {
        const raw = await readFile(join(this.root, entry), "utf8");
        const attachment = JSON.parse(raw) as Attachment;
        if (attachment.createdAt + this.ttlMs < now) {
          await this.remove(id);
        }
      } catch {
        await this.remove(id).catch(() => undefined);
      }
    }
  }

  private async maybeSweep(): Promise<void> {
    if (this.now() - this.lastSweep < 5 * 60 * 1_000) return;
    await this.sweep(true);
  }

  private filePath(id: string): string {
    return join(this.root, `${id}.bin`);
  }

  private metaPath(id: string): string {
    return join(this.root, `${id}.json`);
  }
}

function assertId(id: string): void {
  if (!SAFE_ID.test(id)) throw notFound("Attachment not found");
}

function normalizeMime(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}

function safeName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 180);
  return cleaned || "Attachment";
}
