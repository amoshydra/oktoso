import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const PREFIX = "v1";
const SALT = "oktoso-secret-box-v1";
const INFO = "assistant-settings";
const IV_BYTES = 12;

export interface SecretBox {
  /** Encrypt a value for storage. */
  seal(plain: string): string;
  /** Decrypt a stored value; `undefined` when the key is wrong or corrupt. */
  open(sealed: string): string | undefined;
  /** True when a stored value is already sealed. */
  isSealed(value: string): boolean;
}

/**
 * Seal the small set of provider keys the hub stores in `state.json`.
 *
 * The wrapping key is derived from the owner token, so a copied state file is
 * useless on its own. It does **not** defend a host compromise: anyone who can
 * read `hub.config.json` can derive the same key. Rotating the owner token
 * makes stored keys undecryptable, which fails closed (the operator re-enters
 * them).
 */
export function createSecretBox(hubToken: string): SecretBox {
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(hubToken, "utf8"),
      Buffer.from(SALT, "utf8"),
      Buffer.from(INFO, "utf8"),
      32,
    ),
  );

  const isSealed = (value: string) => value.startsWith(`${PREFIX}:`);

  return {
    isSealed,
    seal(plain: string): string {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        PREFIX,
        iv.toString("base64url"),
        tag.toString("base64url"),
        body.toString("base64url"),
      ].join(":");
    },
    open(sealed: string): string | undefined {
      if (!isSealed(sealed)) return undefined;
      const [, ivRaw, tagRaw, bodyRaw] = sealed.split(":");
      if (!ivRaw || !tagRaw || bodyRaw === undefined) return undefined;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(ivRaw, "base64url"),
        );
        decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
        return Buffer.concat([
          decipher.update(Buffer.from(bodyRaw, "base64url")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        return undefined;
      }
    },
  };
}
