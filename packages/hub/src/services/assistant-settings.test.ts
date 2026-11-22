import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { AssistantSettingsService } from "./assistant-settings";
import { createSecretBox } from "../lib/secret-box";

const box = () => createSecretBox("test-token");

const config = {
  enabled: true,
  baseUrl: "https://config.example/v1",
  model: "config-model",
  timeoutMs: 90_000,
  maxContextMessages: 20,
  allowWrite: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssistantSettingsService agent settings", () => {
  it("seeds the endpoint from config once, then keeps runtime edits", async () => {
    const service = new AssistantSettingsService(new MemoryStateStore(), box());
    await service.seedAgent(config);
    expect(service.view().agent).toMatchObject({
      baseUrl: "https://config.example/v1",
      model: "config-model",
      enabled: true,
    });

    await service.update({
      agent: { baseUrl: "https://runtime.example/v1", model: "runtime-model" },
    });
    await service.seedAgent(config);
    expect(service.view().agent).toMatchObject({
      baseUrl: "https://runtime.example/v1",
      model: "runtime-model",
    });
  });

  it("seals a stored key, opens it for calls, and clears it with null", async () => {
    const store = new MemoryStateStore();
    const service = new AssistantSettingsService(store, box());
    await service.update({
      agent: { baseUrl: "https://x/v1", model: "m", apiKey: "secret" },
    });
    const stored = store.getState().settings.agent.apiKey ?? "";
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("secret");
    expect(service.config().agent.apiKey).toBe("secret");
    expect(service.view().agent?.hasApiKey).toBe(true);
    expect(JSON.stringify(service.view())).not.toContain("secret");

    await service.update({ agent: { apiKey: null } });
    expect(service.view().agent?.hasApiKey).toBe(false);
    expect(service.config().agent.apiKey).toBeUndefined();
  });

  it("fails closed when the owner token changed", async () => {
    const store = new MemoryStateStore();
    await new AssistantSettingsService(store, box()).update({
      agent: { baseUrl: "https://x/v1", model: "m", apiKey: "secret" },
    });
    const other = new AssistantSettingsService(
      store,
      createSecretBox("other-token"),
    );
    expect(other.config().agent.apiKey).toBeUndefined();
    expect(other.view().agent?.hasApiKey).toBe(false);
  });

  it("seals a plaintext key left by an older build", async () => {
    const store = new MemoryStateStore();
    await store.update((state) => {
      state.settings.agent.apiKey = "legacy";
    });
    const service = new AssistantSettingsService(store, box());
    await service.migrate();
    const stored = store.getState().settings.agent.apiKey ?? "";
    expect(stored.startsWith("v1:")).toBe(true);
    expect(service.config().agent.apiKey).toBe("legacy");
  });

  it("lists agent models with the saved key", async () => {
    const service = new AssistantSettingsService(new MemoryStateStore(), box());
    await service.update({
      agent: { baseUrl: "https://models.example/v1", model: "m", apiKey: "k" },
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://models.example/v1/models");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer k",
      );
      return new Response(JSON.stringify({ data: [{ id: "one" }, { id: "two" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.listModels("agent");
    expect(result.data).toEqual(["one", "two"]);
    expect(result.baseUrl).toBe("https://models.example/v1");
  });

  it("tests the endpoint with the unsaved form values", async () => {
    const service = new AssistantSettingsService(new MemoryStateStore(), box());
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.testAgent({
      baseUrl: "https://try.example/v1",
      model: "candidate",
      apiKey: "k",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.model).toBe("candidate");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://try.example/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const failed = await service.testAgent({
      baseUrl: "https://try.example/v1",
      model: "candidate",
    });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("401");
  });
});
