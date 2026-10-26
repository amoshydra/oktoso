export type ProviderErrorCode =
  | "provider_offline"
  | "provider_auth_error"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_request"
  | "unsupported"
  | "internal";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable =
      options.retryable ??
      (code === "provider_offline" ||
        code === "rate_limited" ||
        code === "internal");
    this.status = options.status;
    this.details = options.details;
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
