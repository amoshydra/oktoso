import { describe, expect, it } from "vitest";
import { createSecretBox } from "../lib/secret-box";
import { McpTokenService, redactMcpTokens } from "./tokens";

function service(now: () => number = () => 1_000_000) {
  return new McpTokenService({
    secretBox: createSecretBox("owner-token"),
    now,
    defaultTtlSeconds: 900,
    maxTtlSeconds: 3_600,
  });
}

describe("McpTokenService", () => {
  it("issues a scoped token and authenticates it", () => {
    const tokens = service();
    const issued = tokens.issue({
      providers: ["desktop-opencode"],
      tools: ["sessions_list", "sessions_messages"],
      sessionRef: "desktop-opencode:ses_a",
      ttlSeconds: 600,
    });
    expect(issued.token).toMatch(/^okt_mcp_/);
    expect(issued.id).toMatch(/^mcp_/);
    expect(issued.expiresAt).toBe(1_000_000 + 600_000);
    expect(issued.allowWrite).toBe(false);
    expect(issued.maxSessions).toBe(1);

    const scope = tokens.authenticate(issued.token);
    expect(scope).toMatchObject({
      id: issued.id,
      providers: ["desktop-opencode"],
      tools: ["sessions_list", "sessions_messages"],
      sessionRef: "desktop-opencode:ses_a",
      allowWrite: false,
      maxSessions: 1,
    });
  });

  it("rejects a token at its expiry", () => {
    let now = 1_000_000;
    const tokens = service(() => now);
    const issued = tokens.issue({ ttlSeconds: 60 });
    expect(tokens.authenticate(issued.token)).toBeDefined();
    now += 59_999;
    expect(tokens.authenticate(issued.token)).toBeDefined();
    now += 1;
    expect(tokens.authenticate(issued.token)).toBeUndefined();
    expect(tokens.reveal(issued.id)).toBeUndefined();
  });

  it("reveals the same secret until expiry and then forgets it", () => {
    let now = 1_000_000;
    const tokens = service(() => now);
    const issued = tokens.issue({ ttlSeconds: 60 });
    expect(tokens.reveal(issued.id)?.token).toBe(issued.token);
    now += 60_000;
    expect(tokens.reveal(issued.id)).toBeUndefined();
  });

  it("lists metadata without secrets", () => {
    const tokens = service();
    const issued = tokens.issue({ ttlSeconds: 60 });
    const [entry] = tokens.list();
    expect(entry?.id).toBe(issued.id);
    expect(entry).not.toHaveProperty("token");
    expect(JSON.stringify(entry)).not.toContain(issued.token);
  });

  it("revokes a token", () => {
    const tokens = service();
    const issued = tokens.issue();
    expect(tokens.revoke(issued.id)).toBe(true);
    expect(tokens.authenticate(issued.token)).toBeUndefined();
    expect(tokens.reveal(issued.id)).toBeUndefined();
  });

  it("clamps the TTL and refuses too many active tokens", () => {
    const tokens = service();
    const issued = tokens.issue({ ttlSeconds: 1 });
    expect(issued.expiresAt).toBe(1_000_000 + 60_000);
    for (let index = 0; index < 49; index += 1) tokens.issue();
    expect(() => tokens.issue()).toThrow(/Too many active MCP tokens/);
  });
});

describe("redactMcpTokens", () => {
  it("replaces the secret but keeps surrounding text and ids", () => {
    const secret = "okt_mcp_abcdefghijklmnopqrstuvwxyz0123456789";
    expect(
      redactMcpTokens(`id: mcp_1\n\`\`\`sh\nexport X=${secret}\n\`\`\``),
    ).toBe(
      "id: mcp_1\n```sh\nexport X=[redacted mcp token; reveal it again with the token id]\n```",
    );
  });
});
