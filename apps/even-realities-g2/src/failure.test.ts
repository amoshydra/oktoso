import { describe, expect, it } from "vitest";
import { HubError } from "@amoshydra/oktoso-client";
import { classifyFailure } from "./failure";

describe("G2 failure classification", () => {
  it("asks for pairing on an expired session", () => {
    expect(
      classifyFailure(
        new HubError("unauthorized", "Missing or invalid hub credential", {
          status: 401,
        }),
      ),
    ).toMatchObject({
      kind: "auth",
      header: "SESSION EXPIRED",
      action: "pair",
    });
  });

  it("separates a hub network failure from a provider outage", () => {
    expect(
      classifyFailure(
        new HubError("network_error", "Unable to reach the hub", {
          retryable: true,
        }),
      ),
    ).toMatchObject({ kind: "offline", action: "retry" });

    expect(
      classifyFailure(
        new HubError("provider_offline", "Unable to reach OpenCode", {
          status: 502,
          retryable: true,
        }),
      ),
    ).toMatchObject({ kind: "provider", header: "AGENT OFFLINE" });

    expect(
      classifyFailure(
        new HubError("http_error", "Hub returned HTTP 502", { status: 502 }),
      ),
    ).toMatchObject({ kind: "offline", header: "HUB OFFLINE" });

    expect(classifyFailure(new TypeError("Failed to fetch"))).toMatchObject({
      kind: "offline",
    });
  });

  it("recognizes hub and browser timeouts", () => {
    expect(
      classifyFailure(
        new HubError("timeout", "The request timed out", { status: 504 }),
      ),
    ).toMatchObject({ kind: "timeout", header: "TIMEOUT" });

    expect(
      classifyFailure(new DOMException("The operation timed out", "TimeoutError")),
    ).toMatchObject({ kind: "timeout" });
  });

  it("does not offer retry for a missing session", () => {
    expect(
      classifyFailure(
        new HubError("not_found", "Session not found", { status: 404 }),
      ),
    ).toMatchObject({ kind: "not-found", action: "back" });
  });

  it("recognizes provider authentication and rate limiting", () => {
    expect(
      classifyFailure(
        new HubError("provider_auth_error", "Provider login failed", {
          status: 502,
        }),
      ),
    ).toMatchObject({ kind: "provider-auth" });

    expect(
      classifyFailure(
        new HubError("rate_limited", "Too many requests", { status: 429 }),
      ),
    ).toMatchObject({ kind: "rate" });
  });

  it("falls back to a retryable unknown error", () => {
    expect(classifyFailure(new Error("Unexpected shape"))).toMatchObject({
      kind: "unknown",
      action: "retry",
      message: "An unexpected error occurred. Try again.",
    });
  });
});
