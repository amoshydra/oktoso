import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { redact, redactText, registerSecret, resetSecrets } from "./redact";

beforeEach(() => {
  resetSecrets();
});

describe("redact", () => {
  it("masks sensitive keys at any depth, including inside arrays", () => {
    const output = redact({
      provider: {
        auth: { kind: "basic", password: "hunter2" },
        endpoints: [{ url: "http://x", token: "abc123" }],
      },
      token: "owner",
    }) as Record<string, unknown>;

    expect(JSON.stringify(output)).not.toContain("hunter2");
    expect(JSON.stringify(output)).not.toContain("abc123");
    expect(JSON.stringify(output)).not.toContain("owner");
    expect(JSON.stringify(output)).toContain("[REDACTED]");
  });

  it("masks message bodies and prompts by key", () => {
    const output = JSON.stringify(
      redact({
        text: "the user's private message",
        prompt: "system prompt",
        content: "assistant prose",
        transcript: "full history",
      }),
    );

    expect(output).not.toContain("private message");
    expect(output).not.toContain("system prompt");
    expect(output).not.toContain("assistant prose");
    expect(output).not.toContain("full history");
  });

  it("masks a registered secret wherever it appears", () => {
    registerSecret("super-secret-owner-token");

    expect(redactText("connect failed with super-secret-owner-token rejected")).toBe(
      "connect failed with [REDACTED] rejected",
    );
    expect(
      redact({ error: "url=http://hub/?x=1&token=super-secret-owner-token" }),
    ).toMatchObject({ error: expect.stringContaining("[REDACTED]") });
  });

  it("ignores short values so ordinary words are not masked", () => {
    registerSecret("abc");
    expect(redactText("abc in a sentence")).toBe("abc in a sentence");
  });

  it("masks bearer, basic, and query credentials even under innocent keys", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).toContain(
      "Bearer [REDACTED]",
    );
    expect(redactText("Authorization: Basic b3BlbmNvZGU6cHc=")).toContain(
      "Basic [REDACTED]",
    );
    expect(redactText("GET /v1?api_key=abcd1234&x=1")).toContain(
      "api_key=[REDACTED]",
    );
    expect(redactText("GET /v1?api_key=abcd1234&x=1")).toContain("x=1");
  });

  it("survives cycles and deep nesting", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const output = redact(cyclic) as Record<string, unknown>;
    expect(output.self).toBe("[CIRCULAR]");

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 12; index += 1) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    expect(JSON.stringify(redact(root))).toContain("[MAX_DEPTH]");
  });
});

describe("logger redaction", () => {
  it("never writes tokens or message bodies at info level", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      sink: (record) => lines.push(JSON.stringify(record)),
    });
    registerSecret("owner-token-value-1234567890");

    logger.info("send", {
      sessionRef: "desktop-opencode:ses_1",
      text: "the private message body",
      prompt: "system prompt",
      authorization: "Bearer abc.def",
      owner: "owner-token-value-1234567890",
    });
    logger.info("token owner-token-value-1234567890 was rejected");

    const output = lines.join("\n");
    expect(output).not.toContain("private message body");
    expect(output).not.toContain("system prompt");
    expect(output).not.toContain("abc.def");
    expect(output).not.toContain("owner-token-value-1234567890");
    expect(output).toContain("ses_1");
  });
});
