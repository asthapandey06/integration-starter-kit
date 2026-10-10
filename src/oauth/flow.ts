import type { TokenSet } from "../store/tokenStore";
import { HttpError } from "../util/retry";

export interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  usePkce?: boolean;
}

/** Example provider settings for HubSpot. Swap these for any OAuth 2.0 provider. */
export function hubspotProvider(c: {
  clientId: string; clientSecret: string; redirectUri: string; scopes: string[];
}): OAuthProvider {
  return {
    name: "hubspot",
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    ...c,
  };
}

export function buildAuthorizeUrl(p: OAuthProvider, state: string, challenge?: string): string {
  const u = new URL(p.authorizeUrl);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  if (p.usePkce && challenge) {
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

export function parseTokenResponse(json: any, now: number = Date.now()): TokenSet {
  if (!json || typeof json.access_token !== "string") throw new Error("Token response has no access_token");
  const expiresIn = Number(json.expires_in ?? 1800);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : "",
    expiresAt: now + expiresIn * 1000,
    scope: json.scope,
  };
}

async function postToken(p: OAuthProvider, params: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenSet> {
  const res = await fetchImpl(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, ...params }).toString(),
  });
  if (!res.ok) throw new HttpError(res.status, await res.text());
  return parseTokenResponse(await res.json());
}

export function exchangeCode(p: OAuthProvider, code: string, verifier?: string, fetchImpl: typeof fetch = fetch) {
  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: p.redirectUri };
  if (p.usePkce && verifier) params.code_verifier = verifier;
  return postToken(p, params, fetchImpl);
}

export function refreshTokens(p: OAuthProvider, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return postToken(p, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}
