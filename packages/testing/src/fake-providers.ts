import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeProviderKind = "opencode" | "openwebui" | "hermes";

export interface FakeProviderServer {
  kind: FakeProviderKind;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface FakeServerOptions {
  kind: FakeProviderKind;
  port?: number;
  host?: string;
}

const OPENCODE_SESSIONS = [
  {
    id: "ses_auth",
    title: "Fix auth race in gateway",
    directory: "/home/me/agent-hub",
    project: "agent-hub",
    time: { created: 1, updated: 2 },
  },
];

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/api/info") {
    sendJson(response, 200, { version: "0.0.0-fake-opencode" });
    return;
  }
  if (path === "/api/session") {
    sendJson(response, 200, { data: OPENCODE_SESSIONS, cursor: { next: null } });
    return;
  }
  if (path === "/api/v1/models") {
    sendJson(response, 200, {
      data: [{ id: "fake-model", name: "Fake Model" }],
    });
    return;
  }
  if (path === "/api/v1/chats/list") {
    sendJson(response, 200, {
      data: [
        {
          id: "chat_fake",
          title: "Fake Open WebUI chat",
          updated_at: 2,
          created_at: 1,
        },
      ],
      cursor: { next: null },
    });
    return;
  }
  if (path === "/v1/capabilities") {
    sendJson(response, 200, {
      version: "0.0.0-fake-hermes",
      capabilities: ["sessions", "messages", "approvals"],
    });
    return;
  }
  if (path === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "not_found", path });
}

export async function createFakeProviderServer(
  options: FakeServerOptions,
): Promise<FakeProviderServer> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    try {
      handle(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    kind: options.kind,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function createFakeProviderServers(): Promise<FakeProviderServer[]> {
  return Promise.all([
    createFakeProviderServer({ kind: "opencode", port: 4101 }),
    createFakeProviderServer({ kind: "openwebui", port: 4102 }),
    createFakeProviderServer({ kind: "hermes", port: 4103 }),
  ]);
}
