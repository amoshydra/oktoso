import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { JsonStateStore } from "@agent-hub/storage";
import { parseArgs, usage, type CliOptions } from "./cli/args";
import {
  formatHubStatus,
  isPortOpen,
  probeHub,
} from "./cli/hub-status";
import {
  DEFAULT_LOG_MAX_BYTES,
  RotatingFileSink,
  resolveLogDir,
} from "./cli/log-file";
import {
  buildPairingPanel,
  formatExpiry,
  isLoopbackUrl,
  pairingUrl,
  primaryPairingUrl,
} from "./cli/pairing-panel";
import { createTheme } from "./cli/terminal";
import { TerminalUi } from "./cli/tui";
import type { PairingLinkInfo, UiSnapshot } from "./cli/types";
import {
  hubBaseUrls,
  pairingRequestUrl,
  webUrl,
} from "./cli/urls";
import { createLogger, type LogLevel, type LogRecord } from "./lib/logger";
import { ensureConfig } from "./config/bootstrap";
import { loadConfig, loadHubTarget, loadPairingConfig } from "./config/load";
import type {
  HubConfig,
  HubPairingConfig,
  HubTarget,
} from "./config/schema";
import { AuthService } from "./auth/service";
import { EventBus } from "./services/event-bus";
import { ProviderRegistry } from "./services/provider-registry";
import { SessionService } from "./services/session-service";
import { ProviderEventService } from "./services/provider-events";
import { AttentionService } from "./services/attention-service";
import { DraftService } from "./services/draft-service";
import { AssistantSettingsService } from "./services/assistant-settings";
import { ReplyService } from "./services/reply-service";
import { QuestionService } from "./services/question-service";
import { createApp } from "./app";
import { watchPairingCommands } from "./lib/pairing-prompt";
import { VERSION } from "./version";

function openExternal(url: string): boolean {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function printPairingPanel(
  config: Pick<HubConfig, "host" | "port">,
  pairing: PairingLinkInfo,
  options: {
    urls?: string[];
    firstRun?: boolean;
    interactive?: boolean;
    canPrompt?: boolean;
    color?: boolean;
  } = {},
): void {
  const urls = options.urls ?? hubBaseUrls(config);
  const color =
    options.color ?? Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

  if (!process.stdout.isTTY) {
    const base = primaryPairingUrl(urls);
    const link = base
      ? pairingUrl(base, pairing.code)
      : "(no server URLs)";
    console.log(
      `Pairing link (expires ${formatExpiry(pairing.expiresAt)}): ${link}`,
    );
    console.log("Run the pairing command again for another link.");
    return;
  }

  const columns =
    process.stdout.columns && process.stdout.columns > 0
      ? process.stdout.columns
      : 80;
  const width = Math.min(columns, 64);
  const panel = buildPairingPanel({
    pairing,
    urls,
    theme: createTheme(color),
    width,
    hint: options.canPrompt
      ? "Press p in the hub terminal for another link."
      : "Run this command again for another link.",
  });

  console.log("");
  if (options.firstRun) {
    console.log("  First run: pair this browser or device.");
    console.log("");
  } else if (options.interactive) {
    console.log("  New pairing link.");
    console.log("");
  }
  for (const line of panel) console.log(`  ${line}`);
  console.log("");

  if (urls.length === 0) {
    console.log("  (no server URLs)");
    console.log("");
  } else if (urls.every((url) => isLoopbackUrl(url))) {
    console.log(
      "  The hub is bound to a loopback address. Bind 0.0.0.0 or pass --url to pair another device.",
    );
    console.log("");
  }
}

async function waitForListen(
  server: ReturnType<typeof serve>,
): Promise<void> {
  if (server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}

async function requestPairing(
  config: HubPairingConfig,
  override?: string,
  color = Boolean(process.stdout.isTTY && !process.env.NO_COLOR),
): Promise<void> {
  if (override) {
    const parsed = new URL(override);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("--url must be an http or https URL");
    }
  }

  const endpoint = pairingRequestUrl(config);
  let response: Response;
  try {
    response = await fetch(`${endpoint}/api/v1/auth/pair`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error(
      `Hub is not reachable at ${endpoint}. Start the hub, then run this command again.`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Hub rejected the owner token. Run this command with the same config as the running hub.",
      );
    }
    throw new Error(`Hub returned HTTP ${response.status}`);
  }

  const pairing = (await response.json()) as PairingLinkInfo;
  printPairingPanel(
    config,
    pairing,
    override
      ? { urls: [override.replace(/\/+$/, "")], color }
      : { color },
  );
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${usage(VERSION)}`,
    );
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    process.stdout.write(usage(VERSION));
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (options.command === "status") {
    let config: HubTarget;
    try {
      config = await loadHubTarget(options.configPath);
    } catch (error) {
      process.stderr.write(
        `Unable to read hub config: ${error instanceof Error ? error.message : String(error)}\n` +
          "Run npx agent-hub once to create it.\n",
      );
      process.exitCode = 1;
      return;
    }
    if (options.host) config.host = options.host;
    if (options.port) config.port = options.port;

    const running = await probeHub(config);
    if (running) {
      process.stdout.write(
        `${formatHubStatus(running, config)}\n`,
      );
      return;
    }

    if (await isPortOpen(config)) {
      process.stderr.write(
        `Port ${config.port} is in use, but it is not an Agent Hub.\n` +
          `Use --port <port> or stop the process using it.\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stderr.write(
      `Agent Hub is not running at ${pairingRequestUrl(config)}.\n` +
        "Start it with: npx agent-hub\n",
    );
    process.exitCode = 1;
    return;
  }

  const pairMode = options.command === "pair";
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const tuiEnabled =
    tty &&
    !pairMode &&
    !options.plain &&
    !options.logJson &&
    process.env.TERM !== "dumb" &&
    process.env.HUB_TUI !== "0";
  const color =
    tty && !options.noColor && process.env.TERM !== "dumb";

  if (!pairMode) {
    // Probe the target before touching state, logs, or provider credentials.
    // A second `agent-hub` should be a status check even when the current shell
    // does not have the provider secrets from the running hub.
    try {
      const target = await loadHubTarget(options.configPath);
      if (options.host) target.host = options.host;
      if (options.port) target.port = options.port;

      const running = await probeHub(target);
      if (running) {
        process.stdout.write(
          `${formatHubStatus(running, target, { alreadyRunning: true })}\n`,
        );
        return;
      }
      if (await isPortOpen(target)) {
        process.stderr.write(
          `Port ${target.port} is already in use by another process.\n` +
            `Start Agent Hub on another port with: npx agent-hub --port ${target.port < 65_535 ? target.port + 1 : 8_787}\n`,
        );
        process.exitCode = 1;
        return;
      }
    } catch {
      // A missing or incomplete config is handled by ensureConfig/loadConfig.
    }
  }

  let ui: TerminalUi | undefined;
  let logFile: RotatingFileSink | undefined;
  let requestShutdown: () => void = () => undefined;
  let auth: AuthService | undefined;
  let registry: ProviderRegistry | undefined;
  let sessions: SessionService | undefined;
  let attention: AttentionService | undefined;
  let refreshAll: () => void = () => undefined;
  let snapshot: () => UiSnapshot = () => ({
    version: VERSION,
    host: "127.0.0.1",
    port: 0,
    urls: [],
    startedAt: Date.now(),
    storage: "unknown",
    providers: [],
    sessions: 0,
    attention: 0,
    subscribers: 0,
    eventSeq: 0,
    requests: 0,
    errors: 0,
    hasWebRoot: false,
  });
  let requests = 0;
  let errors = 0;

  if (tuiEnabled) {
    ui = new TerminalUi({
      version: VERSION,
      color,
      onQuit: () => requestShutdown(),
      onPair: () => {
        if (!auth) throw new Error("Hub is not ready");
        return auth.issuePairing();
      },
      onRefresh: () => refreshAll(),
      onOpen: (url) => {
        if (!openExternal(url)) {
          ui?.notify("Could not open a browser. Open the link manually.");
        }
      },
      snapshot: () => snapshot(),
    });
  }

  const logPath =
    options.logFile ??
    join(options.logDir ?? resolveLogDir(), "hub.log");
  const wantsLogFile =
    !pairMode &&
    !options.noLogFile &&
    (tuiEnabled || Boolean(options.logFile));
  const earlyLogRecords: LogRecord[] = [];

  const createLogFile = (): void => {
    if (!wantsLogFile || logFile) return;

    const configuredMax = Number(process.env.HUB_LOG_MAX_BYTES);
    const maxBytes =
      Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : DEFAULT_LOG_MAX_BYTES;

    logFile = new RotatingFileSink({
      filePath: logPath,
      maxBytes,
      onError: (error) => {
        if (ui) {
          ui.addActivity({
            at: Date.now(),
            label: "logs",
            detail: `File logging failed: ${error.message}`,
            tone: "warning",
          });
        } else {
          process.stderr.write(`Log file error: ${error.message}\n`);
        }
      },
    });

    for (const record of earlyLogRecords.splice(0)) {
      logFile.write(record);
    }
  };

  const sink = pairMode
    ? undefined
    : (record: LogRecord) => {
        if (logFile) {
          logFile.write(record);
        } else if (earlyLogRecords.length < 200) {
          earlyLogRecords.push(record);
        }

        if (record.msg === "request") {
          requests += 1;
          const status = Number(record.status);
          if (Number.isFinite(status) && status >= 500) errors += 1;
        } else if (record.level === "error") {
          errors += 1;
        }

        if (tuiEnabled) {
          ui?.addLog(record);
          return;
        }

        const line = `${JSON.stringify(record)}\n`;
        if (options.logJson) process.stdout.write(line);
        else process.stderr.write(line);
      };

  const logLevel = pairMode
    ? "silent"
    : options.verbose
      ? "debug"
      : ((process.env.LOG_LEVEL ?? "info") as LogLevel);
  const logger = createLogger({ level: logLevel, sink });

  try {
    const bootstrapped = await ensureConfig(options.configPath, {
      explicit: options.explicitConfig,
      env: process.env,
      logger,
    });

    if (pairMode) {
      if (bootstrapped.generatedToken) {
        console.log(`Hub config created: ${options.configPath}`);
        console.log(`Hub owner token: ${bootstrapped.generatedToken}`);
        console.log("Add providers to the config, then restart the hub.");
      }
      const pairingConfig = await loadPairingConfig(options.configPath);
      if (options.host) pairingConfig.host = options.host;
      if (options.port) pairingConfig.port = options.port;
      await requestPairing(pairingConfig, options.url, color);
      await logFile?.close();
      return;
    }

    if (bootstrapped.generatedToken && !tuiEnabled && !options.logJson) {
      console.log(`Hub config created: ${options.configPath}`);
      console.log(`Hub owner token: ${bootstrapped.generatedToken}`);
      console.log("Add providers to the config, then restart the hub.");
    }

    const config = await loadConfig(options.configPath);
    if (options.host) config.host = options.host;
    if (options.port) config.port = options.port;

    // A second `agent-hub` invocation is a status check, not a crash. Probe
    // the configured port before opening state or the terminal UI.
    const running = await probeHub(config);
    if (running) {
      process.stdout.write(
        `${formatHubStatus(running, config, { alreadyRunning: true })}\n`,
      );
      await logFile?.close();
      return;
    }
    if (await isPortOpen(config)) {
      process.stderr.write(
        `Port ${config.port} is already in use by another process.\n` +
          `Start Agent Hub on another port with: npx agent-hub --port ${config.port < 65_535 ? config.port + 1 : 8_787}\n`,
      );
      await logFile?.close();
      process.exitCode = 1;
      return;
    }

    createLogFile();

    auth = new AuthService(config.token);
    const stateFile = join(resolve(config.dataDir), "state.json");
    const store = await JsonStateStore.open({ filePath: stateFile });
    const eventBus = new EventBus(store, logger);
    await eventBus.init();
    registry = new ProviderRegistry(config.providers, logger);
    sessions = new SessionService(registry, logger, { store });
    attention = new AttentionService(
      registry,
      sessions,
      store,
      eventBus,
      logger,
    );
    const drafts = new DraftService(store);
    const assistantSettings = new AssistantSettingsService(store);
    const replies = new ReplyService(assistantSettings, sessions, logger);
    const questions = new QuestionService(sessions);
    const providerEvents = new ProviderEventService(
      registry,
      eventBus,
      sessions,
      logger,
      attention,
    );

    const bundledRoot = dirname(fileURLToPath(import.meta.url));
    const configuredWebRoot = config.webRoot
      ? resolve(config.webRoot)
      : existsSync(resolve(bundledRoot, "web"))
        ? resolve(bundledRoot, "web")
        : existsSync(resolve("dist/web"))
          ? resolve("dist/web")
          : undefined;
    const configuredAppsRoot = config.appsRoot
      ? resolve(config.appsRoot)
      : existsSync(resolve(bundledRoot, "apps"))
        ? resolve(bundledRoot, "apps")
        : existsSync(resolve("dist/apps"))
          ? resolve("dist/apps")
          : undefined;
    const hubWebUrl = webUrl(config);
    const startedAt = Date.now();

    const app = createApp({
      config,
      store,
      eventBus,
      registry,
      sessions,
      attention,
      drafts,
      settings: assistantSettings,
      replies,
      questions,
      logger,
      startedAt,
      webRoot: configuredWebRoot,
      appsRoot: configuredAppsRoot,
      auth,
    });

    snapshot = () => ({
      version: VERSION,
      host: config.host,
      port: config.port,
      urls: hubBaseUrls(config),
      startedAt,
      storage: store.kind,
      providers: registry!.list().map((provider) => ({
        id: provider.id,
        status: provider.status,
      })),
      sessions: sessions!.sessionCount,
      attention: attention!.count,
      subscribers: eventBus.subscriberCount,
      eventSeq: eventBus.lastSeq,
      requests,
      errors,
      hasWebRoot: Boolean(configuredWebRoot),
      webUrl: hubWebUrl,
    });

    refreshAll = () => {
      ui?.notify("Refreshing providers…");
      void registry!.checkAll().catch((error) => {
        logger.warn("provider refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      void sessions!.refresh().catch((error) => {
        logger.warn("session refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      void attention!.refresh().catch((error) => {
        logger.warn("attention refresh failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    const unsubscribeUi = eventBus.subscribe((event) => {
      if (!ui) return;
      if (event.type === "attention.created" || event.type === "attention.resolved") {
        const data = event.data as
          | { title?: string; type?: string; sessionRef?: string }
          | undefined;
        ui.addActivity({
          at: event.at,
          label: "attention",
          detail:
            data?.title ??
            data?.type ??
            event.sessionRef ??
            (event.type === "attention.created" ? "new item" : "resolved"),
          tone: event.type === "attention.created" ? "warning" : "success",
        });
      }
      if (event.type === "error") {
        ui.addActivity({
          at: event.at,
          label: "error",
          tone: "danger",
        });
      }
    });

    let server: ReturnType<typeof serve> | undefined;
    let attentionRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      ui?.stop();
      logger.info("shutting down", { signal });
      if (attentionRefreshTimer) clearInterval(attentionRefreshTimer);
      providerEvents.stop();
      unsubscribeUi();
      server?.close();
      await store.close();
      await logFile?.close();
      process.exit(0);
    };
    requestShutdown = () => void shutdown("quit");

    let stopPairingInput: (() => void) | undefined;
    const plainCanPrompt =
      !options.logJson &&
      process.env.HUB_PAIRING_PROMPT !== "0" &&
      Boolean(process.stdin.isTTY && process.stdout.isTTY);

    const printPlainStartup = (): void => {
      console.log("");
      console.log(`Agent Hub ${VERSION} listening on ${hubWebUrl}`);
      if (bootstrapped.created) {
        printPairingPanel(config, auth!.issuePairing(), {
          firstRun: true,
          canPrompt: plainCanPrompt,
          color,
        });
      } else if (plainCanPrompt) {
        console.log("");
        console.log(
          "Pair a browser or device: type `p` and press Enter here, or run the hub's `pair` command.",
        );
        console.log("");
      } else {
        console.log(
          "Pair a browser or device with the hub's `pair` command.",
        );
      }

      if (plainCanPrompt) {
        stopPairingInput = watchPairingCommands(process.stdin, () => {
          printPairingPanel(config, auth!.issuePairing(), {
            interactive: true,
            canPrompt: true,
            color,
          });
        });
      }
    };

    const listeningServer = serve(
      {
        fetch: app.fetch,
        hostname: config.host,
        port: config.port,
      },
      (info) => {
        logger.info("hub listening", {
          version: VERSION,
          host: info.address,
          port: info.port,
          providers: config.providers.length,
          dataDir: resolve(config.dataDir),
          webRoot: configuredWebRoot ?? null,
        });

        if (tuiEnabled && ui) {
          if (bootstrapped.created) {
            ui.showSetup({
              configPath: options.configPath,
              ownerToken: bootstrapped.generatedToken,
            });
          }
          const started = ui.start();
          if (started) {
            ui.addActivity({
              at: Date.now(),
              label: "hub",
              detail: `listening on ${hubWebUrl}`,
              tone: "success",
            });
            if (wantsLogFile) {
              ui.addActivity({
                at: Date.now(),
                label: "logs",
                detail: logPath,
                tone: "muted",
              });
            }
            if (!bootstrapped.created) {
              ui.addActivity({
                at: Date.now(),
                label: "pairing",
                detail: "press p to pair a device",
                tone: "muted",
              });
            }
          } else {
            printPlainStartup();
          }
        } else if (!options.logJson) {
          printPlainStartup();
        }
      },
    );

    server = listeningServer;

    try {
      await waitForListen(listeningServer);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") {
        const existing = await probeHub(config);
        if (existing) {
          process.stdout.write(
            `${formatHubStatus(existing, config, { alreadyRunning: true })}\n`,
          );
          await store.close();
          await logFile?.close();
          return;
        }
        process.stderr.write(
          `Port ${config.port} is already in use by another process.\n` +
            `Start Agent Hub on another port with: npx agent-hub --port ${config.port < 65_535 ? config.port + 1 : 8_787}\n`,
        );
      } else {
        process.stderr.write(
          `Unable to listen on ${config.host}:${config.port}: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }

      await store.close();
      await logFile?.close();
      process.exitCode = 1;
      return;
    }

    listeningServer.on("error", (error) => {
      logger.error("server error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    void registry.checkAll().catch((error) => {
      logger.warn("initial provider checks failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    void sessions.refresh().catch((error) => {
      logger.warn("initial session sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    void attention.refresh().catch((error) => {
      logger.warn("initial attention sync failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    void providerEvents.start().catch((error) => {
      logger.warn("provider event startup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    attentionRefreshTimer = setInterval(() => {
      attention!.invalidate();
      void attention!.refresh().catch((error) => {
        logger.warn("background attention sync failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 15_000);

    process.on("SIGINT", () => {
      stopPairingInput?.();
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      stopPairingInput?.();
      void shutdown("SIGTERM");
    });
  } catch (error) {
    ui?.stop();
    const message = error instanceof Error ? error.message : String(error);
    if (options.logJson) {
      process.stdout.write(
        `${JSON.stringify({ time: new Date().toISOString(), level: "fatal", msg: "hub failed to start", error: message })}\n`,
      );
    } else {
      process.stderr.write(
        `${pairMode ? "Unable to create a pairing link" : "Unable to start Agent Hub"}: ${message}\n`,
      );
    }
    await logFile?.close();
    process.exit(1);
  }
}

void main();
