import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';

export interface Raw { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

/** A raw HTTP request: the path is sent exactly as given (fetch would normalise `..` and `%2e%2e`). */
export function raw(port: number, path: string, o: { method?: string; headers?: Record<string, string> } = {}): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: o.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** A temporary directory that is removed afterwards; removal ignores Windows file-lock errors. */
export function tempDir(prefix: string): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* EPERM or EBUSY on Windows: harmless */ } } };
}

export function open(port: number, o: { extraHeaders?: Record<string, string>; token?: string } = {}): Socket {
  return connect(`http://localhost:${port}`, {
    transports: ['websocket'], forceNew: true, reconnection: false,
    ...(o.extraHeaders ? { extraHeaders: o.extraHeaders } : {}),
    ...(o.token ? { auth: { token: o.token } } : {}),
  });
}
/** Resolves with 'connected' or the connect error's message. */
export function outcome(s: Socket): Promise<string> {
  return new Promise((resolve) => { s.on('connect', () => resolve('connected')); s.on('connect_error', (e: Error) => resolve(e.message)); });
}
export const ack = <T = unknown>(s: Socket, ev: string, payload: unknown = {}): Promise<T> => new Promise((resolve) => { s.emit(ev, payload, (r: T) => resolve(r)); });
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export async function until(pred: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(10); }
}
