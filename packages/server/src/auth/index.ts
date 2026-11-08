import { randomBytes } from 'node:crypto';
import type { AuthConfig } from '@wb/shared';
import { DevAuthProvider, GoogleAuthProvider, type AuthProvider, type JwksFetcher } from './provider';
import { signToken, verifyToken } from './token';

export * from './token';
export * from './provider';

export interface AuthOptions {
  mode: 'off' | 'google' | 'dev';
  secret?: string | undefined;
  ttlSeconds?: number | undefined;
  googleClientId?: string | undefined;
  env?: NodeJS.ProcessEnv;
  jwks?: JwksFetcher;
  nowMs?: () => number;
}

/** Issues and checks the server's session tokens and owns the provider. `mode: 'off'` means guests only. */
export class AuthService {
  readonly mode: 'off' | 'google' | 'dev';
  readonly provider: AuthProvider | null;
  readonly ttlSeconds: number;
  readonly googleClientId: string | undefined;
  private readonly secret: string;
  private readonly nowMs: () => number;
  readonly production: boolean;

  constructor(o: AuthOptions) {
    const env = o.env ?? process.env;
    this.production = env.NODE_ENV === 'production';
    this.nowMs = o.nowMs ?? Date.now;
    this.mode = o.mode;
    this.ttlSeconds = Math.max(60, Math.min(24 * 3600, o.ttlSeconds ?? 3600));
    this.googleClientId = o.googleClientId;
    // a production server MUST be given a real secret; a dev server makes a throwaway one (sessions then end with the process)
    if (this.production && o.mode !== 'off' && (!o.secret || o.secret.length < 32)) throw new Error('AUTH_SESSION_SECRET must be set (32+ characters) in production');
    this.secret = o.secret && o.secret.length >= 16 ? o.secret : randomBytes(32).toString('hex');
    if (o.mode === 'dev') this.provider = new DevAuthProvider(env); // throws in production
    else if (o.mode === 'google') this.provider = new GoogleAuthProvider(o.googleClientId ?? '', o.jwks, this.nowMs);
    else this.provider = null;
  }

  get config(): AuthConfig { return { mode: this.mode, ...(this.mode === 'google' && this.googleClientId ? { googleClientId: this.googleClientId } : {}) }; }
  issue(accountId: string): { token: string; expiresAt: number } {
    const iat = Math.floor(this.nowMs() / 1000), exp = iat + this.ttlSeconds;
    return { token: signToken(this.secret, { sub: accountId, iat, exp }), expiresAt: exp * 1000 };
  }
  /** The account id in a genuine, unexpired token, else null. */
  verify(token: unknown): string | null { return verifyToken(this.secret, token, Math.floor(this.nowMs() / 1000))?.sub ?? null; }
}
