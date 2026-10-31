export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 500,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryable = options.retryable ?? status >= 500;
    this.details = options.details;
  }
}

export function unauthorized(message = "Missing or invalid hub credential"): AppError {
  return new AppError("unauthorized", message, 401);
}

export function notFound(message = "Not found"): AppError {
  return new AppError("not_found", message, 404);
}

export function badRequest(message: string, details?: Record<string, unknown>): AppError {
  return new AppError("invalid_request", message, 400, { details });
}

export function notImplemented(message: string): AppError {
  return new AppError("not_implemented", message, 501);
}
