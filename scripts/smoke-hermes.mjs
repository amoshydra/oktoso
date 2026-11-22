#!/usr/bin/env node
/**
 * Read-only Hermes surface smoke test.
 *
 * Probes the two machine surfaces of a Hermes install:
 *   1. the gateway handshake (ticket protocol) over SSH;
 *   2. the dashboard HTTP API, unauthenticated and — when credentials are
 *      supplied — authenticated.
 *
 * Nothing is written to the Hermes host. Tickets and tokens are never printed.
 *
 * Environment:
 *   HERMES_HOST                required
 *   HERMES_SSH                 default root@$HERMES_HOST
 *   HERMES_DASHBOARD_URL       default http://$HERMES_HOST:3000
 *   HERMES_DASHBOARD_USER      optional basic-auth user
 *   HERMES_DASHBOARD_PASSWORD  optional basic-auth password
 *   HERMES_DASHBOARD_TOKEN     optional bearer token (instead of basic auth)
 */
import { execFileSync } from "node:child_process";

const host = process.env.HERMES_HOST;
if (!host) {
  console.error("Set HERMES_HOST to the Hermes host.");
  process.exit(1);
}
const sshTarget = process.env.HERMES_SSH ?? `root@${host}`;
const dashboardURL = (process.env.HERMES_DASHBOARD_URL ?? `http://${host}:3000`).replace(/\/$/, "");
const user = process.env.HERMES_DASHBOARD_USER;
const password = process.env.HERMES_DASHBOARD_PASSWORD;
const token = process.env.HERMES_DASHBOARD_TOKEN;

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function ssh(command) {
  return execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", sshTarget, command],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function redact(value) {
  if (value === undefined || value === null) return value;
  return "<redacted>";
}

// --- 1. gateway handshake ---------------------------------------------------
let gatewayPort;
try {
  const raw = ssh("docker exec -u hermes hermes hermes gateway attach --json");
  const handshake = JSON.parse(raw);
  gatewayPort = new URL(handshake.url).port;
  record(
    "gateway handshake",
    handshake.state === "ready" && handshake.protocol === "hermes-gateway-v1",
    `state=${handshake.state} protocol=${handshake.protocol} url=${handshake.url} ticket=${redact(handshake.ticket)}`,
  );
  record(
    "gateway capabilities",
    Array.isArray(handshake.endpoint?.capabilities) && handshake.endpoint.capabilities.length > 0,
    (handshake.endpoint?.capabilities ?? []).join(", "),
  );
  const listening = ssh("ss -ltn");
  record(
    "gateway listener",
    Boolean(gatewayPort) && listening.includes(`:${gatewayPort}`),
    `127.0.0.1:${gatewayPort}`,
  );
} catch (error) {
  record("gateway handshake", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
}

// --- 2. dashboard surface ---------------------------------------------------
async function probe(path, init = {}) {
  try {
    const response = await fetch(`${dashboardURL}${path}`, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(6_000),
    });
    let body = "";
    if (response.status === 200) {
      body = (await response.text()).slice(0, 300);
    }
    return {
      status: response.status,
      location: response.headers.get("location") ?? "",
      authenticate: response.headers.get("www-authenticate") ?? "",
      body,
    };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const publicProbe = await probe("/api/status");
record(
  "dashboard /api/status",
  publicProbe.status === 200,
  publicProbe.status === 200
    ? "public"
    : `HTTP ${publicProbe.status}${publicProbe.location ? ` → ${publicProbe.location}` : ""}`,
);

const anonymous = await probe("/api/sessions?limit=1");
record(
  "dashboard /api/sessions (anonymous)",
  anonymous.status === 401 || anonymous.status === 403 || anonymous.status === 302,
  `HTTP ${anonymous.status}${anonymous.location ? ` → ${anonymous.location}` : ""}${
    anonymous.authenticate ? ` · ${anonymous.authenticate}` : ""
  }`,
);

const headers = {};
if (token) headers.Authorization = `Bearer ${token}`;
else if (user && password) headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

if (Object.keys(headers).length === 0) {
  console.log("SKIP  dashboard /api/sessions (authenticated) — set HERMES_DASHBOARD_USER/PASSWORD or HERMES_DASHBOARD_TOKEN");
} else {
  const authenticated = await probe("/api/sessions?limit=1", { headers });
  let shape = "";
  if (authenticated.status === 200) {
    try {
      const parsed = JSON.parse(authenticated.body);
      shape = Array.isArray(parsed)
        ? `array(${parsed.length})`
        : `object keys: ${Object.keys(parsed).slice(0, 6).join(", ")}`;
    } catch {
      shape = "non-JSON body";
    }
  }
  record(
    "dashboard /api/sessions (authenticated)",
    authenticated.status === 200,
    `HTTP ${authenticated.status}${shape ? ` · ${shape}` : ""}`,
  );
}

// --- summary ----------------------------------------------------------------
const failed = results.filter((result) => !result.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed on ${host}${gatewayPort ? ` · gateway :${gatewayPort}` : ""}`,
);
process.exitCode = failed > 0 ? 1 : 0;
