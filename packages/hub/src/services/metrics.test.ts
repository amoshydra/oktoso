import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { describe, expect, it } from "vitest";
import { renderMetrics } from "./metrics";
import type { EventBus } from "./event-bus";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";

async function metrics(): Promise<string> {
  const store = new MemoryStateStore();
  await store.update((state) => {
    state.notificationDeliveries = [
      {
        id: "n1",
        channel: "webpush",
        attentionID: "a1",
        sessionRef: "p:s1",
        status: "sent",
        attempts: 1,
        createdAt: 1,
      },
      {
        id: "n2",
        channel: "webpush",
        attentionID: "a2",
        sessionRef: "p:s2",
        status: "failed",
        attempts: 3,
        createdAt: 2,
      },
    ];
    state.automationRuns = [
      {
        id: "r1",
        watcherID: "w",
        trigger: "attention:question",
        decision: "acted",
        reason: "answered",
        at: 1,
      },
      {
        id: "r2",
        watcherID: "w",
        trigger: "attention:question",
        decision: "skipped",
        reason: "budget",
        at: 2,
      },
    ];
    state.automationApprovals = [
      {
        id: "ap1",
        watcherID: "w",
        attentionID: "a3",
        sessionRef: "p:s3",
        title: "Approve",
        summary: "Proceed?",
        action: { kind: "escalate" },
        reason: "not_low_risk",
        status: "pending",
        createdAt: 1,
        expiresAt: 2,
      },
    ];
    state.automationPaused = true;
    state.notificationSubscriptions = {
      d1: {
        id: "d1",
        deviceID: "phone",
        endpoint: "https://push.example.com/1",
        p256dh: "k",
        auth: "a",
        createdAt: 1,
        lastSeenAt: 1,
      },
    };
  });

  return renderMetrics({
    version: "0.2.1",
    startedAt: 1_000,
    registry: {
      list: () => [
        { id: "desk", type: "opencode", status: "online" },
        { id: 'we"ird', type: "openwebui", status: "offline" },
      ],
    } as unknown as ProviderRegistry,
    sessions: {
      cached: () => [{}, {}],
    } as unknown as SessionService,
    eventBus: {
      lastSeq: 7,
      bufferLength: 3,
      subscriberCount: 2,
    } as unknown as EventBus,
    store,
    now: () => 61_000,
  });
}

describe("renderMetrics", () => {
  it("exposes hub, provider, event, and store counters", async () => {
    const text = await metrics();

    expect(text).toContain("oktoso_up 1");
    expect(text).toContain('oktoso_build_info{version="0.2.1"} 1');
    expect(text).toContain("oktoso_uptime_seconds 60");
    expect(text).toContain('oktoso_provider_up{provider="desk",type="opencode"} 1');
    expect(text).toContain('oktoso_provider_up{provider="we\\"ird",type="openwebui"} 0');
    expect(text).toContain("oktoso_sessions_cached 2");
    expect(text).toContain("oktoso_event_seq 7");
    expect(text).toContain("oktoso_event_buffer 3");
    expect(text).toContain("oktoso_sse_clients 2");
    expect(text).toContain('oktoso_notification_deliveries_recent{status="sent"} 1');
    expect(text).toContain('oktoso_notification_deliveries_recent{status="failed"} 1');
    expect(text).toContain('oktoso_automation_runs_recent{decision="acted"} 1');
    expect(text).toContain('oktoso_automation_runs_recent{decision="skipped"} 1');
    expect(text).toContain("oktoso_automation_approvals_open 1");
    expect(text).toContain("oktoso_automation_paused 1");
    expect(text).toContain("oktoso_notification_devices 1");
  });

  it("never includes session text, prompts, or credentials", async () => {
    const text = await metrics();
    expect(text).not.toContain("Approve");
    expect(text).not.toContain("Proceed?");
    expect(text).not.toContain("push.example.com");
    expect(text).not.toContain("desktop-opencode");
  });
});
