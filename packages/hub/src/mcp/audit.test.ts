import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger";
import { createMcpAudit } from "./audit";

const roots: string[] = [];
const logger = createLogger({ level: "silent" });

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-mcp-audit-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("createMcpAudit", () => {
  it("writes one JSONL entry per tool call", async () => {
    const root = await tempRoot();
    const file = join(root, "logs", "mcp-audit.jsonl");
    const audit = createMcpAudit({ file, logger });

    audit.record("controller", {
      tool: "providers_list",
      ok: true,
      durationMs: 4,
      callerSessionId: "ses_abc",
      target: "opencode",
    });
    audit.record("controller", {
      tool: "sessions_send",
      ok: false,
      durationMs: 12,
      target: "opencode:ses_auth",
      error: "Provider access is not allowed for this token",
    });
    await audit.flush();

    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      clientId: "controller",
      tool: "providers_list",
      ok: true,
      durationMs: 4,
      callerSessionId: "ses_abc",
      target: "opencode",
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      clientId: "controller",
      tool: "sessions_send",
      ok: false,
      error: "Provider access is not allowed for this token",
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("truncates long errors", async () => {
    const root = await tempRoot();
    const file = join(root, "mcp-audit.jsonl");
    const audit = createMcpAudit({ file, logger });

    audit.record("controller", {
      tool: "sessions_send",
      ok: false,
      durationMs: 1,
      error: "x".repeat(600),
    });
    await audit.flush();

    const entry = JSON.parse((await readFile(file, "utf8")).trim());
    expect(entry.error).toHaveLength(500);
  });
});
