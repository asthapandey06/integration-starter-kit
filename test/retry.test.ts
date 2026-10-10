import test from "node:test";
import assert from "node:assert/strict";
import { computeDelay, parseRetryAfter, RetryableError, withRetry } from "../src/util/retry";

const noJitter = { jitter: false, baseMs: 100, maxMs: 10_000 };

test("retries temporary errors with exponential backoff, then succeeds", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new RetryableError("temporary");
    return "ok";
  }, { ...noJitter, sleep: async (ms) => void delays.push(ms) });
  assert.equal(result, "ok");
  assert.deepEqual(delays, [100, 200]);
});

test("uses the server's Retry-After hint instead of the backoff", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withRetry(async () => {
    if (++calls === 1) throw new RetryableError("rate limited", 2500);
  }, { ...noJitter, sleep: async (ms) => void delays.push(ms) });
  assert.deepEqual(delays, [2500]);
});

test("gives up after the maximum attempts", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new RetryableError("still down"); }, { attempts: 3, sleep: async () => {} }),
    /still down/
  );
  assert.equal(calls, 3);
});

test("does not retry permanent errors", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls++; throw new Error("bad request"); }, { sleep: async () => {} }),
    /bad request/
  );
  assert.equal(calls, 1);
});

test("delay is capped and jitter stays within bounds", () => {
  assert.equal(computeDelay(20, { ...noJitter, random: Math.random }), 10_000);
  assert.equal(computeDelay(3, { baseMs: 100, maxMs: 10_000, jitter: true, random: () => 0.5 }), 200);
});

test("parses Retry-After seconds", () => {
  assert.equal(parseRetryAfter("3"), 3000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter("soon"), undefined);
});
