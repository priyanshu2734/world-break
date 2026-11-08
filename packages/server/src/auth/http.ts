import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthLoginSchema } from '@wb/shared';
import type { AuthService } from './index';
import type { ProgressService } from '../store/service';

const COOKIE = 'wb_session';
const MAX_BODY = 8 * 1024;

export interface AuthHttpDeps {
  auth: AuthService;
  progress: ProgressService;
  corsOrigin: string;
  /** Called after an account is deleted so live sockets of that account fall back to guests. */
  onAccountDeleted?: (accountId: string) => void;
  nowMs?: () => number;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
/** The session token of a request (Authorization: Bearer first, then the httpOnly cookie). */
export function tokenFrom(req: Pick<IncomingMessage, 'headers'>, allowCookie: boolean): string | null {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim() || null;
  return allowCookie ? parseCookies(req.headers.cookie)[COOKIE] ?? null : null;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new Error('too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * The HTTP side of sign-in: `/auth/config`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `DELETE /auth/account`.
 * Returns a handler that answers `/auth/*` requests and returns false for anything else. Messages are generic: no stack, no token, no provider detail.
 * State-changing calls (refresh, delete) need the Bearer header (a cookie alone is not enough), so another site cannot trigger them.
 */
export function createAuthHandler(d: AuthHttpDeps): (req: IncomingMessage, res: ServerResponse) => boolean {
  const hits = new Map<string, number[]>();
  const now = d.nowMs ?? Date.now;
  const limited = (ip: string): boolean => {
    const t = now(), list = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    list.push(t); hits.set(ip, list);
    if (hits.size > 2000) hits.delete(hits.keys().next().value as string);
    return list.length > 30;
  };
  const cors = (res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', d.corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Cache-Control', 'no-store');
  };
  const json = (res: ServerResponse, status: number, body: unknown) => { cors(res); res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
  const setCookie = (res: ServerResponse, token: string, maxAge: number) => {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${d.auth.production ? '; Secure' : ''}`);
  };

  return (req, res) => {
    const url = (req.url ?? '').split('?')[0] ?? '';
    if (!url.startsWith('/auth/')) return false;
    void (async () => {
      try {
        if (req.method === 'OPTIONS') { cors(res); res.writeHead(204).end(); return; }
        if (url === '/auth/config' && req.method === 'GET') return json(res, 200, d.auth.config);
        if (url === '/auth/login' && req.method === 'POST') {
          if (!d.auth.provider) return json(res, 404, { error: 'Sign-in is not enabled on this server.' });
          if (limited(req.socket.remoteAddress ?? '?')) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
          if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { error: 'Send JSON.' });
          let body: unknown;
          try { body = await readJson(req); } catch { return json(res, 400, { error: 'Invalid request.' }); }
          const p = AuthLoginSchema.safeParse(body);
          if (!p.success) return json(res, 400, { error: 'Invalid request.' });
          const id = await d.auth.provider.verify(p.data.credential);
          if (!id) return json(res, 401, { error: 'Sign-in failed.' });
          const account = await d.progress.login(id.provider, id.subject, id.displayName);
          if (!account) return json(res, 503, { error: 'Progress storage is unavailable right now. You can still play as a guest.' });
          const { token, expiresAt } = d.auth.issue(account.id);
          setCookie(res, token, d.auth.ttlSeconds);
          return json(res, 200, { token, expiresAt, profile: await d.progress.profile(account.id) });
        }
        if (url === '/auth/logout' && req.method === 'POST') { setCookie(res, '', 0); return json(res, 200, { ok: true }); }
        if (url === '/auth/me' && req.method === 'GET') {
          const id = d.auth.verify(tokenFrom(req, true));
          if (!id) return json(res, 401, { error: 'Not signed in.' });
          // a genuine token for an account that no longer exists (deleted) is not a session; if the store is merely down, say so instead
          if (!(await d.progress.account(id))) return d.progress.available || !d.progress.configured ? json(res, 401, { error: 'Not signed in.' }) : json(res, 503, { error: 'Progress storage is unavailable right now.' });
          return json(res, 200, { profile: await d.progress.profile(id) });
        }
        if (url === '/auth/refresh' && req.method === 'POST') {
          const id = d.auth.verify(tokenFrom(req, false));
          if (!id) return json(res, 401, { error: 'Not signed in.' });
          const account = await d.progress.account(id);
          if (!account) return d.progress.available || !d.progress.configured ? json(res, 401, { error: 'Not signed in.' }) : json(res, 503, { error: 'Progress storage is unavailable right now.' });
          const { token, expiresAt } = d.auth.issue(id);
          setCookie(res, token, d.auth.ttlSeconds);
          return json(res, 200, { token, expiresAt, profile: await d.progress.profile(id) });
        }
        if (url === '/auth/account' && req.method === 'DELETE') {
          const id = d.auth.verify(tokenFrom(req, false));
          if (!id) return json(res, 401, { error: 'Not signed in.' });
          const deleted = await d.progress.deleteAccount(id);
          d.onAccountDeleted?.(id);
          setCookie(res, '', 0);
          return json(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'No such account.' });
        }
        json(res, 404, { error: 'Not found.' });
      } catch {
        try { json(res, 500, { error: 'Something went wrong.' }); } catch { /* the socket is gone */ }
      }
    })();
    return true;
  };
}
