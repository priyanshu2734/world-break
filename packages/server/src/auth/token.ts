import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * The server's OWN session token (the Google ID token is only ever used once, at sign-in). `wb1.<payload>.<signature>`: a base64url JSON payload
 * and an HMAC-SHA256 over it with a server secret. Short-lived (see `AUTH_SESSION_TTL_SECONDS`); the client re-signs-in or refreshes before it ends.
 * It names an account id and nothing else: no stage, score or unlock is ever in it, so there is nothing a browser could edit to get ahead.
 */
const Claims = z.object({ sub: z.string().min(1).max(64), iat: z.number().int().min(0), exp: z.number().int().min(0) }).strict();
export type TokenClaims = z.infer<typeof Claims>;
export const MAX_TOKEN_LENGTH = 1024;
const MAX_LIFETIME_SECONDS = 24 * 3600;
const PREFIX = 'wb1';

const b64 = (b: Buffer): string => b.toString('base64url');
const mac = (secret: string, data: string): Buffer => createHmac('sha256', secret).update(data).digest();

export function signToken(secret: string, claims: TokenClaims): string {
  const payload = b64(Buffer.from(JSON.stringify(claims)));
  return `${PREFIX}.${payload}.${b64(mac(secret, `${PREFIX}.${payload}`))}`;
}

/** The claims of a genuine, unexpired token, or null for anything else (wrong shape, wrong signature, expired, from the future, absurd lifetime). Never throws. */
export function verifyToken(secret: string, token: unknown, nowSeconds: number): TokenClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, payload, sig] = parts as [string, string, string];
  let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  const want = mac(secret, `${PREFIX}.${payload}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  const c = Claims.safeParse(parsed);
  if (!c.success) return null;
  const { iat, exp } = c.data;
  if (exp <= nowSeconds || iat > nowSeconds + 60 || exp - iat > MAX_LIFETIME_SECONDS || exp < iat) return null;
  return c.data;
}
