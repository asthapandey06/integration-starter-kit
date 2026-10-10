import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/http/apiClient";
import { HttpError } from "../src/util/retry";

function fakeTokens() {
  let n = 0;
  const rejected: (string | undefined)[] = [];
  return {
    rejected,
    getAccessToken: async (_t: string, o?: { rejectedToken?: string }) => {
      if (o?.rejectedToken) { rejected.push(o.rejectedToken); n++; }
      return `token-${n}`;
    },
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("adds the bearer token and returns JSON", async () => {
  let auth = "";
  const client = new ApiClient("https://api.test", fakeTokens(), async (_u, init) => {
    auth = (init!.headers as Record<string, string>).Authorization;
    return json({ ok: true });
  });
  assert.deepEqual(await client.get("t1", "/x"), { ok: true });
  assert.equal(auth, "Bearer token-0");
});

test("on 401 it refreshes the token once and retries", async () => {
  const tokens = fakeTokens();
  const seen: string[] = [];
  const client = new ApiClient("https://api.test", tokens, async (_u, init) => {
    const a = (init!.headers as Record<string, string>).Authorization;
    seen.push(a);
    return a === "Bearer token-0" ? json({}, 401) : json({ ok: true });
  }, { sleep: async () => {} });
  assert.deepEqual(await client.get("t1", "/x"), { ok: true });
  assert.deepEqual(seen, ["Bearer token-0", "Bearer token-1"]);
  assert.deepEqual(tokens.rejected, ["token-0"]);
});

test("on 429 it waits for Retry-After, then succeeds", async () => {
  const delays: number[] = [];
  let calls = 0;
  const client = new ApiClient("https://api.test", fakeTokens(), async () =>
    ++calls === 1 ? json({}, 429, { "retry-after": "2" }) : json({ ok: true }),
    { sleep: async (ms) => void delays.push(ms) });
  await client.get("t1", "/x");
  assert.deepEqual(delays, [2000]);
});

test("a permanent 4xx error is not retried", async () => {
  let calls = 0;
  const client = new ApiClient("https://api.test", fakeTokens(), async () => { calls++; return json({ message: "no" }, 400); },
    { sleep: async () => {} });
  await assert.rejects(client.get("t1", "/x"), HttpError);
  assert.equal(calls, 1);
});

test("gives up after repeated server errors", async () => {
  let calls = 0;
  const client = new ApiClient("https://api.test", fakeTokens(), async () => { calls++; return json({}, 503); },
    { attempts: 3, sleep: async () => {} });
  await assert.rejects(client.get("t1", "/x"));
  assert.equal(calls, 3);
});
