import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderError } from "../errors";
import { readProviderResource } from "./resource";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function serve(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("readProviderResource", () => {
  it("fetches a provider resource with credentials", async () => {
    const baseUrl = await serve((request, response) => {
      expect(request.headers.authorization).toBe("Bearer test-token");
      response.writeHead(200, {
        "Content-Type": "image/png; charset=binary",
        "Content-Disposition": 'inline; filename="shot.png"',
      });
      response.end(Buffer.from("png"));
    });

    const resource = await readProviderResource({
      url: `${baseUrl}/api/files/shot.png`,
      baseUrl,
      headers: { Authorization: "Bearer test-token" },
      signal: AbortSignal.timeout(2_000),
      providerLabel: "Test",
    });

    expect(Buffer.from(resource.body).toString()).toBe("png");
    expect(resource.contentType).toBe("image/png");
    expect(resource.filename).toBe("shot.png");
  });

  it("follows a same-origin redirect", async () => {
    const baseUrl = await serve((request, response) => {
      if (request.url === "/old") {
        response.writeHead(302, { Location: "/new" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("ok");
    });

    const resource = await readProviderResource({
      url: `${baseUrl}/old`,
      baseUrl,
      headers: {},
      signal: AbortSignal.timeout(2_000),
      providerLabel: "Test",
    });
    expect(Buffer.from(resource.body).toString()).toBe("ok");
  });

  it("rejects cross-origin URLs", async () => {
    const baseUrl = await serve((_request, response) => response.end("no"));
    await expect(
      readProviderResource({
        url: baseUrl.replace("127.0.0.1", "localhost") + "/file",
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("rejects cross-origin redirects", async () => {
    const baseUrl = await serve((_request, response) => {
      response.writeHead(302, {
        Location: "https://example.com/file",
      });
      response.end();
    });

    await expect(
      readProviderResource({
        url: `${baseUrl}/file`,
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("rejects declared and streamed bodies over the limit", async () => {
    const baseUrl = await serve((request, response) => {
      if (request.url === "/declared") {
        response.writeHead(200, {
          "Content-Type": "text/plain",
          "Content-Length": "100",
        });
        response.end("x".repeat(100));
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("x".repeat(100));
    });

    await expect(
      readProviderResource({
        url: `${baseUrl}/declared`,
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });

    await expect(
      readProviderResource({
        url: `${baseUrl}/streamed`,
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
        maxBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("maps provider auth and missing resources", async () => {
    const baseUrl = await serve((request, response) => {
      response.writeHead(request.url === "/missing" ? 404 : 401);
      response.end();
    });

    await expect(
      readProviderResource({
        url: `${baseUrl}/private`,
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
      }),
    ).rejects.toMatchObject({ code: "provider_auth_error" });

    await expect(
      readProviderResource({
        url: `${baseUrl}/missing`,
        baseUrl,
        headers: {},
        signal: AbortSignal.timeout(2_000),
        providerLabel: "Test",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
