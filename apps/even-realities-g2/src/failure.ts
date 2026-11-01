export type FailureKind =
  | "auth"
  | "offline"
  | "timeout"
  | "provider"
  | "provider-auth"
  | "rate"
  | "not-found"
  | "conflict"
  | "server"
  | "unknown";

export type FailureAction = "retry" | "pair" | "back";

export interface FailureInfo {
  kind: FailureKind;
  header: string;
  title: string;
  message: string;
  short: string;
  action: FailureAction;
}

interface ErrorShape {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
}

function errorShape(error: unknown): ErrorShape {
  return error && typeof error === "object"
    ? (error as ErrorShape)
    : { message: String(error) };
}

function errorMessage(error: unknown): string {
  const message = errorShape(error).message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "An unexpected error occurred.";
}

export function classifyFailure(error: unknown): FailureInfo {
  const shape = errorShape(error);
  const code = typeof shape.code === "string" ? shape.code : undefined;
  const status = typeof shape.status === "number" ? shape.status : undefined;
  const name = typeof shape.name === "string" ? shape.name : undefined;
  const message = errorMessage(error);

  if (name === "TimeoutError" || code === "timeout" || status === 504) {
    return {
      kind: "timeout",
      header: "TIMEOUT",
      title: "Hub timeout",
      message: "The hub took too long to respond. Try again.",
      short: "Timed out · try again",
      action: "retry",
    };
  }

  if (status === 401 || code === "unauthorized") {
    return {
      kind: "auth",
      header: "SESSION EXPIRED",
      title: "Session expired",
      message: "This phone's session expired. Pair it again to continue.",
      short: "Session expired · pair again",
      action: "pair",
    };
  }

  if (code === "provider_offline") {
    return {
      kind: "provider",
      header: "AGENT OFFLINE",
      title: "Agent offline",
      message: "The hub is reachable, but the agent provider is offline.",
      short: "Agent offline · try again",
      action: "retry",
    };
  }

  if (code === "provider_auth_error") {
    return {
      kind: "provider-auth",
      header: "PROVIDER SIGN-IN",
      title: "Provider sign-in",
      message:
        "The provider rejected its credentials. Fix them on the hub, then retry.",
      short: "Provider sign-in needed",
      action: "retry",
    };
  }

  if (code === "network_error") {
    return {
      kind: "offline",
      header: "HUB OFFLINE",
      title: "Hub offline",
      message: "Can't reach the hub. Check Wi-Fi and the hub address.",
      short: "Offline · try again",
      action: "retry",
    };
  }

  if (code === "rate_limited" || status === 429) {
    return {
      kind: "rate",
      header: "HUB BUSY",
      title: "Hub busy",
      message: "The hub is rate limiting requests. Wait a moment, then retry.",
      short: "Hub busy · wait and retry",
      action: "retry",
    };
  }

  if (code === "not_found" || status === 404) {
    return {
      kind: "not-found",
      header: "NOT FOUND",
      title: "Session not found",
      message: "This session is no longer available. Go back and refresh.",
      short: "Session not found",
      action: "back",
    };
  }

  if (code === "conflict" || status === 409) {
    return {
      kind: "conflict",
      header: "CHANGED",
      title: "Session changed",
      message: "The session changed while you were working. Try again.",
      short: "Session changed · retry",
      action: "retry",
    };
  }

  if (
    (status === 502 || status === 503) &&
    (!code || code === "http_error" || code === "event_stream_failed")
  ) {
    // A gateway in front of the hub reports 502/503 when the hub itself is
    // unreachable. Provider outages carry the provider_offline code instead.
    return {
      kind: "offline",
      header: "HUB OFFLINE",
      title: "Hub offline",
      message: "Can't reach the hub. Check Wi-Fi and the hub address.",
      short: "Offline · try again",
      action: "retry",
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: "server",
      header: "HUB ERROR",
      title: "Hub error",
      message: "The hub hit an internal error. Try again.",
      short: "Hub error · try again",
      action: "retry",
    };
  }

  if (/failed to fetch|load failed|networkerror|network error/i.test(message)) {
    return {
      kind: "offline",
      header: "HUB OFFLINE",
      title: "Hub offline",
      message: "Can't reach the hub. Check Wi-Fi and the hub address.",
      short: "Offline · try again",
      action: "retry",
    };
  }

  return {
    kind: "unknown",
    header: "ERROR",
    title: "Something went wrong",
    message: "An unexpected error occurred. Try again.",
    short: "Something went wrong · retry",
    action: "retry",
  };
}
