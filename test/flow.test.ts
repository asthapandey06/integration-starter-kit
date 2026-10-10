import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeUrl, parseTokenResponse } from "../src/oauth/flow";
import { challengeFor } from "../src/oauth/pkce";

const provider = {
  name: "demo", authorizeUrl: "https://auth.test/authorize", tokenUrl: "https://auth.test/token",
  clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:3000/auth/callback", scopes: ["a", "b"],
};

test("builds the consent URL with state and scopes", () => {
  const u = new URL(buildAuthorizeUrl(provider, "state123"));
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("state"), "state123");
  assert.equal(u.searchParams.get("scope"), "a b");
  assert.equal(u.searchParams.get("code_challenge"), null);
});

test("adds the PKCE challenge only when the provider uses it", () => {
  const u = new URL(buildAuthorizeUrl({ ...provider, usePkce: true }, "s", "chal"));
  assert.equal(u.searchParams.get("code_challenge"), "chal");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
});

test("PKCE challenge matches the RFC 7636 example", () => {
  assert.equal(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("converts expires_in to an absolute expiry time", () => {
  const t = parseTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 1800 }, 1_000_000);
  assert.equal(t.expiresAt, 1_000_000 + 1_800_000);
  assert.throws(() => parseTokenResponse({}));
});
