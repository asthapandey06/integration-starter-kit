import IORedis from "ioredis";
import type { KV } from "./kv";
import type { RateLimitStore } from "../util/rateLimit";

export function createRedis(url: string): any {
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export class RedisKV implements KV {
  constructor(private r: any) {}
  get(key: string): Promise<string | null> { return this.r.get(key); }
  async set(key: string, value: string, ttlMs?: number) {
    if (ttlMs) await this.r.set(key, value, "PX", ttlMs);
    else await this.r.set(key, value);
  }
  async del(key: string) { await this.r.del(key); }
  async setNx(key: string, value: string, ttlMs: number) {
    return (await this.r.set(key, value, "PX", ttlMs, "NX")) === "OK";
  }
}

// One atomic step: count the hit, start the window on the first hit, report time left.
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private r: any) {}
  async hit(key: string, windowMs: number) {
    const [count, ttl] = (await this.r.eval(HIT_SCRIPT, 1, `rl:${key}`, windowMs)) as [number, number];
    return { count, resetMs: ttl > 0 ? ttl : windowMs };
  }
}
