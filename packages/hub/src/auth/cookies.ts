const COOKIE_BASE = "oktoso_session";

/**
 * Keep sessions for hubs on different ports separate, matching the OpenCode
 * port-scoped cookie. A host without an explicit port gets the bare name.
 */
export function sessionCookieName(host: string | undefined): string {
  if (!host) return COOKIE_BASE;

  try {
    const port = new URL(`http://${host}`).port;
    return port ? `${COOKIE_BASE}_${port}` : COOKIE_BASE;
  } catch {
    return COOKIE_BASE;
  }
}
