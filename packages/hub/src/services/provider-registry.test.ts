import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../lib/logger";
import { ProviderRegistry } from "./provider-registry";

const logger = createLogger({ level: "silent" });
const config = {
  id: "pi-hermes",
  type: "hermes",
  baseUrl: "http://192.0.2.10:8642",
  enabled: true,
  timeoutMs: 20_000,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ProviderRegistry health checks", () => {
  it("backs off after failures and resets after a success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const registry = new ProviderRegistry([config], logger);

    expect((await registry.check(config.id)).status).toBe("offline");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await registry.checkDue();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect((await registry.checkDue())[0]?.status).toBe("offline");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10_000);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const online = await registry.checkDue();
    expect(online[0]).toMatchObject({ status: "online", version: "1.2.3" });

    await registry.checkDue();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("deduplicates checks that are already in flight", async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetchMock = vi.fn(async () => pending);
    vi.stubGlobal("fetch", fetchMock);
    const registry = new ProviderRegistry([config], logger);

    const first = registry.check(config.id);
    const second = registry.check(config.id);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(new Response("{}", { status: 200 }));
    await expect(first).resolves.toMatchObject({ status: "online" });
  });

  it("notifies only when the provider status changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const changes: Array<{ id: string; status: string }> = [];
    const registry = new ProviderRegistry([config], logger, (provider) => {
      changes.push({ id: provider.id, status: provider.status });
    });

    await registry.check(config.id);
    await registry.check(config.id);

    expect(changes).toEqual([{ id: config.id, status: "online" }]);
  });

  it("exposes the configured timeout with a safe default", () => {
    const registry = new ProviderRegistry([config], logger);
    expect(registry.timeoutMs(config.id)).toBe(20_000);
    expect(registry.timeoutMs("missing")).toBe(20_000);
  });
});
