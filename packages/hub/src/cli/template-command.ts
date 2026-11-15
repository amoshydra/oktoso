import { HubClient } from "@amoshydra/oktoso-client";
import { loadPairingConfig } from "../config/load";
import { pairingRequestUrl } from "./urls";

export interface TemplateCommandOptions {
  configPath: string;
  action: "list" | "start";
  id?: string;
  url?: string;
}

/**
 * Lists and starts automation templates.
 *
 * A manual start is a human action: it ignores pause, dry run, budgets, and
 * quiet hours, and records no automation run.
 */
export async function runTemplateCommand(
  options: TemplateCommandOptions,
): Promise<void> {
  const config = await loadPairingConfig(options.configPath);
  const baseUrl =
    options.url ?? process.env.HUB_URL ?? pairingRequestUrl(config);
  const client = new HubClient({ baseUrl, token: config.token });

  if (options.action === "list") {
    const view = await client.automation();
    if (view.templates.length === 0) {
      process.stdout.write(
        "No templates configured. Add automation.templates in the hub config.\n",
      );
      return;
    }
    for (const template of view.templates) {
      process.stdout.write(
        `${template.id.padEnd(24)} ${template.providerID.padEnd(20)} ${
          template.name ?? template.title
        }\n`,
      );
    }
    return;
  }

  if (!options.id) {
    throw new Error("Template start needs --id <template id>");
  }
  const session = await client.startTemplate(options.id);
  process.stdout.write(`Started ${session.ref}\n`);
  process.stdout.write(`${session.title}\n`);
}
