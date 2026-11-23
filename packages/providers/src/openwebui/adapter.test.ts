import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OpenWebUIAdapter } from "./adapter";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  parentId: string | null;
  childrenIds: string[];
  timestamp: number;
  done?: boolean;
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

function chatTree(streaming = false): {
  currentId: string;
  messages: Record<string, Message>;
} {
  const messages: Record<string, Message> = {
    u1: {
      id: "u1",
      role: "user",
      content: "first",
      parentId: null,
      childrenIds: ["a1"],
      timestamp: 1,
    },
    a1: {
      id: "a1",
      role: "assistant",
      content: "one",
      parentId: "u1",
      childrenIds: ["u2"],
      timestamp: 2,
      done: true,
    },
    u2: {
      id: "u2",
      role: "user",
      content: "second",
      parentId: "a1",
      childrenIds: ["a2"],
      timestamp: 3,
    },
    a2: {
      id: "a2",
      role: "assistant",
      content: "two",
      parentId: "u2",
      childrenIds: [],
      timestamp: 4,
      done: !streaming,
    },
  };
  return { currentId: "a2", messages };
}

async function historyServer(streaming = false): Promise<{
  adapter: OpenWebUIAdapter;
  calls: Array<{ method: string; path: string; body: unknown }>;
}> {
  const tree = chatTree(streaming);
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: request.method ?? "GET", path: url.pathname, body });
      if (url.pathname === "/api/v1/chats/chat_1") {
        if (request.method === "POST") {
          const next = (
            body as {
              chat?: { history?: { currentId?: string } };
            }
          )?.chat?.history?.currentId;
          if (next) tree.currentId = next;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "chat_1",
            title: "Tree",
            chat: {
              models: ["model"],
              history: tree,
            },
            updated_at: 10,
            created_at: 1,
          }),
        );
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
    adapter: new OpenWebUIAdapter({
      id: "openwebui",
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "test",
    }),
    calls,
  };
}

describe("OpenWebUIAdapter history", () => {
  it("reports the latest turn as undoable on a linear chat", async () => {
    const { adapter } = await historyServer();
    const history = await adapter.history(
      "openwebui:chat_1",
      AbortSignal.timeout(5_000),
    );
    expect(history).toEqual({
      mode: "branch",
      canUndo: true,
      canRedo: false,
    });
  });

  it("hides the last turn by moving currentId to its parent", async () => {
    const { adapter, calls } = await historyServer();
    const undone = await adapter.undoLastTurn(
      "openwebui:chat_1",
      AbortSignal.timeout(5_000),
    );

    expect(undone).toEqual({
      mode: "branch",
      canUndo: false,
      canRedo: true,
      staged: { messageId: "u2", files: [] },
      prompt: { text: "second", attachments: [] },
    });
    expect(
      calls.find((call) => call.method === "POST")?.body,
    ).toEqual({ chat: { history: { currentId: "a1" } } });
  });

  it("restores the undone turn by descending to the leaf", async () => {
    const { adapter, calls } = await historyServer();
    await adapter.undoLastTurn(
      "openwebui:chat_1",
      AbortSignal.timeout(5_000),
    );
    const restored = await adapter.redoLastTurn(
      "openwebui:chat_1",
      AbortSignal.timeout(5_000),
    );

    expect(restored).toEqual({
      mode: "branch",
      canUndo: true,
      canRedo: false,
    });
    expect(
      calls.filter((call) => call.method === "POST").at(-1)?.body,
    ).toEqual({ chat: { history: { currentId: "a2" } } });
  });

  it("refuses to undo while a response is streaming", async () => {
    const { adapter, calls } = await historyServer(true);
    await expect(
      adapter.undoLastTurn(
        "openwebui:chat_1",
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toThrow(/Wait for the current response/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
