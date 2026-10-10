import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { AesGcmEncryptor, keyFingerprint } from "../src/crypto/encryptor";
import { MemoryKV } from "../src/store/kv";
import { TokenSet, TokenStore } from "../src/store/tokenStore";
import { NotConnectedError, TokenManager } from "../src/oauth/tokenManager";

function setup(refresh?: (rt: string) => Promise<TokenSet>) {
  const k = crypto.randomBytes(32);
  const enc = new AesGcmEncryptor({ activeKeyId: keyFingerprint(k), keys: { [keyFingerprint(k)]: k } });
  const kv = new MemoryKV();
  const store = new TokenStore(kv, enc);
  const calls: string[] = [];
  const refreshFn = async (rt: string) => {
    calls.push(rt);
    await new Promise((r) => setTimeout(r, 20));
    return refresh ? refresh(rt) : { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: Date.now() + 3_600_000 };
  };
  const manager = new TokenManager(store, kv, refreshFn, { pollMs: 5 });
  return { store, kv, manager, calls };
}

const valid = (over: Partial<TokenSet> = {}): TokenSet =>
  ({ accessToken: "old-access", refreshToken: "old-refresh", expiresAt: Date.now() + 3_600_000, ...over });

test("tokens are encrypted at rest", async () => {
  const { store, kv } = setup();
  await store.save("t1", valid());
  const raw = await kv.get("tokens:t1");
  assert.ok(raw && !raw.includes("old-access") && !raw.includes("old-refresh"));
  assert.equal((await store.load("t1"))?.accessToken, "old-access");
});

test("returns the current token without refreshing when it is still valid", async () => {
  const { store, manager, calls } = setup();
  await store.save("t1", valid());
  assert.equal(await manager.getAccessToken("t1"), "old-access");
  assert.equal(calls.length, 0);
});

test("refreshes a token that is about to expire and saves the result", async () => {
  const { store, manager, calls } = setup();
  await store.save("t1", valid({ expiresAt: Date.now() + 10_000 })); // inside the 60s skew
  assert.equal(await manager.getAccessToken("t1"), "new-access");
  assert.deepEqual(calls, ["old-refresh"]);
  assert.equal((await store.load("t1"))?.refreshToken, "new-refresh");
});

test("many parallel requests cause only ONE refresh", async () => {
  const { store, manager, calls } = setup();
  await store.save("t1", valid({ expiresAt: Date.now() - 1000 }));
  const results = await Promise.all(Array.from({ length: 10 }, () => manager.getAccessToken("t1")));
  assert.ok(results.every((t) => t === "new-access"));
  assert.equal(calls.length, 1);
});

test("a rejected token forces a refresh, unless it was already replaced", async () => {
  const { store, manager, calls } = setup();
  await store.save("t1", valid());
  assert.equal(await manager.getAccessToken("t1", { rejectedToken: "old-access" }), "new-access");
  assert.equal(calls.length, 1);
  // A second caller that also saw the old token gets the new one without another refresh.
  assert.equal(await manager.getAccessToken("t1", { rejectedToken: "old-access" }), "new-access");
  assert.equal(calls.length, 1);
});

test("keeps the old refresh token when the provider does not send a new one", async () => {
  const { store, manager } = setup(async () => ({ accessToken: "a2", refreshToken: "", expiresAt: Date.now() + 3_600_000 }));
  await store.save("t1", valid({ expiresAt: Date.now() - 1 }));
  await manager.getAccessToken("t1");
  assert.equal((await store.load("t1"))?.refreshToken, "old-refresh");
});

test("throws a clear error for tenants that never connected", async () => {
  const { manager } = setup();
  await assert.rejects(manager.getAccessToken("nobody"), NotConnectedError);
});
