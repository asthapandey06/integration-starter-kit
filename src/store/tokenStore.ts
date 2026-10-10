import type { KV } from "./kv";
import type { TokenEncryptor } from "../crypto/encryptor";

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope?: string;
}

/** Stores each tenant's tokens encrypted at rest. The tenant id is bound into the ciphertext. */
export class TokenStore {
  constructor(private kv: KV, private enc: TokenEncryptor, private prefix = "tokens:") {}

  async save(tenant: string, tokens: TokenSet): Promise<void> {
    await this.kv.set(this.prefix + tenant, this.enc.encrypt(JSON.stringify(tokens), tenant));
  }

  async load(tenant: string): Promise<TokenSet | null> {
    const raw = await this.kv.get(this.prefix + tenant);
    return raw ? (JSON.parse(this.enc.decrypt(raw, tenant)) as TokenSet) : null;
  }

  async delete(tenant: string): Promise<void> {
    await this.kv.del(this.prefix + tenant);
  }
}
