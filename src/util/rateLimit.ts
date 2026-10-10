export interface RateLimitStore {
  /** Counts one hit in the current window and says when the window resets. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

/** Fixed-window limiter: at most `limit` hits per `windowMs` for each key. */
export class FixedWindowLimiter {
  constructor(private store: RateLimitStore, private limit: number, private windowMs: number) {}

  async check(key: string): Promise<RateLimitResult> {
    const { count, resetMs } = await this.store.hit(key, this.windowMs);
    return { allowed: count <= this.limit, remaining: Math.max(0, this.limit - count), resetMs };
  }
}

/** In-memory store, used in tests and for single-process setups. */
export class MemoryRateLimitStore implements RateLimitStore {
  private windows = new Map<string, { count: number; expiresAt: number }>();
  constructor(private now: () => number = Date.now) {}

  async hit(key: string, windowMs: number) {
    const t = this.now();
    let w = this.windows.get(key);
    if (!w || w.expiresAt <= t) {
      w = { count: 0, expiresAt: t + windowMs };
      this.windows.set(key, w);
    }
    w.count += 1;
    return { count: w.count, resetMs: w.expiresAt - t };
  }
}
