import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import type { Hono } from "hono";
import type { SessionService } from "../../services/session-service";
import type { AppEnv } from "../types";
import { badRequest, notFound } from "../../domain/errors";
import {
  resourceHeaders,
  safeContentType,
  sliceForRange,
} from "../resource-response";

const MAX_PATH_LENGTH = 1024;
const TICKET_TTL_MS = 10 * 60 * 1_000;
const MAX_TICKETS = 100;

interface PreviewTicket {
  ref: string;
  base: string;
  expiresAt: number;
}

/**
 * Content types a preview frame may render. The provider often reports HTML
 * and CSS as text/plain, so the extension is the reliable signal.
 */
const PREVIEW_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
};

function extension(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function previewContentType(path: string, reported?: string): string {
  return PREVIEW_TYPES[extension(path)] ?? safeContentType(reported);
}

/**
 * The frame is sandboxed by the client (allow-scripts, no same-origin), so
 * inline scripts run in an opaque origin. The CSP keeps that frame from
 * reaching the hub API or loading external scripts while still allowing the
 * inline report scripts, styles, and images that generated HTML normally uses.
 */
const FRAME_CSP =
  "default-src 'none'; img-src * data: blob:; style-src 'unsafe-inline' *; " +
  "script-src 'unsafe-inline'; font-src * data:; media-src * data: blob:; " +
  "connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const ASSET_CSP = "default-src 'none'; sandbox";

/**
 * Read a file from a session's working directory.
 *
 * The provider resolves the path, so the hub stays out of the provider's
 * filesystem. `SessionService.readFile` jails the path to the session
 * directory before it leaves the hub.
 */
export function registerFileRoutes(
  app: Hono<AppEnv>,
  sessions: SessionService,
): void {
  const tickets = new Map<string, PreviewTicket>();

  const prune = () => {
    const now = Date.now();
    for (const [id, ticket] of tickets) {
      if (ticket.expiresAt <= now) tickets.delete(id);
    }
    while (tickets.size > MAX_TICKETS) {
      const oldest = tickets.keys().next().value;
      if (oldest === undefined) break;
      tickets.delete(oldest);
    }
  };

  app.get("/api/v1/sessions/:ref/files", async (c) => {
    const path = c.req.query("path");
    if (!path) throw badRequest("A file path is required");
    if (path.length > MAX_PATH_LENGTH) {
      throw badRequest("The file path is too long");
    }

    const resource = await sessions.readFile(c.req.param("ref"), path);
    const ranged = sliceForRange(resource, c.req.header("range"));
    if (ranged.status === 416) {
      return c.body(null, 416, ranged.headers);
    }
    return c.body(ranged.body, ranged.status, {
      ...resourceHeaders(resource, { openInTab: true }),
      ...ranged.headers,
    });
  });

  /**
   * Issue a short-lived, path-scoped URL for an HTML preview.
   *
   * The frame has to load its own relative assets (maps, styles, scripts), and
   * those subresource requests cannot carry the hub bearer token. A ticket puts
   * the capability in the path, so `maps/seoul.png` resolves under the same
   * ticket and the provider's directory stays readable for ten minutes.
   */
  app.get("/api/v1/sessions/:ref/preview", async (c) => {
    const path = c.req.query("path");
    if (!path) throw badRequest("A file path is required");
    if (path.length > MAX_PATH_LENGTH) {
      throw badRequest("The file path is too long");
    }

    const ref = c.req.param("ref");
    const clean = posix.normalize(path).replace(/^\/+/, "");
    if (clean.startsWith("..")) throw badRequest("The file path escapes the session");
    const base = posix.dirname(clean);
    const name = posix.basename(clean);
    const id = randomUUID();
    prune();
    tickets.set(id, {
      ref,
      base: base === "." ? "" : base,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
    return c.json({
      url: `/preview/${id}/${encodeURIComponent(name)}`,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });
  });

  app.get("/preview/:ticket/*", async (c) => {
    const ticket = tickets.get(c.req.param("ticket"));
    if (!ticket || ticket.expiresAt <= Date.now()) {
      throw notFound("This preview link has expired");
    }

    const prefix = `/preview/${c.req.param("ticket")}/`;
    let requested: string;
    try {
      requested = decodeURIComponent(c.req.path.slice(prefix.length));
    } catch {
      throw badRequest("The file path is malformed");
    }
    if (!requested || requested.length > MAX_PATH_LENGTH) {
      throw badRequest("A file path is required");
    }

    const joined = posix.normalize(posix.join(ticket.base, requested));
    if (
      joined.startsWith("..") ||
      (ticket.base !== "" && joined !== ticket.base && !joined.startsWith(`${ticket.base}/`))
    ) {
      throw badRequest("The file path escapes the preview");
    }

    const resource = await sessions.readFile(ticket.ref, joined);
    const ranged = sliceForRange(resource, c.req.header("range"));
    if (ranged.status === 416) {
      return c.body(null, 416, ranged.headers);
    }
    const contentType = previewContentType(joined, resource.contentType);
    // resourceHeaders only whitelists bare types; keep the charset for the
    // browser but pass the bare type so the file renders inline.
    const headers = resourceHeaders(
      { ...resource, contentType: contentType.split(";")[0]!.trim() },
      { openInTab: true },
    );
    headers["Content-Type"] = contentType;
    const isHtml = contentType.startsWith("text/html");
    headers["Content-Security-Policy"] = isHtml ? FRAME_CSP : ASSET_CSP;
    headers["X-Frame-Options"] = "SAMEORIGIN";
    headers["Cache-Control"] = "private, max-age=60";
    return c.body(ranged.body, ranged.status, { ...headers, ...ranged.headers });
  });
}
