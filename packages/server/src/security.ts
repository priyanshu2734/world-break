import type { IncomingHttpHeaders } from 'node:http';

/** A token bucket: `perSecond` tokens refill continuously up to `burst`. */
export interface RateSpec { readonly perSecond: number; readonly burst: number }

// ---------------------------------------------------------------- origins

/** "https://Example.com/path/" becomes "https://example.com". Anything that is not a plain http(s) origin (including "*" and "null") is refused. */
export function normalizeOrigin(raw: string): string | null {
  const s = raw.trim();
  if (s === '' || s === '*' || s === 'null') return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.origin;
}
/** A comma separated list of origins, normalised, de-duplicated, invalid entries dropped. */
export function parseOrigins(list: string): string[] {
  const out: string[] = [];
  for (const part of list.split(',')) {
    const o = normalizeOrigin(part);
    if (o !== null && !out.includes(o)) out.push(o);
  }
  return out;
}
/**
 * Is this request's Origin header one of the configured origins? A missing header is allowed (non-browser clients, same-origin GETs): a browser
 * ALWAYS sends Origin on a WebSocket handshake and on a cross-site POST, which is where the check matters.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined || origin === '') return true;
  const o = normalizeOrigin(origin);
  return o !== null && allowed.includes(o);
}

// ---------------------------------------------------------------- client address

/**
 * The address a request counts against. Behind a TLS-terminating proxy every request arrives from the proxy, so with `trustProxy` = N hops the
 * N-th address from the RIGHT of X-Forwarded-For is used (the one the nearest trusted proxy appended; anything to its left is client-supplied and
 * cannot be trusted). With `trustProxy` = 0 the header is ignored entirely, so a client cannot pick its own address.
 */
export function clientIp(headers: IncomingHttpHeaders, remote: string | undefined, trustProxy: number): string {
  if (trustProxy > 0) {
    const xff = headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    if (typeof raw === 'string' && raw !== '') {
      const parts = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
      const ip = parts[parts.length - trustProxy];
      if (ip !== undefined && ip.length <= 64) return ip;
    }
  }
  return (remote ?? 'unknown').replace(/^::ffff:/, '');
}

// ---------------------------------------------------------------- rate limits

/** Token buckets by key (an address). Bounded: the least recently used key is forgotten first. */
export class KeyedLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private readonly spec: RateSpec, private readonly maxKeys: number = 10_000, private readonly now: () => number = Date.now) {}
  /** True when the call is allowed (and charged). */
  take(key: string, cost: number = 1): boolean {
    const t = this.now();
    const b = this.buckets.get(key);
    const tokens = b ? Math.min(this.spec.burst, b.tokens + (Math.max(0, t - b.at) / 1000) * this.spec.perSecond) : this.spec.burst;
    const ok = tokens >= cost;
    if (b) this.buckets.delete(key); // re-insert: Map order is recency order
    this.buckets.set(key, { tokens: ok ? tokens - cost : tokens, at: t });
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    return ok;
  }
  get size(): number { return this.buckets.size; }
}

/**
 * Per-event limits for gameplay traffic. Generous: they exist to stop floods and abuse, not to tune the game (the game's own cooldowns, such as the
 * ping cooldown and the chat gap, are stricter and stay authoritative). An event not named here shares one small bucket.
 */
export const EVENT_LIMITS: Readonly<Record<string, RateSpec>> = {
  'game:input': { perSecond: 90, burst: 120 },
  'spectate:move': { perSecond: 30, burst: 30 },
  'spectate:follow': { perSecond: 8, burst: 12 },
  'spectate:room': { perSecond: 8, burst: 12 },
  'spectate:ping': { perSecond: 3, burst: 4 },
  'stage:action': { perSecond: 30, burst: 40 },
  'ability:use': { perSecond: 15, burst: 20 },
  'escape:action': { perSecond: 20, burst: 30 },
  'item:action': { perSecond: 20, burst: 30 },
  'ghost:action': { perSecond: 20, burst: 30 },
  'ping:place': { perSecond: 4, burst: 6 },
  'chat:send': { perSecond: 2, burst: 5 },
  'room:join': { perSecond: 1, burst: 3 },
  'run:choose': { perSecond: 2, burst: 4 },
  'room:ready': { perSecond: 4, burst: 8 },
  'room:setDifficulty': { perSecond: 4, burst: 8 },
  'room:start': { perSecond: 2, burst: 4 },
  'draft:vote': { perSecond: 4, burst: 8 },
  'room:nextStage': { perSecond: 2, burst: 4 },
  'room:retry': { perSecond: 2, burst: 4 },
  'game:reset': { perSecond: 2, burst: 4 },
};
export const OTHER_EVENT_LIMIT: RateSpec = { perSecond: 5, burst: 10 };
export const SOCKET_TOTAL_LIMIT: RateSpec = { perSecond: 220, burst: 320 };
/** More than this many refused events within VIOLATION_WINDOW_MS and the socket is disconnected. */
export const VIOLATION_KICK = 150;
export const VIOLATION_WINDOW_MS = 10_000;

export type EventVerdict = 'ok' | 'drop' | 'kick';

/** The limiter of ONE socket: a bucket per known event, one shared bucket for unknown events, one for everything, and a flood counter. */
export class EventLimiter {
  private readonly per = new Map<string, { tokens: number; at: number }>();
  private all: { tokens: number; at: number };
  private violations: number[] = [];

  constructor(
    private readonly table: Readonly<Record<string, RateSpec>> = EVENT_LIMITS,
    private readonly other: RateSpec = OTHER_EVENT_LIMIT,
    private readonly total: RateSpec = SOCKET_TOTAL_LIMIT,
    private readonly now: () => number = Date.now,
  ) { this.all = { tokens: total.burst, at: now() }; }

  private static charge(b: { tokens: number; at: number }, spec: RateSpec, t: number): boolean {
    b.tokens = Math.min(spec.burst, b.tokens + (Math.max(0, t - b.at) / 1000) * spec.perSecond);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  check(event: string): EventVerdict {
    const t = this.now();
    const known = Object.prototype.hasOwnProperty.call(this.table, event);
    const key = known ? event : '*'; // a client cannot grow this map with made-up event names
    const spec: RateSpec = known ? this.table[event] ?? this.other : this.other;
    let b = this.per.get(key);
    if (!b) { b = { tokens: spec.burst, at: t }; this.per.set(key, b); }
    const okTotal = EventLimiter.charge(this.all, this.total, t);
    const okEvent = EventLimiter.charge(b, spec, t);
    if (okTotal && okEvent) return 'ok';
    this.violations.push(t);
    const cutoff = t - VIOLATION_WINDOW_MS;
    while (this.violations.length > 0 && (this.violations[0] ?? t) < cutoff) this.violations.shift();
    if (this.violations.length > VIOLATION_KICK * 2) this.violations.splice(0, this.violations.length - VIOLATION_KICK * 2);
    return this.violations.length >= VIOLATION_KICK ? 'kick' : 'drop';
  }
}

// ---------------------------------------------------------------- response headers

export type CspMode = 'enforce' | 'report-only' | 'off';

/**
 * The Content-Security-Policy of the page. Google sign-in (https://accounts.google.com/gsi/client) is the only third party. `style-src 'unsafe-inline'`
 * is needed by the inline <style> in index.html and by Phaser; scripts stay strictly `'self'` (plus Google's), no inline script, no eval.
 * NOT RUN in a real browser in this milestone: if a deployment shows a blank page, set CSP_MODE=report-only and read the console (docs/DEPLOYMENT.md).
 */
export function contentSecurityPolicy(origins: readonly string[]): string {
  const ws = origins.map((o) => o.replace(/^http/, 'ws'));
  return [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    `connect-src 'self' ${ws.join(' ')} https://accounts.google.com/gsi/`.replace(/\s+/g, ' ').trim(),
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    'frame-src https://accounts.google.com/gsi/',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface HeaderOptions { csp: CspMode; origins: readonly string[]; hsts: boolean }

/** Headers for every non-socket HTTP response (the page, the static files, /auth, /healthz). */
export function securityHeaders(o: HeaderOptions): Record<string, string> {
  const h: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups', // Google's sign-in popup needs to talk back
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (o.csp === 'enforce') h['Content-Security-Policy'] = contentSecurityPolicy(o.origins);
  else if (o.csp === 'report-only') h['Content-Security-Policy-Report-Only'] = contentSecurityPolicy(o.origins);
  if (o.hsts) h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}
