import type { Hono } from "hono";
import { zPairedProfile, zPairingExchange } from "@amoshydra/oktoso-contracts";
import type { AuthService } from "../../auth/service";
import type { SessionProfile } from "../../auth/profiles";
import { AppError, badRequest, unauthorized } from "../../domain/errors";
import { clearHubSessionCookie } from "../auth-cookie";
import { isSameOriginRequest } from "../origin";
import type { AppEnv } from "../types";

export interface AuthRouteDeps {
  auth: AuthService;
  version: string;
}

function noStore(c: { header: (name: string, value: string) => void }): void {
  c.header("Cache-Control", "no-store");
}

export function registerAuthRoutes(
  app: Hono<AppEnv>,
  deps: AuthRouteDeps,
): void {
  app.post("/api/v1/auth/pair", async (c) => {
    noStore(c);
    const identity = c.get("auth");
    if (!identity || identity.kind !== "owner") {
      throw new AppError(
        "forbidden",
        "Only the hub owner credential can create pairing links",
        403,
      );
    }

    const body = c.req
      .header("content-type")
      ?.toLowerCase()
      .includes("application/json")
      ? await c.req.json().catch(() => undefined)
      : undefined;
    const requested =
      c.req.query("profile") ??
      (body && typeof body === "object"
        ? (body as { profile?: unknown }).profile
        : undefined);
    const parsed = zPairedProfile.optional().safeParse(requested);
    if (!parsed.success) {
      throw badRequest("Pairing profile must be phone or g2");
    }

    const pairing = deps.auth.issuePairing(parsed.data ?? "phone");
    c.get("logger").info("pairing issued", {
      transport: "api",
      profile: pairing.profile,
    });
    return c.json({
      code: pairing.code,
      profile: pairing.profile,
      expiresIn: Math.max(
        0,
        Math.ceil((pairing.expiresAt - deps.auth.nowMs()) / 1000),
      ),
      expiresAt: pairing.expiresAt,
    });
  });

  app.post("/api/v1/auth/connect", async (c) => {
    noStore(c);
    if (
      !c.req
        .header("content-type")
        ?.toLowerCase()
        .includes("application/json")
    ) {
      throw badRequest("A JSON body with a pairing code is required");
    }

    const body = await c.req.json().catch(() => undefined);
    const parsed = zPairingExchange.safeParse(body);
    if (!parsed.success) {
      throw badRequest("A JSON body with a pairing code is required");
    }

    const issuedProfile = deps.auth.consumePairing(parsed.data.code);
    if (!issuedProfile) {
      throw unauthorized("Pairing link expired or already used");
    }
    if (parsed.data.profile === "phone" && issuedProfile === "g2") {
      throw new AppError(
        "forbidden",
        "A G2 pairing code cannot be upgraded to a phone session",
        403,
      );
    }
    const profile =
      parsed.data.profile === "g2" ? "g2" : issuedProfile;

    c.get("logger").info("pairing redeemed", {
      transport: "api",
      profile,
    });
    const session = deps.auth.mintSession(profile);
    return c.json({
      token: session.token,
      expiresAt: session.expiresAt,
      profile: session.profile,
    });
  });

  app.post("/api/v1/auth/refresh", (c) => {
    noStore(c);
    const identity = c.get("auth");
    if (!identity || identity.kind !== "session") {
      throw badRequest("The owner token does not expire");
    }

    const session = deps.auth.mintSession(identity.profile);
    return c.json({
      token: session.token,
      expiresAt: session.expiresAt,
      profile: session.profile,
    });
  });

  app.post("/api/v1/auth/signout", (c) => {
    noStore(c);
    if (c.req.header("origin") && !isSameOriginRequest(c)) {
      throw new AppError(
        "forbidden",
        "Cross-origin cookie request rejected",
        403,
      );
    }
    clearHubSessionCookie(c);
    return c.body(null, 204);
  });

  app.get("/api/v1/auth/check", (c) => {
    noStore(c);
    const identity = c.get("auth");
    if (!identity) throw unauthorized();

    return c.json({
      ok: true,
      version: deps.version,
      auth:
        identity.kind === "owner"
          ? { kind: "owner" as const, profile: "owner" as const }
          : {
              kind: "session" as const,
              profile: identity.profile,
              scopes: identity.scopes,
              expiresAt: identity.expiresAt,
            },
    });
  });
}
