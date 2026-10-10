/** Throw this to say "this failure is temporary, try again". */
export class RetryableError extends Error {
  constructor(message: string, public retryAfterMs?: number) {
    super(message);
    this.name = "RetryableError";
  }
}

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export interface RetryOptions {
  attempts?: number; // total tries, default 5
  baseMs?: number; // default 500
  maxMs?: number; // default 30000
  jitter?: boolean; // default true ("full jitter")
  shouldRetry?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function computeDelay(attempt: number, o: { baseMs: number; maxMs: number; jitter: boolean; random: () => number }): number {
  const exp = Math.min(o.maxMs, o.baseMs * 2 ** (attempt - 1));
  return o.jitter ? Math.floor(o.random() * exp) : exp;
}

/** Parses a Retry-After header given in seconds. Returns milliseconds or undefined. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5;
  const cfg = {
    baseMs: opts.baseMs ?? 500,
    maxMs: opts.maxMs ?? 30_000,
    jitter: opts.jitter ?? true,
    random: opts.random ?? Math.random,
  };
  const shouldRetry = opts.shouldRetry ?? ((e: unknown) => e instanceof RetryableError);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      const hinted = err instanceof RetryableError ? err.retryAfterMs : undefined;
      await sleep(hinted !== undefined ? hinted : computeDelay(attempt, cfg));
    }
  }
}
