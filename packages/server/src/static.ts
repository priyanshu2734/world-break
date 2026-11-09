import { createReadStream, statSync, type Stats } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map', '.webmanifest']);
const GZIP_MIN_BYTES = 1024;
const GZIP_CACHE_MAX = 64;
/** Paths the static handler must never answer with the page (they belong to the API). */
const RESERVED = ['/socket.io', '/auth', '/healthz'];

export interface StaticOptions {
  /** Absolute path of the built client (`packages/client/dist`). */
  root: string;
}

/** True when `dir` holds a built client. */
export function hasBuiltClient(dir: string): boolean {
  try { return statSync(join(dir, 'index.html')).isFile(); } catch { return false; }
}

/**
 * Serves the built client: hashed files under /assets/ are cached for a year (immutable), everything else revalidates (ETag), index.html is never
 * cached, text files are gzipped once and kept in memory, and a path with no file extension that matches no file gets the page (SPA fallback) so a
 * reload of any client route works. A missing file WITH an extension is a real 404 (a missing script must not come back as HTML). Returns false
 * for requests it does not handle so the caller can answer them.
 */
export function createStaticHandler(o: StaticOptions): (req: IncomingMessage, res: ServerResponse) => boolean {
  const root = resolve(o.root);
  const gz = new Map<string, { mtime: number; body: Buffer }>();

  const send = async (req: IncomingMessage, res: ServerResponse, file: string, urlPath: string): Promise<boolean> => {
    let st: Stats;
    try { st = await stat(file); } catch { return false; }
    if (!st.isFile()) return false;
    const ext = extname(file).toLowerCase();
    const isIndex = file === join(root, 'index.html');
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers: Record<string, string | number> = {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      ETag: etag,
      'Cache-Control': isIndex ? 'no-cache' : urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      Vary: 'Accept-Encoding',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return true; }
    const wantsGzip = COMPRESSIBLE.has(ext) && st.size >= GZIP_MIN_BYTES && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    if (wantsGzip) {
      let hit = gz.get(file);
      if (!hit || hit.mtime !== st.mtimeMs) {
        hit = { mtime: st.mtimeMs, body: gzipSync(await readFile(file)) };
        if (gz.size >= GZIP_CACHE_MAX) { const first = gz.keys().next().value as string | undefined; if (first !== undefined) gz.delete(first); }
        gz.set(file, hit);
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = hit.body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : hit.body);
      return true;
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  };

  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return true;
    }
    let pathname: string;
    try { pathname = decodeURIComponent((req.url ?? '/').split('?')[0]?.split('#')[0] ?? '/'); }
    catch { res.writeHead(400).end(); return true; }
    if (pathname.includes('\0') || pathname.includes('\\')) { res.writeHead(400).end(); return true; }
    if (RESERVED.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return false;
    const segments = pathname.split('/').filter((s) => s !== '');
    // no traversal, and no dotfiles (.env, .git, ...) even if one were ever copied into the build
    if (segments.some((s) => s === '..' || s.startsWith('.'))) { res.writeHead(404).end(); return true; }
    const rel = segments.join('/');
    const file = resolve(root, rel === '' ? 'index.html' : rel);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(404).end(); return true; }
    void (async () => {
      try {
        if (await send(req, res, file, `/${rel}`)) return;
        const last = segments[segments.length - 1] ?? '';
        if (last.includes('.')) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found'); return; }
        if (!(await send(req, res, join(root, 'index.html'), '/index.html'))) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      } catch {
        try { res.writeHead(500).end(); } catch { /* the socket is gone */ }
      }
    })();
    return true;
  };
}
