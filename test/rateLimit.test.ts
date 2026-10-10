import test from "node:test";
import assert from "node:assert/strict";
import { FixedWindowLimiter, MemoryRateLimitStore } from "../src/util/rateLimit";

test("allows up to the limit, then blocks", async () => {
  const limiter = new FixedWindowLimiter(new MemoryRateLimitStore(), 3, 60_000);
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await limiter.check("a")).allowed);
  assert.deepEqual(results, [true, true, true, false, false]);
});

test("each key has its own budget", async () => {
  const limiter = new FixedWindowLimiter(new MemoryRateLimitStore(), 1, 60_000);
  assert.equal((await limiter.check("a")).allowed, true);
  assert.equal((await limiter.check("b")).allowed, true);
  assert.equal((await limiter.check("a")).allowed, false);
});

test("budget resets when the window ends", async () => {
  let now = 0;
  const limiter = new FixedWindowLimiter(new MemoryRateLimitStore(() => now), 1, 1000);
  assert.equal((await limiter.check("a")).allowed, true);
  assert.equal((await limiter.check("a")).allowed, false);
  now = 1001;
  assert.equal((await limiter.check("a")).allowed, true);
});
