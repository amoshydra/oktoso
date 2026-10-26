export class HubError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      status?: number;
      retryable?: boolean;
      requestId?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HubError";
    this.code = code;
    this.status = options.status ?? 0;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}
