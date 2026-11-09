import { z } from 'zod';
import { normalizeOrigin, parseOrigins } from './security';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(3001),
  // Read server-side only. Absence means the deterministic fallback director is used.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  // P3B dev flag. '1' lets a client create an Ability Lab room (`/?lab=1`). Anything else = off.
  ABILITY_LAB: z.enum(['0', '1']).optional(),
  // P3C: stage 1 is the salvage hunt. Default ON for the dev server; '0' restores the tutorial as stage 1.
  HUNT_STAGE: z.enum(['0', '1']).optional(),
  // P3D: escape-room stages. Default ON for the dev server; '0' restores the previous stage 1 and generator behaviour (the multi-room demo is then refused).
  ESCAPE_STAGES: z.enum(['0', '1']).optional(),
  // P6 C. NODE_ENV=production switches on the production rules (a real session secret is required, AUTH_MODE=dev and dev flags are refused).
  NODE_ENV: z.string().optional(),
  // Dev-only client flags (`?ghost=N`). '1' enables them outside production; they are never honoured when NODE_ENV=production.
  DEV_FLAGS: z.enum(['0', '1']).optional(),
  // Sign-in: 'google' (default when GOOGLE_CLIENT_ID is set), 'dev' (a mock provider for local play and tests; refused in production), 'off' (guests only).
  AUTH_MODE: z.enum(['off', 'google', 'dev']).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).max(256).optional(),
  // Signs the server's own session tokens. 32+ characters, required in production. Never commit it.
  AUTH_SESSION_SECRET: z.string().min(16).max(256).optional(),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  // The SQLite file (progress store). Needs a persistent disk where it runs.
  DATABASE_PATH: z.string().min(1).max(512).default('data/world-break.sqlite'),
  // The browser origin allowed to call the server (CORS and cookies).
  CORS_ORIGIN: z.string().min(1).max(256).default('http://localhost:5173'),
  // P7: the public origin(s) of the site, comma separated (for example https://play.example.com). Wins over CORS_ORIGIN. The ONLY origins the
  // browser APIs and the WebSocket accept when NODE_ENV=production. Required in production.
  PUBLIC_ORIGIN: z.string().min(1).max(512).optional(),
  // P7: how many reverse proxies sit in front (0 = none). Needed to see the real client address for limits when a host terminates TLS.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // P7: where the built client is (default: packages/client/dist next to the server). SERVE_CLIENT=0 runs the API and sockets only.
  CLIENT_DIST: z.string().min(1).max(512).optional(),
  SERVE_CLIENT: z.enum(['0', '1']).optional(),
  CSP_MODE: z.enum(['enforce', 'report-only', 'off']).default('enforce'),
  // P7 limits (each is an abuse cap, not a tuning knob)
  MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100000).default(400),
  MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(10000).default(12),
  MAX_ROOMS: z.coerce.number().int().min(1).max(100000).default(120),
  JOINS_PER_MINUTE_PER_IP: z.coerce.number().int().min(1).max(10000).default(20),
  HTTP_REQUESTS_PER_MINUTE_PER_IP: z.coerce.number().int().min(10).max(100000).default(600),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
});
export type ServerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const c = EnvSchema.parse(env);
  const production = c.NODE_ENV === 'production';
  if (production && c.AUTH_MODE === 'dev') throw new Error('AUTH_MODE=dev is refused when NODE_ENV=production');
  const mode = effectiveAuthMode(c);
  if (mode === 'google' && !c.GOOGLE_CLIENT_ID) throw new Error('AUTH_MODE=google needs GOOGLE_CLIENT_ID');
  if (production && mode !== 'off' && (c.AUTH_SESSION_SECRET ?? '').length < 32) throw new Error('AUTH_SESSION_SECRET (32+ characters) is required in production when sign-in is on');
  return c;
}

/** The sign-in mode the server will run: what AUTH_MODE says, else Google when a client id is configured, else guests only. */
export function effectiveAuthMode(c: Pick<ServerConfig, 'AUTH_MODE' | 'GOOGLE_CLIENT_ID'>): 'off' | 'google' | 'dev' {
  return c.AUTH_MODE ?? (c.GOOGLE_CLIENT_ID ? 'google' : 'off');
}
/** Dev flags are on only when asked for AND not in production. */
export function devFlagsOn(c: Pick<ServerConfig, 'DEV_FLAGS' | 'NODE_ENV'>): boolean { return c.DEV_FLAGS === '1' && c.NODE_ENV !== 'production'; }

/** The origins the browser may use: PUBLIC_ORIGIN, else CORS_ORIGIN, each normalised. Entries that are not plain http(s) origins are dropped. */
export function publicOrigins(c: Pick<ServerConfig, 'PUBLIC_ORIGIN' | 'CORS_ORIGIN'>): string[] { return parseOrigins(c.PUBLIC_ORIGIN ?? c.CORS_ORIGIN); }

const PLACEHOLDER_SECRET = /^(change|replace|example|secret|password|your|xxx|test|dummy|todo)/i;
/** A 32+ character secret that is not an obvious placeholder, not one repeated character and has some variety. */
export function isStrongSecret(s: string | undefined): boolean {
  if (s === undefined || s.length < 32) return false;
  if (PLACEHOLDER_SECRET.test(s)) return false;
  return new Set(s).size >= 10;
}

const isLocalOrigin = (o: string): boolean => { try { const h = new URL(o).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch { return false; } };

/**
 * P7: the extra rules of NODE_ENV=production, checked once at start (`main.ts`, after `loadConfig`). Throws with a message that names the VARIABLE and
 * never prints a value. `loadConfig` itself is unchanged (a guests-only production config without a secret is still valid there, as before).
 * Refuses: DEV_FLAGS=1, AUTH_MODE=dev, a weak AUTH_SESSION_SECRET (when set or when sign-in is on), no PUBLIC_ORIGIN/CORS_ORIGIN, an origin that is
 * not https (except localhost, for a local production run) or a wildcard.
 */
export function assertDeployable(c: ServerConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (c.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (c.DEV_FLAGS === '1') problems.push('DEV_FLAGS=1 is refused when NODE_ENV=production');
  if (c.AUTH_MODE === 'dev') problems.push('AUTH_MODE=dev is refused when NODE_ENV=production');
  const signIn = effectiveAuthMode(c) !== 'off';
  if (signIn && !isStrongSecret(c.AUTH_SESSION_SECRET)) problems.push('AUTH_SESSION_SECRET must be 32+ random characters (not a placeholder) when sign-in is on');
  else if (c.AUTH_SESSION_SECRET !== undefined && !isStrongSecret(c.AUTH_SESSION_SECRET)) problems.push('AUTH_SESSION_SECRET is set but weak (32+ random characters needed)');
  const raw = c.PUBLIC_ORIGIN ?? (env.CORS_ORIGIN !== undefined && env.CORS_ORIGIN !== '' ? c.CORS_ORIGIN : undefined);
  if (raw === undefined) problems.push('PUBLIC_ORIGIN (the https address of the site) is required in production');
  else {
    const parts = raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
    if (parts.length === 0) problems.push('PUBLIC_ORIGIN is empty');
    for (const part of parts) {
      const o = normalizeOrigin(part);
      if (o === null) problems.push('PUBLIC_ORIGIN has an entry that is not a plain http(s) origin (no wildcards, no paths)');
      else if (!o.startsWith('https://') && !isLocalOrigin(o)) problems.push('PUBLIC_ORIGIN must be https in production (http is only accepted for localhost)');
    }
  }
  if (problems.length > 0) throw new Error(`Refusing to start in production:\n - ${problems.join('\n - ')}`);
}
