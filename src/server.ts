import express from "express";
import { config } from "./config";
import { createEncryptor } from "./crypto/encryptor";
import { ApiClient } from "./http/apiClient";
import { buildAuthorizeUrl, exchangeCode, hubspotProvider, refreshTokens } from "./oauth/flow";
import { challengeFor, generateState, generateVerifier } from "./oauth/pkce";
import { NotConnectedError, TokenManager } from "./oauth/tokenManager";
import { createRedis, RedisKV, RedisRateLimitStore } from "./store/redis";
import { TokenStore } from "./store/tokenStore";
import { HttpError } from "./util/retry";
import { FixedWindowLimiter } from "./util/rateLimit";

const redis = createRedis(config.REDIS_URL);
const kv = new RedisKV(redis);
const store = new TokenStore(kv, createEncryptor(config));
const provider = hubspotProvider({
  clientId: config.OAUTH_CLIENT_ID,
  clientSecret: config.OAUTH_CLIENT_SECRET,
  redirectUri: `${config.PUBLIC_URL}/auth/callback`,
  scopes: config.OAUTH_SCOPES.split(/[ ,]+/).filter(Boolean),
});
const tokens = new TokenManager(store, kv, (rt) => refreshTokens(provider, rt));
const hubspot = new ApiClient("https://api.hubapi.com", tokens);
const limiter = new FixedWindowLimiter(new RedisRateLimitStore(redis), config.RATE_LIMIT_PER_MINUTE, 60_000);

const app = express();

const wrap = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

function rateLimit(req: any, res: any, next: any) {
  const key = `${req.params.tenant ?? "anon"}:${req.ip}`;
  limiter.check(key).then((r) => {
    res.setHeader("X-RateLimit-Remaining", String(r.remaining));
    if (!r.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(r.resetMs / 1000)));
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  }).catch(next);
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// Step 1: send the tenant to the provider's consent screen.
app.get("/auth/:tenant/connect", rateLimit, wrap(async (req, res) => {
  const state = generateState();
  const verifier = generateVerifier();
  // The state is single-use and expires in 10 minutes. It ties the callback to this request (CSRF protection).
  await kv.set(`oauth:state:${state}`, JSON.stringify({ tenant: req.params.tenant, verifier }), 10 * 60_000);
  res.redirect(buildAuthorizeUrl(provider, state, challengeFor(verifier)));
}));

// Step 2: the provider sends the user back here with a code.
app.get("/auth/callback", wrap(async (req, res) => {
  const { code, state } = req.query as Record<string, string | undefined>;
  if (!code || !state) return res.status(400).json({ error: "Missing code or state" });

  const saved = await kv.get(`oauth:state:${state}`);
  if (!saved) return res.status(400).json({ error: "Unknown or expired state" });
  await kv.del(`oauth:state:${state}`); // single use

  const { tenant, verifier } = JSON.parse(saved) as { tenant: string; verifier: string };
  await store.save(tenant, await exchangeCode(provider, code, verifier));
  res.json({ connected: tenant });
}));

// Tokens are never returned. Only connection status is.
app.get("/api/:tenant/status", rateLimit, wrap(async (req, res) => {
  const t = await store.load(req.params.tenant);
  res.json({ connected: !!t, expiresAt: t?.expiresAt ?? null });
}));

// Example proxy call: tokens are refreshed automatically behind the scenes.
app.get("/api/:tenant/contacts", rateLimit, wrap(async (req, res) => {
  res.json(await hubspot.get(req.params.tenant, "/crm/v3/objects/contacts?limit=5"));
}));

app.delete("/auth/:tenant", rateLimit, wrap(async (req, res) => {
  await store.delete(req.params.tenant);
  res.json({ disconnected: req.params.tenant });
}));

app.use((err: any, _req: any, res: any, _next: any) => {
  if (err instanceof NotConnectedError) return res.status(409).json({ error: err.message });
  if (err instanceof HttpError) return res.status(502).json({ error: "Upstream API error", status: err.status });
  console.error(err);
  res.status(500).json({ error: "Internal error" });
});

app.listen(config.PORT, () => console.log(`Listening on :${config.PORT}`));
