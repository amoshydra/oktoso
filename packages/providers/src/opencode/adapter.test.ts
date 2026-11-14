import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenCodeAdapter,
  openCodeSessionStatus,
  type OpenCodeSessionRaw,
} from "./adapter";

function session(
  time: Partial<OpenCodeSessionRaw["time"]>,
  outcome?: OpenCodeSessionRaw["outcome"],
): OpenCodeSessionRaw {
  return {
    id: "ses_test",
    title: "Test session",
    time: { created: 1_000, updated: 1_000, ...time },
    ...(outcome ? { outcome } : {}),
  };
}

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function retryServer(stageFiles: unknown[]): Promise<{
  adapter: OpenCodeAdapter;
  calls: RecordedCall[];
}> {
  const calls: RecordedCall[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: request.method ?? "GET", path: url.pathname, body });
      if (url.pathname.endsWith("/message")) {
        json(response, 200, {
          data: [
            {
              id: "msg_assistant",
              type: "assistant",
              time: { created: 2, completed: 3 },
              content: [],
              error: { type: "provider.quota" },
            },
            {
              id: "msg_user",
              type: "user",
              time: { created: 1 },
              text: "retry me",
            },
          ],
          cursor: { next: null, previous: null },
        });
        return;
      }
      if (url.pathname.endsWith("/revert/stage")) {
        json(response, 200, {
          data: { messageID: "msg_user", files: stageFiles },
        });
        return;
      }
      if (url.pathname.endsWith("/revert/commit")) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname.endsWith("/revert")) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname.endsWith("/prompt")) {
        json(response, 200, { data: { id: "msg_new" } });
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    adapter: new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    }),
    calls,
  };
}

describe("OpenCodeAdapter form attention", () => {
  it("keeps option descriptions, the custom answer, and required fields", async () => {
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/api/permission/request")) {
        json(response, 200, { data: [] });
        return;
      }
      if (request.url?.startsWith("/api/form")) {
        json(response, 200, {
          data: [
            {
              id: "frm_1",
              sessionID: "ses_test",
              title: "Questions",
              fields: [
                {
                  key: "q0",
                  title: "TUI dependencies",
                  description: "How should the TUI handle terminal input?",
                  type: "string",
                  options: [
                    {
                      value: "x/term",
                      label: "golang.org/x/term only",
                      description: "Adds two modules and keeps cross-compiles.",
                    },
                  ],
                  custom: true,
                },
              ],
            },
          ],
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const adapter = new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    });

    const attention = await adapter.listAttention(
      [],
      AbortSignal.timeout(5_000),
    );
    const form = attention.find((item) => item.type === "question");
    expect(form?.summary).toBe("1 field needs an answer");
    expect(form?.fields?.[0]).toMatchObject({
      id: "q0",
      description: "How should the TUI handle terminal input?",
      required: true,
      custom: true,
      options: [
        {
          value: "x/term",
          label: "golang.org/x/term only",
          description: "Adds two modules and keeps cross-compiles.",
        },
      ],
    });
  });
});

describe("OpenCodeAdapter.retryMessage", () => {
  it("reverts the failed user turn and replays its text", async () => {
    const { adapter, calls } = await retryServer([]);
    const result = await adapter.retryMessage(
      "desktop-opencode:ses_test",
      "msg_assistant",
      AbortSignal.timeout(5_000),
    );

    expect(result).toEqual({ accepted: true, messageID: "msg_new" });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/session/ses_test/message",
      "POST /api/session/ses_test/revert/stage",
      "POST /api/session/ses_test/revert/commit",
      "POST /api/session/ses_test/prompt",
    ]);
    expect(calls[1]?.body).toEqual({ messageID: "msg_user" });
    expect(calls[3]?.body).toEqual({ text: "retry me" });
  });

  it("refuses to retry a turn that changed files", async () => {
    const { adapter, calls } = await retryServer([{ path: "src/app.ts" }]);
    await expect(
      adapter.retryMessage(
        "desktop-opencode:ses_test",
        "msg_assistant",
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toThrow(/changed file/);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/session/ses_test/message",
      "POST /api/session/ses_test/revert/stage",
      "DELETE /api/session/ses_test/revert",
    ]);
  });
});

describe("openCodeSessionStatus", () => {
  it("stays idle after a completed run", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("idle");
  });

  it("is running while a new run is busy after a previous idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, busy: 3_000, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("running");
  });

  it("is running for the first execution", () => {
    expect(
      openCodeSessionStatus(session({ updated: 2_000, busy: 1_500 })),
    ).toBe("running");
  });

  it("is idle before the first execution", () => {
    expect(openCodeSessionStatus(session({ updated: 1_000 }))).toBe("idle");
  });

  it("reports a failed completed run as error", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500, idle: 2_000 }, "failed"),
      ),
    ).toBe("error");
  });

  it("prefers running over the previous failed outcome", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, busy: 3_000, idle: 2_000 }, "failed"),
      ),
    ).toBe("running");
  });

  it("treats an interrupted run as idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, idle: 2_000 }, "interrupted"),
      ),
    ).toBe("idle");
  });

  it("uses idle when an older provider omits busy", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("idle");
  });

  it("treats an older provider's first run as running", () => {
    expect(openCodeSessionStatus(session({ updated: 2_000 }))).toBe("running");
  });
});
