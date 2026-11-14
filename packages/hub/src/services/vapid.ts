import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import * as webpush from "web-push";

export const zVapidKeys = z.object({
  publicKey: z.string().min(1),
  privateKey: z.string().min(1),
});

export type VapidKeys = z.infer<typeof zVapidKeys>;

export function vapidKeysPath(dataDir: string): string {
  return join(dataDir, "notifications", "vapid.json");
}

export async function loadVapidKeys(
  dataDir: string,
): Promise<VapidKeys | undefined> {
  try {
    const raw = await readFile(vapidKeysPath(dataDir), "utf8");
    return zVapidKeys.parse(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(
      `Unable to load VAPID keys from ${vapidKeysPath(dataDir)}: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

/**
 * Load the hub's VAPID key pair, generating and persisting one on first use.
 *
 * The private key never leaves the hub and is stored owner-only.
 */
export async function loadOrCreateVapidKeys(
  dataDir: string,
): Promise<VapidKeys> {
  const existing = await loadVapidKeys(dataDir);
  if (existing) return existing;

  const keys = webpush.generateVAPIDKeys();
  const filePath = vapidKeysPath(dataDir);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(keys, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return keys;
}
