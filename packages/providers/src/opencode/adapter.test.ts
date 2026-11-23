import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  OpenCodeAdapter,
  STALE_RUNNING_MS,
  openCodeSessionStatus,
  type OpenCodeSessionRaw,
} from "./adapter";

function session(
  time: Partial<OpenCodeSessionRaw["time"]>,
  outcome?: OpenCodeSessionRaw["outcome"],
  fork?: OpenCodeSessionRaw["fork"],
): OpenCodeSessionRaw {
  return {
    id: "ses_test",
    title: "Test session",
    time: { created: 1_000, updated: 1_000, ...time },
    ...(outcome ? { outcome } : {}),
    ...(fork ? { fork } : {}),
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

describe("OpenCodeAdapter.readFile", () => {
  it("names the path when a project file is missing", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    const adapter = new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    });

    await expect(
      adapter.readFile(
        {
          ref: "ses_test",
          directory: "/tmp/project",
          path: "docs/reports/missing.html",
        },
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toThrow(
      "File not found in this session's working directory: docs/reports/missing.html",
    );
  });
});

describe("OpenCodeAdapter.openFile", () => {
  it("forwards a seek upstream and keeps the provider's content range", async () => {
    let seen: string | undefined;
    const server = createServer((request, response) => {
      seen = request.headers.range;
      response.writeHead(206, {
        "content-type": "video/mp4",
        "content-range": "bytes 2-3/10",
        "content-length": "2",
      });
      response.end("cd");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const adapter = new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    });

    const opened = await adapter.openFile(
      {
        ref: "ses_test",
        directory: "/tmp/project",
        path: "clips/race.mp4",
        maxBytes: 256 * 1024 * 1024,
        range: "bytes=2-3",
      },
      AbortSignal.timeout(5_000),
    );

    expect(seen).toBe("bytes=2-3");
    expect(opened.status).toBe(206);
    if (opened.status === 416) throw new Error("unsatisfiable");
    expect(opened.contentRange).toBe("bytes 2-3/10");
    expect(opened.filename).toBe("race.mp4");
    expect(await new Response(opened.stream).text()).toBe("cd");
  });
});


describe("OpenCodeAdapter live compaction", () => {
  it("emits a running compaction before its summary, then updates it", async () => {
    const server = createServer((request, response) => {
      if (request.url !== "/api/event") {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const base = {
        id: "msg_compaction",
        sessionID: "ses_test",
        role: "system",
        type: "compaction",
        reason: "auto",
        time: { created: 1_000 },
      };
      response.write(
        `data: ${JSON.stringify({
          type: "message.updated",
          properties: { info: { ...base, status: "running" } },
        })}\n\n`,
      );
      setTimeout(() => {
        response.write(
          `data: ${JSON.stringify({
            type: "message.updated",
            properties: {
              info: { ...base, status: "completed", summary: "compressed history" },
            },
          })}\n\n`,
        );
      }, 20);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const adapter = new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    });

    type Part = { type: string; status?: string; summary?: string };
    const found: Part[] = [];
    const stop = await adapter.subscribe((event) => {
      if (event.type !== "message.updated" && event.type !== "message.created") return;
      const message = (event.data as { message?: { parts?: Part[] } }).message;
      const part = message?.parts?.find((entry) => entry.type === "compaction");
      if (part) found.push(part);
    }, AbortSignal.timeout(5_000));

    const started = Date.now();
    while (found.length < 2 && Date.now() - started < 3_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    stop();

    expect(found[0]).toMatchObject({
      type: "compaction",
      status: "running",
      summary: "",
    });
    expect(found[1]).toMatchObject({
      type: "compaction",
      status: "completed",
      summary: "compressed history",
    });
  });
});

describe("OpenCodeAdapter failed compaction", () => {

  it("keeps a failed compaction with its error and retryability", async () => {
    const server = createServer((request, response) => {
      if (request.url !== "/api/event") {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const base = {
        sessionID: "ses_test",
        role: "system",
        type: "compaction",
        reason: "manual",
        time: { created: 1_000 },
      };
      const frames = [
        {
          id: "msg_unavailable",
          status: "failed",
          error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
        },
        {
          id: "msg_failed",
          status: "failed",
          error: { type: "provider_error", message: "The model timed out" },
        },
      ];
      for (const frame of frames) {
        response.write(
          `data: ${JSON.stringify({
            type: "message.updated",
            properties: { info: { ...base, ...frame } },
          })}\n\n`,
        );
      }
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const adapter = new OpenCodeAdapter({
      id: "desktop-opencode",
      baseUrl: `http://127.0.0.1:${address.port}`,
      password: "test",
    });

    type Part = { type: string; status?: string; error?: string; retryable?: boolean };
    const found: Part[] = [];
    const stop = await adapter.subscribe((event) => {
      if (event.type !== "message.updated" && event.type !== "message.created") return;
      const message = (event.data as { message?: { parts?: Part[] } }).message;
      const part = message?.parts?.find((entry) => entry.type === "compaction");
      if (part) found.push(part);
    }, AbortSignal.timeout(5_000));

    const started = Date.now();
    while (found.length < 2 && Date.now() - started < 3_000) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    stop();

    expect(found[0]).toMatchObject({
      type: "compaction",
      status: "failed",
      error: "Nothing to compact yet",
      retryable: false,
    });
    expect(found[1]).toMatchObject({
      type: "compaction",
      status: "failed",
      error: "The model timed out",
      retryable: true,
    });
  });
});

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
    expect(calls[3]?.body).toEqual({ text: "retry me", delivery: "steer" });
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

async function promptServer(): Promise<{
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
      if (url.pathname.endsWith("/prompt")) {
        json(response, 200, { data: { id: "msg_new" } });
        return;
      }
      if (url.pathname.endsWith("/inbox")) {
        if (request.method === "GET") {
          json(response, 200, {
            data: [
              {
                id: "inb_1",
                type: "user",
                delivery: "queue",
                time: { created: 1_500 },
                payload: { text: "queued note" },
              },
            ],
          });
          return;
        }
      }
      if (url.pathname.includes("/inbox/")) {
        response.writeHead(204);
        response.end();
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

describe("OpenCodeAdapter delivery and inbox", () => {
  it("sends queued prompts with delivery queue", async () => {
    const { adapter, calls } = await promptServer();
    const result = await adapter.sendMessage(
      "desktop-opencode:ses_test",
      { text: "later", delivery: "queue" },
      AbortSignal.timeout(5_000),
    );

    expect(result).toEqual({
      accepted: true,
      messageID: "msg_new",
      delivery: "queue",
    });
    expect(calls[0]?.body).toEqual({ text: "later", delivery: "queue" });
  });

  it("defaults delivery to steer", async () => {
    const { adapter } = await promptServer();
    const result = await adapter.sendMessage(
      "desktop-opencode:ses_test",
      { text: "now" },
      AbortSignal.timeout(5_000),
    );
    expect(result.delivery).toBe("steer");
  });

  it("lists queued inbox items", async () => {
    const { adapter, calls } = await promptServer();
    const items = await adapter.listInbox(
      "desktop-opencode:ses_test",
      AbortSignal.timeout(5_000),
    );

    expect(items).toEqual([
      {
        id: "inb_1",
        type: "user",
        delivery: "queue",
        text: "queued note",
        createdAt: 1_500,
      },
    ]);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/session/ses_test/inbox",
    ]);
  });

  it("promotes and removes inbox items", async () => {
    const { adapter, calls } = await promptServer();
    await adapter.updateInbox(
      "desktop-opencode:ses_test",
      "inb_1",
      "steer",
      AbortSignal.timeout(5_000),
    );
    await adapter.deleteInbox(
      "desktop-opencode:ses_test",
      "inb_1",
      AbortSignal.timeout(5_000),
    );

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PATCH /api/session/ses_test/inbox/inb_1",
      "DELETE /api/session/ses_test/inbox/inb_1",
    ]);
    expect(calls[0]?.body).toEqual({ delivery: "steer" });
  });
});

describe("OpenCodeAdapter.renameSession", () => {
  it("patches the session title and returns the updated session", async () => {
    let patched: unknown;
    let title = "Test session";
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        if (url.pathname === "/api/session/ses_test" && request.method === "PATCH") {
          const body = raw ? (JSON.parse(raw) as { title?: string }) : {};
          patched = body;
          title = body.title ?? title;
          response.writeHead(204);
          response.end();
          return;
        }
        if (url.pathname === "/api/session/ses_test") {
          json(response, 200, {
            data: { ...session({ updated: 2000 }), title },
          });
          return;
        }
        json(response, 404, { _tag: "SessionNotFoundError" });
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const adapter = new OpenCodeAdapter({
      id: "opencode",
      baseUrl: `http://127.0.0.1:${port}`,
      username: "opencode",
      password: "secret",
    });

    const updated = await adapter.renameSession(
      "opencode:ses_test",
      "Renamed session",
      AbortSignal.timeout(5_000),
    );

    expect(patched).toEqual({ title: "Renamed session" });
    expect(updated.ref).toBe("opencode:ses_test");
    expect(updated.title).toBe("Renamed session");
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
        3_000,
      ),
    ).toBe("running");
  });

  it("is running for the first execution", () => {
    expect(
      openCodeSessionStatus(session({ updated: 2_000, busy: 1_500 }), 2_000),
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
        3_000,
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

  it("treats a session without a busy marker as idle", () => {
    expect(openCodeSessionStatus(session({ updated: 2_000 }))).toBe("idle");
  });

  it("keeps a metadata update idle when no run is busy", () => {
    expect(
      openCodeSessionStatus(session({ updated: 3_000, created: 1_000 })),
    ).toBe("idle");
  });

  it("treats a fork with no busy or idle as idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000 }, undefined, { sessionID: "ses_parent" }),
      ),
    ).toBe("idle");
  });

  it("treats a stale busy run as idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500 }),
        2_000 + STALE_RUNNING_MS + 1,
      ),
    ).toBe("idle");
  });

  it("treats a stale busy run after a previous idle as idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 3_000, idle: 1_500 }),
        2_000 + STALE_RUNNING_MS + 1,
      ),
    ).toBe("idle");
  });

  it("keeps a recent busy run running", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500 }),
        2_000 + 60_000,
      ),
    ).toBe("running");
  });
});
