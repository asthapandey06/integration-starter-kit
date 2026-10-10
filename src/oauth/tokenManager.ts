import type { KV } from "../store/kv";
import type { TokenSet, TokenStore } from "../store/tokenStore";

export class NotConnectedError extends Error {
  constructor(tenant: string) {
    super(`Tenant "${tenant}" has not connected this integration`);
    this.name = "NotConnectedError";
  }
}

export type RefreshFn = (refreshToken: string) => Promise<TokenSet>;

export interface TokenManagerOptions {
  skewMs?: number; // refresh this long before expiry (default 60s)
  lockTtlMs?: number; // how long one refresher may hold the lock (default 15s)
  pollMs?: number; // how often waiters re-check (default 200ms)
  maxWaitMs?: number; // give up waiting after this long (default 10s)
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Hands out valid access tokens and refreshes them when needed.
 * A lock makes sure only ONE refresh happens at a time per tenant. This matters because
 * many providers rotate refresh tokens, so two parallel refreshes can invalidate each other.
 */
export class TokenManager {
  private o: Required<TokenManagerOptions>;

  constructor(private store: TokenStore, private kv: KV, private refreshFn: RefreshFn, opts: TokenManagerOptions = {}) {
    this.o = {
      skewMs: opts.skewMs ?? 60_000,
      lockTtlMs: opts.lockTtlMs ?? 15_000,
      pollMs: opts.pollMs ?? 200,
      maxWaitMs: opts.maxWaitMs ?? 10_000,
      now: opts.now ?? Date.now,
      sleep: opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))),
    };
  }

  private needsRefresh(t: TokenSet, rejectedToken?: string): boolean {
    return t.expiresAt - this.o.now() <= this.o.skewMs || t.accessToken === rejectedToken;
  }

  /**
   * `rejectedToken`: pass the token the API just rejected with 401. If someone else has
   * already replaced it, the new one is returned without refreshing again.
   */
  async getAccessToken(tenant: string, opts: { rejectedToken?: string } = {}): Promise<string> {
    let tokens = await this.store.load(tenant);
    if (!tokens) throw new NotConnectedError(tenant);
    if (!this.needsRefresh(tokens, opts.rejectedToken)) return tokens.accessToken;

    const lockKey = `lock:refresh:${tenant}`;
    const deadline = this.o.now() + this.o.maxWaitMs;

    for (;;) {
      if (await this.kv.setNx(lockKey, "1", this.o.lockTtlMs)) {
        try {
          // Re-read: another process may have refreshed while we were waiting for the lock.
          tokens = await this.store.load(tenant);
          if (!tokens) throw new NotConnectedError(tenant);
          if (!this.needsRefresh(tokens, opts.rejectedToken)) return tokens.accessToken;

          const fresh = await this.refreshFn(tokens.refreshToken);
          // Some providers do not send a new refresh token. Keep the old one then.
          const next: TokenSet = { ...fresh, refreshToken: fresh.refreshToken || tokens.refreshToken };
          await this.store.save(tenant, next);
          return next.accessToken;
        } finally {
          await this.kv.del(lockKey);
        }
      }

      await this.o.sleep(this.o.pollMs);
      tokens = await this.store.load(tenant);
      if (!tokens) throw new NotConnectedError(tenant);
      if (!this.needsRefresh(tokens, opts.rejectedToken)) return tokens.accessToken;
      if (this.o.now() > deadline) throw new Error("Timed out waiting for another token refresh");
    }
  }
}
