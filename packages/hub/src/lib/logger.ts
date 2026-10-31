import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogRecord {
  time: string;
  level: Exclude<LogLevel, "silent">;
  msg: string;
  [key: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

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

export interface LoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  sink?: LogSink;
}

function defaultSink(record: LogRecord): void {
  const line = `${JSON.stringify(record)}\n`;
  if (record.level === "warn" || record.level === "error") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;

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
    sink(record as LogRecord);
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    child: (fields) => createLogger({ level, bindings: { ...bindings, ...fields }, sink }),
  };
}
