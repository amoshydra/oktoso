import { describe, expect, it, vi } from "vitest";
import type {
  AttentionPage,
  AutomationApproval,
  AutomationRun,
  AutomationView,
  Provider,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import { withProviderPolicy } from "./policy";
import type { McpHubApi } from "./server";

const providers = [
  { id: "opencode", name: "opencode" },
  { id: "openwebui", name: "openwebui" },
] as unknown as Provider[];

const sessions = {
  data: [
    { ref: "opencode:ses_a", providerID: "opencode" },
    { ref: "openwebui:chat_b", providerID: "openwebui" },
  ],
} as unknown as SessionPage;

const attention = {
  data: [
    { id: "opencode:permission:ses_a:1", sessionRef: "opencode:ses_a" },
    { id: "openwebui:error:chat_b:1", sessionRef: "openwebui:chat_b" },
  ],
} as unknown as AttentionPage;

const automationView: AutomationView = {
  enabled: true,
  paused: false,
  dryRun: true,
  templates: [
    {
      id: "nightly_open",
      providerID: "opencode",
      title: "Nightly open",
      text: "Leaked prompt text",
    },
    {
      id: "nightly_web",
      providerID: "openwebui",
      title: "Nightly web",
      text: "Leaked prompt text",
    },
  ],
  watchers: [
    {
      id: "global",
      enabled: true,
      trigger: { kind: "attention", types: ["question"] },
      action: { kind: "escalate" },
      dryRun: true,
      limits: { maxActionsPerHour: 6, maxActionsPerDay: 24 },
    },
    {
      id: "open",
      enabled: true,
      trigger: { kind: "attention", types: ["question"] },
      condition: { providerID: "opencode" },
      action: { kind: "escalate" },
      dryRun: true,
      limits: { maxActionsPerHour: 6, maxActionsPerDay: 24 },
    },
    {
      id: "web",
      enabled: true,
      trigger: { kind: "attention", types: ["question"] },
      condition: { providerID: "openwebui" },
      action: { kind: "escalate" },
      dryRun: true,
      limits: { maxActionsPerHour: 6, maxActionsPerDay: 24 },
    },
  ],
  pausedWatchers: ["open", "web"],
  runs: [
    {
      id: "run_open",
      watcherID: "open",
      trigger: "attention:question",
      decision: "acted",
      reason: "answered",
      sessionRef: "opencode:ses_a",
      at: 1,
    },
    {
      id: "run_web",
      watcherID: "web",
      trigger: "attention:question",
      decision: "acted",
      reason: "answered",
      sessionRef: "openwebui:chat_b",
      at: 2,
    },
  ] as AutomationRun[],
  approvals: [
    {
      id: "approval_open",
      watcherID: "open",
      attentionID: "att_open",
      sessionRef: "opencode:ses_a",
      title: "Open",
      summary: "Open",
      action: { kind: "escalate" },
      reason: "not_low_risk",
      status: "pending",
      createdAt: 1,
      expiresAt: 2,
      actionable: false,
      allowShape: false,
    },
    {
      id: "approval_web",
      watcherID: "web",
      attentionID: "att_web",
      sessionRef: "openwebui:chat_b",
      title: "Web",
      summary: "Web",
      action: { kind: "escalate" },
      reason: "not_low_risk",
      status: "pending",
      createdAt: 1,
      expiresAt: 2,
      actionable: false,
    },
  ] as AutomationApproval[],
  allowedShapes: [
    {
      id: "shape_open",
      watcherID: "open",
      kind: "boolean",
      choices: ["No", "Yes"],
      choice: "yes",
      label: "Yes",
      createdAt: 1,
      uses: 0,
    },
    {
      id: "shape_web",
      watcherID: "web",
      kind: "boolean",
      choices: ["No", "Yes"],
      choice: "yes",
      label: "Yes",
      createdAt: 1,
      uses: 0,
    },
  ],
};

function createApi() {
  return {
    providers: vi.fn(async () => providers),
    checkProvider: vi.fn(async () => ({ status: "online" })),
    sessions: vi.fn(async () => sessions),
    session: vi.fn(async () => ({ ref: "opencode:ses_a" })),
    messages: vi.fn(async () => ({ data: [] })),
    question: vi.fn(async () => null),
    attention: vi.fn(async () => attention),
    sendMessage: vi.fn(async () => ({ id: "message-1" })),
    createSession: vi.fn(async () => ({ ref: "opencode:ses_new" })),
    interrupt: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    actOnAttention: vi.fn(async () => undefined),
    automation: vi.fn(async () => automationView),
    automationRuns: vi.fn(async () => automationView.runs),
    approvals: vi.fn(async () => automationView.approvals),
    setAutomation: vi.fn(async () => automationView),
    setWatcherPaused: vi.fn(async () => automationView),
    actOnApproval: vi.fn(async () => undefined),
  } as unknown as McpHubApi;
}

describe("withProviderPolicy", () => {
  it("returns the original API when no allowlist is configured", () => {
    const api = createApi();
    expect(withProviderPolicy(api, undefined)).toBe(api);
    expect(withProviderPolicy(api, [])).toBe(api);
  });

  it("filters provider and session listings", async () => {
    const api = createApi();
    const scoped = withProviderPolicy(api, ["opencode"]);

    await expect(scoped.providers()).resolves.toEqual([providers[0]]);
    await expect(scoped.sessions({ limit: 10 })).resolves.toMatchObject({
      data: [sessions.data[0]],
    });
    expect(api.sessions).toHaveBeenCalledWith({
      limit: 10,
      provider: "opencode",
    });
  });

  it("rejects reads and writes for another provider", async () => {
    const scoped = withProviderPolicy(createApi(), ["opencode"]);

    await expect(scoped.checkProvider("openwebui")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.session("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.messages("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(
      scoped.sendMessage("openwebui:chat_b", { text: "hello" }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      scoped.createSession({ providerID: "openwebui", title: "new" }),
    ).rejects.toThrow(/not allowed/);
    await expect(scoped.interrupt("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.markRead("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
  });

  it("filters automation watchers, runs, and approvals by provider", async () => {
    const scoped = withProviderPolicy(createApi(), ["opencode"]);

    const view = await scoped.automation();
    expect(view.watchers.map((watcher) => watcher.id)).toEqual([
      "global",
      "open",
    ]);
    expect(view.pausedWatchers).toEqual(["open"]);
    expect(view.runs.map((run) => run.id)).toEqual(["run_open"]);
    expect(view.approvals.map((approval) => approval.id)).toEqual([
      "approval_open",
    ]);
    expect(view.allowedShapes.map((shape) => shape.id)).toEqual([
      "shape_open",
    ]);
    expect(view.templates.map((template) => template.id)).toEqual([
      "nightly_open",
    ]);
  });

  it("filters attention and blocks actions on hidden items", async () => {
    const api = createApi();
    const scoped = withProviderPolicy(api, ["opencode"]);

    await expect(scoped.attention()).resolves.toMatchObject({
      data: [attention.data[0]],
    });
    await expect(
      scoped.actOnAttention("openwebui:error:chat_b:1", "dismiss"),
    ).rejects.toThrow(/not allowed|not found/);
    await expect(
      scoped.actOnAttention("opencode:permission:ses_a:1", "allow_once"),
    ).resolves.toBeUndefined();
    expect(api.actOnAttention).toHaveBeenCalledWith(
      "opencode:permission:ses_a:1",
      "allow_once",
      undefined,
    );
  });
});
