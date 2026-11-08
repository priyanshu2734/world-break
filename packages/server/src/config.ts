import { z } from 'zod';

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
