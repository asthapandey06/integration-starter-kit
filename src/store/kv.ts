/** The small key-value surface this kit needs. Redis in production, memory in tests. */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Sets the key only if it does not exist. Returns true if this call set it. */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
}

export class MemoryKV implements KV {
  private data = new Map<string, { value: string; expiresAt?: number }>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string) {
    const e = this.data.get(key);
    if (e && e.expiresAt !== undefined && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }
  async get(key: string) { return this.live(key)?.value ?? null; }
  async set(key: string, value: string, ttlMs?: number) {
    this.data.set(key, { value, expiresAt: ttlMs ? this.now() + ttlMs : undefined });
  }
  async del(key: string) { this.data.delete(key); }
  async setNx(key: string, value: string, ttlMs: number) {
    if (this.live(key)) return false;
    this.data.set(key, { value, expiresAt: this.now() + ttlMs });
    return true;
  }
}
