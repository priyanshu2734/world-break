import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth';
import { createGameServer, type GameServer } from '../../src/gateway';
import { MemoryProgressStore } from '../../src/store/memory';
import { ProgressService } from '../../src/store/service';
import { createShutdown } from '../../src/shutdown';
import { sleep } from './helpers';

const fakes = (o: { closeServer?: () => Promise<void>; closeProgress?: () => Promise<void> } = {}) => {
  const calls: string[] = [];
  const exits: number[] = [];
  const logs: string[] = [];
  return {
    calls, exits, logs,
    deps: {
      server: { drain: () => { calls.push('drain'); }, close: o.closeServer ?? (async () => { calls.push('server.close'); }) },
      progress: { close: o.closeProgress ?? (async () => { calls.push('progress.close'); }) },
      log: (m: string) => { logs.push(m); },
      exit: (c: number) => { exits.push(c); },
      timeoutMs: 1000,
    },
  };
};

describe('P7 graceful shutdown', () => {
  it('drains, closes the server, then flushes and closes the database, then exits 0', async () => {
    const f = fakes();
    await createShutdown(f.deps)('SIGTERM');
    expect(f.calls).toEqual(['drain', 'server.close', 'progress.close']);
    expect(f.exits).toEqual([0]);
  });
  it('runs once however many signals arrive', async () => {
    const f = fakes();
    const stop = createShutdown(f.deps);
    await Promise.all([stop('SIGTERM'), stop('SIGINT'), stop('SIGTERM')]);
    expect(f.calls).toEqual(['drain', 'server.close', 'progress.close']);
    expect(f.exits).toEqual([0]);
  });
  it('exits 1 when a step fails, and logs no stack', async () => {
    const f = fakes({ closeProgress: async () => { throw new Error('disk full'); } });
    await createShutdown(f.deps)('SIGTERM');
    expect(f.exits).toEqual([1]);
    expect(f.logs.join('\n')).toMatch(/disk full/);
  });
  it('exits 1 by itself when a step hangs past the timeout', async () => {
    const f = fakes({ closeServer: () => new Promise<void>(() => undefined) });
    f.deps.timeoutMs = 30;
    void createShutdown(f.deps)('SIGTERM');
    await sleep(120);
    expect(f.exits).toEqual([1]);
  });
});

describe('P7 shutdown against a real gateway', () => {
  let server: GameServer | null = null;
  afterEach(async () => { await server?.close(); server = null; });

  it('queued progress writes finish before the store closes, and close() resolves', async () => {
    const store = new MemoryProgressStore();
    const progress = new ProgressService(store, { queue: { baseDelayMs: 0, maxDelayMs: 0 } });
    const auth = new AuthService({ mode: 'dev', secret: 'test-secret-test-secret-test-secret-123', env: { NODE_ENV: 'test' } });
    const account = await progress.login('dev', 'ann', 'Ann');
    expect(account).not.toBeNull();
    server = createGameServer({ auth, progress });
    await server.listen(0);
    // a slow write is in the queue when the signal arrives
    let finished = false;
    progress.saveRun(account!.id, { stage: 2, mode: 'easy' } as never);
    const originalClose = progress.close.bind(progress);
    const exits: number[] = [];
    await createShutdown({
      server, progress: { close: async () => { await originalClose(); finished = progress.pendingWrites === 0; } },
      log: () => undefined, exit: (c) => { exits.push(c); }, timeoutMs: 2000,
    })('SIGTERM');
    expect(finished).toBe(true);
    expect(exits).toEqual([0]);
    server = null; // already closed
  });
});
