import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

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
 * VAPID private keys are the raw P-256 scalar, not a PKCS#8 document. The
 * public key is the uncompressed point `04 || x || y`, both base64url encoded.
 */
export async function loadOrCreateVapidKeys(
  dataDir: string,
): Promise<VapidKeys> {
  const existing = await loadVapidKeys(dataDir);
  if (existing) return existing;

  const keys = generateVapidKeys();
  const filePath = vapidKeysPath(dataDir);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(keys, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return keys;
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = privateKey.export({ format: "jwk" }) as {
    x?: string;
    y?: string;
    d?: string;
  };
  if (!jwk.x || !jwk.y || !jwk.d) {
    throw new Error("Unable to export the generated VAPID key pair");
  }

  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  const point = Buffer.concat([Buffer.from([0x04]), x, y]);

  return {
    publicKey: point.toString("base64url"),
    privateKey: jwk.d,
  };
}
