import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { AesGcmEncryptor, createEncryptor, keyFingerprint } from "../src/crypto/encryptor";

const key = () => crypto.randomBytes(32);
const mk = (k = key()) => new AesGcmEncryptor({ activeKeyId: keyFingerprint(k), keys: { [keyFingerprint(k)]: k } });

test("encrypts and decrypts", () => {
  const e = mk();
  const payload = e.encrypt("secret-token", "tenant-1");
  assert.ok(!payload.includes("secret-token"));
  assert.equal(e.decrypt(payload, "tenant-1"), "secret-token");
});

test("same input gives different ciphertext each time (random IV)", () => {
  const e = mk();
  assert.notEqual(e.encrypt("x", "t"), e.encrypt("x", "t"));
});

test("data bound to one tenant cannot be read as another tenant", () => {
  const e = mk();
  const payload = e.encrypt("secret", "tenant-a");
  assert.throws(() => e.decrypt(payload, "tenant-b"));
});

test("tampered data is rejected", () => {
  const e = mk();
  const parts = e.encrypt("secret", "t").split(".");
  const ct = Buffer.from(parts[4], "base64url");
  ct[0] ^= 1;
  parts[4] = ct.toString("base64url");
  assert.throws(() => e.decrypt(parts.join("."), "t"));
});

test("key rotation: old data stays readable, new data uses the new key", () => {
  const oldKey = key(), newKey = key();
  const oldPayload = mk(oldKey).encrypt("legacy", "t");

  const rotated = createEncryptor({
    TOKEN_ENCRYPTION_KEY: newKey.toString("base64"),
    TOKEN_ENCRYPTION_KEY_OLD: oldKey.toString("base64"),
  });
  assert.equal(rotated.decrypt(oldPayload, "t"), "legacy");
  assert.ok(rotated.encrypt("fresh", "t").split(".")[1] === keyFingerprint(newKey));
});

test("rejects keys that are not 32 bytes", () => {
  assert.throws(() => createEncryptor({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }));
});
