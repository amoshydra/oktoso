import { ZodError } from "zod";

/**
 * A config problem a person can act on.
 *
 * Zod's own message is a JSON array of issues, and the hub used to print it
 * verbatim. That told the operator nothing about which file or field to fix.
 */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFileError";
  }
}

/** `automation.templates[0].providerID`, or `token` for a top-level field. */
export function formatConfigPath(
  path: ReadonlyArray<string | number | symbol>,
): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    const key = String(part);
    return result ? `${result}.${key}` : key;
  }, "");
}

export function formatConfigError(error: unknown, filePath: string): Error {
  if (error instanceof ZodError) {
    const lines = error.issues.map((issue) => {
      const where = formatConfigPath(issue.path);
      return where ? `  ${where}: ${issue.message}` : `  ${issue.message}`;
    });
    return new ConfigFileError(
      `${filePath} is not valid:\n${lines.join("\n")}\nFix the field above and restart the hub.`,
    );
  }

  if (error instanceof SyntaxError) {
    return new ConfigFileError(
      `${filePath} could not be parsed: ${error.message}`,
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export function parseConfigJson(raw: string, filePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw formatConfigError(error, filePath);
  }
}

export function parseConfig<T>(
  schema: { parse: (value: unknown) => T },
  value: unknown,
  filePath: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw formatConfigError(error, filePath);
  }
}
