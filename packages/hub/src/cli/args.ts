import { defaultConfigPath } from "../config/paths";

export interface CliOptions {
  command: "serve" | "pair" | "status" | "mcp";
  configPath: string;
  explicitConfig: boolean;
  host?: string;
  port?: number;
  url?: string;
  plain: boolean;
  logJson: boolean;
  verbose: boolean;
  noColor: boolean;
  allowWrite: boolean;
  logFile?: string;
  logDir?: string;
  noLogFile: boolean;
  help: boolean;
  version: boolean;
}

type Env = Record<string, string | undefined>;

function readValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; next: number } {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return { value, next: index + 1 };
}

export function parseArgs(
  argv: string[] = process.argv.slice(2),
  env: Env = process.env,
  platform: NodeJS.Platform = process.platform,
): CliOptions {
  let command: "serve" | "pair" | "status" | "mcp" = "serve";
  let configPath = env.HUB_CONFIG ?? defaultConfigPath(env, platform);
  let explicitConfig = Boolean(env.HUB_CONFIG);
  let host: string | undefined;
  let port: number | undefined;
  let url: string | undefined;
  let plain = false;
  let logJson = false;
  let verbose = false;
  let noColor = Boolean(env.NO_COLOR);
  let allowWrite = false;
  let logFile: string | undefined;
  let logDir = env.HUB_LOG_DIR;
  let noLogFile = false;
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "pair":
      case "--pair":
        command = "pair";
        break;
      case "status":
        command = "status";
        break;
      case "mcp":
      case "--mcp":
        command = "mcp";
        break;
      case "--host": {
        const read = readValue(argv, index, arg);
        host = read.value;
        index = read.next;
        break;
      }
      case "--port": {
        const read = readValue(argv, index, arg);
        const value = Number(read.value);
        if (!Number.isInteger(value) || value < 1 || value > 65535) {
          throw new Error("--port must be an integer between 1 and 65535");
        }
        port = value;
        index = read.next;
        break;
      }
      case "--config": {
        const read = readValue(argv, index, arg);
        configPath = read.value;
        explicitConfig = true;
        index = read.next;
        break;
      }
      case "--url": {
        const read = readValue(argv, index, arg);
        url = read.value;
        index = read.next;
        break;
      }
      case "--plain":
      case "--no-tui":
        plain = true;
        break;
      case "--log-json":
        logJson = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--no-color":
        noColor = true;
        break;
      case "--allow-write":
        allowWrite = true;
        break;
      case "--log-file": {
        const read = readValue(argv, index, arg);
        logFile = read.value;
        index = read.next;
        break;
      }
      case "--log-dir": {
        const read = readValue(argv, index, arg);
        logDir = read.value;
        index = read.next;
        break;
      }
      case "--no-log-file":
        noLogFile = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    command,
    configPath,
    explicitConfig,
    host,
    port,
    url,
    plain,
    logJson,
    verbose,
    noColor,
    allowWrite,
    logFile,
    logDir,
    noLogFile,
    help,
    version,
  };
}

export function usage(version: string): string {
  return `Oktoso ${version}

Usage:
  oktoso [options]
  oktoso pair [--url <url>] [--config <path>]
  oktoso status [--config <path>]
  oktoso mcp [--allow-write] [--url <url>] [--config <path>]

Options:
  --config <path>    Hub config file (default: see Config below)
  --host <host>      Override the bind host
  --port <port>      Override the bind port
  --plain            No TUI; human output on stdout, JSON logs on stderr
  --log-json         JSON logs on stdout; no TUI
  --verbose          Debug logging
  --no-color         Disable ANSI colors
  --log-file <path>  Persistent log file
  --log-dir <path>   Log directory
  --no-log-file      Disable the persistent log file
  --url <url>        Base URL for pairing links or the MCP hub endpoint
  --allow-write      Enable write tools in the MCP server (read-only by default)
  --help, -h         Show this help
  --version, -v      Show the version

Keys:
  p pair   l logs   r refresh   o open   Ctrl+C quit   ? help

Config:
  Linux/Termux  $XDG_CONFIG_HOME/oktoso/hub.config.json  (~/.config by default)
  macOS         ~/Library/Application Support/Oktoso/hub.config.json
  Windows       %LOCALAPPDATA%\\Oktoso\\hub.config.json
  HUB_CONFIG        Override the config path
  The file holds the owner and provider credentials and must be 0600.
  A legacy ./hub.config.json in the working directory is used when the
  platform config does not exist yet.

Logs:
  Linux/Termux  $XDG_STATE_HOME/oktoso/logs/hub.log
  macOS         ~/Library/Logs/Oktoso/hub.log
  Windows       %LOCALAPPDATA%\\Oktoso\\Logs\\hub.log
  HUB_LOG_DIR        Override the log directory
  HUB_LOG_MAX_BYTES  Rotate hub.log at this byte size (default 26214400)
`;
}
