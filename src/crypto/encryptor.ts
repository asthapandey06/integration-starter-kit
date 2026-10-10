import crypto from "crypto";

export interface TokenEncryptor {
  /** `aad` binds the ciphertext to a context (here: the tenant id). */
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
}

export interface Keyring {
  activeKeyId: string;
  keys: Record<string, Buffer>;
}

const VERSION = "v1";

export function keyFingerprint(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * AES-256-GCM with a random IV per message.
 * Payload format: v1.<keyId>.<iv>.<authTag>.<ciphertext> (base64url parts).
 * The key id lets you rotate keys: new data uses the active key, old data
 * is still readable as long as its key stays in the ring.
 */
export class AesGcmEncryptor implements TokenEncryptor {
  constructor(private ring: Keyring) {
    for (const [id, key] of Object.entries(ring.keys)) {
      if (key.length !== 32) throw new Error(`Key ${id} must be exactly 32 bytes`);
    }
    if (!ring.keys[ring.activeKeyId]) throw new Error("Active key is missing from the keyring");
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.ring.keys[this.ring.activeKeyId];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      this.ring.activeKeyId,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(payload: string, aad: string): string {
    const parts = payload.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("Unsupported payload format");
    const [, keyId, iv, tag, ciphertext] = parts;
    const key = this.ring.keys[keyId];
    if (!key) throw new Error(`Unknown encryption key id: ${keyId}`);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    // final() throws if the data was tampered with or the aad does not match
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}

function decodeKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("Encryption keys must be 32 bytes, base64 encoded");
  return key;
}

/** Factory: builds the encryptor from environment settings. */
export function createEncryptor(env: {
  TOKEN_ENCRYPTION_KEY: string;
  TOKEN_ENCRYPTION_KEY_OLD?: string;
}): TokenEncryptor {
  const active = decodeKey(env.TOKEN_ENCRYPTION_KEY);
  const keys: Record<string, Buffer> = { [keyFingerprint(active)]: active };
  if (env.TOKEN_ENCRYPTION_KEY_OLD) {
    const old = decodeKey(env.TOKEN_ENCRYPTION_KEY_OLD);
    keys[keyFingerprint(old)] = old;
  }
  return new AesGcmEncryptor({ activeKeyId: keyFingerprint(active), keys });
}
