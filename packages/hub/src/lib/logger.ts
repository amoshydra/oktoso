import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  options: { level?: LogLevel; bindings?: Record<string, unknown> } = {},
): Logger {
  const level = options.level ?? "info";
  const bindings = options.bindings ?? {};

  const write = (
    messageLevel: Exclude<LogLevel, "silent">,
    message: string,
    fields: Record<string, unknown> = {},
  ) => {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[messageLevel]) return;
    const record = {
      time: new Date().toISOString(),
      level: messageLevel,
      msg: message,
      ...(redact({ ...bindings, ...fields }) as Record<string, unknown>),
    };
    const line = `${JSON.stringify(record)}\n`;
    if (messageLevel === "warn" || messageLevel === "error") process.stderr.write(line);
    else process.stdout.write(line);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) => createLogger({ level, bindings: { ...bindings, ...fields } }),
  };
}
