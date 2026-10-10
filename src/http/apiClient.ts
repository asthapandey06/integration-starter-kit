import { HttpError, RetryableError, RetryOptions, parseRetryAfter, withRetry } from "../util/retry";

export interface TokenProvider {
  getAccessToken(tenant: string, opts?: { rejectedToken?: string }): Promise<string>;
}

/**
 * Calls a third-party API on behalf of a tenant.
 * - Adds the tenant's access token
 * - On 401: refreshes the token once and retries
 * - On 429 / 5xx: retries with backoff (honours Retry-After)
 * - Other 4xx errors are returned immediately as HttpError
 */
export class ApiClient {
  constructor(
    private baseUrl: string,
    private tokens: TokenProvider,
    private fetchImpl: typeof fetch = fetch,
    private retry: RetryOptions = {}
  ) {}

  get<T = unknown>(tenant: string, path: string): Promise<T> {
    return this.request<T>(tenant, "GET", path);
  }

  async request<T = unknown>(tenant: string, method: string, path: string, body?: unknown): Promise<T> {
    let token = await this.tokens.getAccessToken(tenant);
    let refreshed = false;

    return withRetry(async () => {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        token = await this.tokens.getAccessToken(tenant, { rejectedToken: token });
        throw new RetryableError("401: token refreshed, retrying", 0);
      }
      if (res.status === 429 || res.status >= 500) {
        throw new RetryableError(`HTTP ${res.status}`, parseRetryAfter(res.headers.get("retry-after")));
      }
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return (await res.json()) as T;
    }, this.retry);
  }
}
