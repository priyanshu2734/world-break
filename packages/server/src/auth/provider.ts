import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';

/** Who a provider says someone is. Only these three things are ever kept; there is no email field on purpose. */
export interface VerifiedIdentity { provider: string; subject: string; displayName: string }
/** Managed sign-in sits behind this: the browser gets a credential from the provider, the server asks the provider object whether it is genuine. */
export interface AuthProvider {
  readonly id: string;
  verify(credential: string): Promise<VerifiedIdentity | null>;
}

const cleanName = (s: string): string => s.normalize('NFKC').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16);
export { cleanName as cleanDisplayName };

/**
 * DEV ONLY. The credential is simply the name wanted; the "subject" is that name, lower-cased. It exists so tests and local play need no Google account.
 * Constructing it in production throws, so a stray `AUTH_MODE=dev` can never open a passwordless door on a real deployment.
 */
export class DevAuthProvider implements AuthProvider {
  readonly id = 'dev';
  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV === 'production') throw new Error('AUTH_MODE=dev is refused when NODE_ENV=production');
  }
  async verify(credential: string): Promise<VerifiedIdentity | null> {
    const name = cleanName(credential);
    const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
    if (name === '' || slug === '') return null;
    return { provider: 'dev', subject: slug, displayName: name };
  }
}

export interface Jwk extends JsonWebKey { kid?: string }
export type JwksFetcher = () => Promise<{ keys: Jwk[] }>;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const fetchGoogleJwks: JwksFetcher = async () => {
  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  return (await res.json()) as { keys: Jwk[] };
};

/**
 * Google Sign-In: the browser obtains an ID token (a JWT signed by Google); the server checks the RS256 signature against Google's published keys,
 * that it was issued by Google for THIS app (`aud` = GOOGLE_CLIENT_ID), and that it has not expired. It reads `sub` and `name`; `email` is never read.
 * NOT RUN against the real Google here (no account, no network to it): tested with locally generated keys (test/auth/google.test.ts).
 */
export class GoogleAuthProvider implements AuthProvider {
  readonly id = 'google';
  private keys = new Map<string, Jwk>();
  private fetchedAt = 0;
  constructor(private readonly clientId: string, private readonly fetchJwks: JwksFetcher = fetchGoogleJwks, private readonly nowMs: () => number = Date.now) {
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is required for Google sign-in');
  }

  private async key(kid: string): Promise<Jwk | null> {
    const stale = this.nowMs() - this.fetchedAt > 3600_000;
    // refetch when the cache is old, or once when the key id is unknown (Google rotates keys); never more than once a minute
    if (stale || (!this.keys.has(kid) && this.nowMs() - this.fetchedAt > 60_000)) {
      const set = await this.fetchJwks();
      this.keys = new Map(set.keys.filter((k) => typeof k.kid === 'string').map((k) => [k.kid!, k]));
      this.fetchedAt = this.nowMs();
    }
    return this.keys.get(kid) ?? null;
  }

  async verify(credential: string): Promise<VerifiedIdentity | null> {
    try {
      if (typeof credential !== 'string' || credential.length > 4096) return null;
      const parts = credential.split('.');
      if (parts.length !== 3) return null;
      const [h, p, s] = parts as [string, string, string];
      const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
      const jwk = await this.key(header.kid);
      if (!jwk) return null;
      const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
      if (!ok) return null;
      const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { iss?: string; aud?: string; exp?: number; sub?: string; name?: string };
      const now = this.nowMs() / 1000;
      if (!c.iss || !GOOGLE_ISSUERS.includes(c.iss) || c.aud !== this.clientId) return null;
      if (typeof c.exp !== 'number' || c.exp + 30 < now) return null;
      if (typeof c.sub !== 'string' || c.sub === '' || c.sub.length > 64) return null;
      return { provider: 'google', subject: c.sub, displayName: cleanName(typeof c.name === 'string' ? c.name : '') || 'Player' };
    } catch { return null; }
  }
}
