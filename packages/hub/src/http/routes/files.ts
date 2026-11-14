import type { Hono } from "hono";
import type { SessionService } from "../../services/session-service";
import type { AppEnv } from "../types";
import { badRequest } from "../../domain/errors";
import { resourceHeaders } from "../resource-response";

const MAX_PATH_LENGTH = 1024;

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
  app.get("/api/v1/sessions/:ref/files", async (c) => {
    const path = c.req.query("path");
    if (!path) throw badRequest("A file path is required");
    if (path.length > MAX_PATH_LENGTH) {
      throw badRequest("The file path is too long");
    }

    const resource = await sessions.readFile(c.req.param("ref"), path);
    return c.body(
      resource.body,
      200,
      resourceHeaders(resource, { openInTab: true }),
    );
  });
}
