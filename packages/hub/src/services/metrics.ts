import type { StateStore } from "@amoshydra/oktoso-storage";
import type { EventBus } from "./event-bus";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";

export interface MetricsSources {
  version: string;
  startedAt: number;
  registry: ProviderRegistry;
  sessions: SessionService;
  eventBus: EventBus;
  store: StateStore;
  now?: () => number;
}

/**
 * Prometheus text exposition for the hub.
 *
 * Only counts, statuses, and timings. Never a message body, prompt, provider
 * credential, or session title: the scrape endpoint is authenticated, but the
 * series are safe to forward to a long-lived metrics store.
 *
 * Counters that read from bounded logs say `_recent` in the name so nobody
 * mistakes them for lifetime totals.
 */
export function renderMetrics(sources: MetricsSources): string {
  const now = sources.now?.() ?? Date.now();
  const state = sources.store.getState();
  const lines: string[] = [];
  const emit = (line: string) => lines.push(line);

  emit("# HELP oktoso_up Hub process is up.");
  emit("# TYPE oktoso_up gauge");
  emit("oktoso_up 1");

  emit("# HELP oktoso_build_info Build version.");
  emit("# TYPE oktoso_build_info gauge");
  emit(`oktoso_build_info{version="${escape(sources.version)}"} 1`);

  emit("# HELP oktoso_uptime_seconds Seconds since this process started.");
  emit("# TYPE oktoso_uptime_seconds gauge");
  emit(`oktoso_uptime_seconds ${Math.max(0, (now - sources.startedAt) / 1000)}`);

  const providers = sources.registry.list();
  const deliveries = state.notificationDeliveries ?? [];
  const runs = state.automationRuns ?? [];
  const approvals = state.automationApprovals ?? [];
  emit("# HELP oktoso_provider_up Provider health: 1 online, 0 otherwise.");
  emit("# TYPE oktoso_provider_up gauge");
  for (const provider of providers) {
    emit(
      `oktoso_provider_up{provider="${escape(provider.id)}",type="${escape(provider.type)}"} ${
        provider.status === "online" ? 1 : 0
      }`,
    );
  }
  emit("# HELP oktoso_providers Number of configured providers by status.");
  emit("# TYPE oktoso_providers gauge");
  const providerStatuses = countBy(providers.map((provider) => provider.status));
  for (const status of ["online", "offline", "auth-error", "unknown"]) {
    emit(`oktoso_providers{status="${status}"} ${providerStatuses.get(status) ?? 0}`);
  }

  emit("# HELP oktoso_sessions_cached Sessions the hub currently holds in memory.");
  emit("# TYPE oktoso_sessions_cached gauge");
  emit(`oktoso_sessions_cached ${sources.sessions.cached().length}`);

  emit("# HELP oktoso_event_seq Last published event sequence.");
  emit("# TYPE oktoso_event_seq gauge");
  emit(`oktoso_event_seq ${sources.eventBus.lastSeq}`);

  emit("# HELP oktoso_event_buffer Events retained for replay.");
  emit("# TYPE oktoso_event_buffer gauge");
  emit(`oktoso_event_buffer ${sources.eventBus.bufferLength}`);

  emit("# HELP oktoso_sse_clients Connected event-stream subscribers.");
  emit("# TYPE oktoso_sse_clients gauge");
  emit(`oktoso_sse_clients ${sources.eventBus.subscriberCount}`);

  emit("# HELP oktoso_notification_deliveries_recent Delivery outcomes in the bounded log.");
  emit("# TYPE oktoso_notification_deliveries_recent gauge");
  const deliveryStatuses = countBy(deliveries.map((delivery) => delivery.status));
  for (const status of ["queued", "sent", "failed", "skipped"]) {
    emit(
      `oktoso_notification_deliveries_recent{status="${status}"} ${
        deliveryStatuses.get(status) ?? 0
      }`,
    );
  }

  emit("# HELP oktoso_automation_runs_recent Supervisor decisions in the bounded audit log.");
  emit("# TYPE oktoso_automation_runs_recent gauge");
  const decisions = countBy(runs.map((run) => run.decision));
  for (const decision of ["acted", "escalated", "dry_run", "skipped", "failed"]) {
    emit(
      `oktoso_automation_runs_recent{decision="${decision}"} ${
        decisions.get(decision) ?? 0
      }`,
    );
  }

  emit("# HELP oktoso_automation_approvals_open Approvals waiting for a human.");
  emit("# TYPE oktoso_automation_approvals_open gauge");
  emit(
    `oktoso_automation_approvals_open ${
      approvals.filter((approval) => approval.status === "pending").length
    }`,
  );

  emit("# HELP oktoso_automation_paused Whether the supervisor is paused.");
  emit("# TYPE oktoso_automation_paused gauge");
  emit(`oktoso_automation_paused ${state.automationPaused ? 1 : 0}`);

  emit("# HELP oktoso_notification_devices Registered push devices.");
  emit("# TYPE oktoso_notification_devices gauge");
  emit(
    `oktoso_notification_devices ${
      Object.keys(state.notificationSubscriptions ?? {}).length
    }`,
  );

  return `${lines.join("\n")}\n`;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Map([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function escape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
