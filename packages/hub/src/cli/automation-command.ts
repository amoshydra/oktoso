import { HubClient } from "@amoshydra/oktoso-client";
import type { AutomationView } from "@amoshydra/oktoso-contracts";
import { loadPairingConfig } from "../config/load";
import { pairingRequestUrl } from "./urls";

export interface AutomationCommandOptions {
  configPath: string;
  action: "status" | "pause" | "resume";
  watcher?: string;
  url?: string;
}

export async function runAutomationCommand(
  options: AutomationCommandOptions,
): Promise<void> {
  const config = await loadPairingConfig(options.configPath);
  const baseUrl =
    options.url ?? process.env.HUB_URL ?? pairingRequestUrl(config);
  const client = new HubClient({ baseUrl, token: config.token });

  if (options.action === "status") {
    printView(await client.automation());
    return;
  }

  const paused = options.action === "pause";
  const view = options.watcher
    ? await client.pauseWatcher(options.watcher, paused)
    : await client.saveAutomation({ paused });
  printView(view);
}

function printView(view: AutomationView): void {
  const state = !view.enabled
    ? "off"
    : view.paused
      ? "paused"
      : view.dryRun
        ? "dry run"
        : "armed";
  const paused = view.pausedWatchers.length;

  process.stdout.write(`Automation: ${state}\n`);
  process.stdout.write(
    `Watchers: ${view.watchers.length}${paused > 0 ? ` (${paused} paused)` : ""}\n`,
  );
  process.stdout.write(`Approvals: ${view.approvals.length} pending\n`);

  if (view.runs.length > 0) {
    process.stdout.write("Recent runs:\n");
    for (const run of view.runs.slice(0, 5)) {
      process.stdout.write(
        `  ${run.decision.padEnd(9)} ${run.watcherID.padEnd(20)} ${run.detail ?? run.reason}\n`,
      );
    }
  }
}
