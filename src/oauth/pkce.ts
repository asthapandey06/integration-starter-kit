import crypto from "crypto";

export function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function generateVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
