import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import { COSMETIC_IDS, guestProfile, isDifficultyUnlocked, rewardsFor, type RunSave, type StageResult } from '@wb/shared';
import { MemoryProgressStore } from '../../src/store/memory';
import { LATEST_SCHEMA, MIGRATIONS, migrate } from '../../src/store/migrations';
import { WriteQueue } from '../../src/store/queue';
import { ProgressService } from '../../src/store/service';
import { SqliteProgressStore } from '../../src/store/sqlite';
import type { ProgressStore } from '../../src/store/types';

const dir = mkdtempSync(join(tmpdir(), 'wb-store-'));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps SQLite files locked until the process ends */ } });
let n = 0;
const file = () => join(dir, `db-${n++}.sqlite`);

const result = (stage: number, o: Partial<StageResult> = {}): StageResult => ({ stage, mode: 'easy', ticks: 1200, score: 300, players: 2, deaths: 0, ...o });
const save = (stage: number, o: Partial<RunSave> = {}): RunSave => ({ stage, mode: 'easy', seedBase: 777, variety: [], upgrades: { wide_beam: 1 }, pickOrder: ['wide_beam'], ...o });

const makers: [string, () => ProgressStore][] = [
  ['memory', () => new MemoryProgressStore()],
  ['sqlite (in memory)', () => new SqliteProgressStore(':memory:')],
  ['sqlite (file)', () => new SqliteProgressStore(file())],
];

describe.each(makers)('ProgressStore contract: %s', (_name, make) => {
  it('creates an account once per (provider, subject) and keeps only id, subject, name and times', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'ann', 'Ann', 1000);
    const b = await s.upsertAccount('dev', 'ann', 'Ann B', 2000);
    const c = await s.upsertAccount('google', 'ann', 'Other Ann', 3000);
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    expect(b).toMatchObject({ name: 'Ann B', createdAt: 1000, lastSeen: 2000, highestStage: 1, rewards: [] });
    expect(Object.keys(a).sort()).toEqual(['createdAt', 'highestStage', 'id', 'lastSeen', 'name', 'provider', 'rewards', 'subject', 'version']);
    expect(await s.getAccount('nobody')).toBeNull();
    await s.close();
  });

  it('clearing stage S reaches S + 1 and never lowers the highest stage (a failed or replayed stage cannot lower it)', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'a', 'A', 1);
    expect((await s.recordClear(a.id, result(3), null, 2))!.highestStage).toBe(4);
    expect((await s.recordClear(a.id, result(20), null, 3))!.highestStage).toBe(21);
    expect((await s.recordClear(a.id, result(2), null, 4))!.highestStage).toBe(21); // an older stage again: unchanged
    expect((await s.getAccount(a.id))!.highestStage).toBe(21);
    await s.close();
  });

  it('unlock boundaries through the store: clearing 8 leaves Intermediate locked, clearing 9 unlocks it; clearing 18 and 19 for Hardcore', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'b', 'B', 1);
    expect(isDifficultyUnlocked('intermediate', (await s.recordClear(a.id, result(8), null, 2))!.highestStage)).toBe(false);
    expect(isDifficultyUnlocked('intermediate', (await s.recordClear(a.id, result(9), null, 3))!.highestStage)).toBe(true);
    expect(isDifficultyUnlocked('hardcore', (await s.recordClear(a.id, result(18), null, 4))!.highestStage)).toBe(false);
    expect(isDifficultyUnlocked('hardcore', (await s.recordClear(a.id, result(19), null, 5))!.highestStage)).toBe(true);
    await s.close();
  });

  it('grants a cosmetic at each milestone (10, 20, 30 ...) and a huge stage works', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'c', 'C', 1);
    expect((await s.recordClear(a.id, result(8), null, 2))!.rewards).toEqual([]);
    expect((await s.recordClear(a.id, result(9), null, 3))!.rewards).toEqual(rewardsFor(10));
    expect((await s.recordClear(a.id, result(29), null, 4))!.rewards).toHaveLength(3);
    const big = (await s.recordClear(a.id, result(1_000_000), null, 5))!;
    expect(big.highestStage).toBe(1_000_001);
    expect(big.rewards).toEqual([...COSMETIC_IDS]);
    await s.close();
  });

  it('stores results (stage, mode, time, score, players, deaths), newest first, and bounds them', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'd', 'D', 1);
    for (let i = 1; i <= 205; i++) await s.recordClear(a.id, result(i, { score: i * 10, deaths: i % 3, players: 1 + (i % 4), mode: i > 100 ? 'intermediate' : 'easy' }), null, i);
    const list = await s.listResults(a.id, 500);
    expect(list.length).toBeLessThanOrEqual(200);
    expect(list[0]).toMatchObject({ stage: 205, score: 2050, mode: 'intermediate', at: 205 });
    expect(Object.keys(list[0]!).sort()).toEqual(['at', 'deaths', 'mode', 'players', 'score', 'stage', 'ticks']);
    expect((await s.listResults(a.id, 3)).map((r) => r.stage)).toEqual([205, 204, 203]);
    await s.close();
  });

  it('the save slot round-trips and is replaced, only when a stage is cleared with one or saveRun is called', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'e', 'E', 1);
    expect(await s.getRunSave(a.id)).toBeNull();
    await s.recordClear(a.id, result(5), null, 2);
    expect(await s.getRunSave(a.id)).toBeNull(); // a clear without a save does not invent one
    await s.recordClear(a.id, result(5), save(6), 3);
    expect(await s.getRunSave(a.id)).toEqual(save(6));
    expect((await s.saveRun(a.id, save(6, { upgrades: {}, pickOrder: [] }), 4)).ok).toBe(true);
    expect((await s.getRunSave(a.id))!.upgrades).toEqual({});
    await s.clearRunSave(a.id);
    expect(await s.getRunSave(a.id)).toBeNull();
    expect(await s.saveRun('nobody', save(2), 5)).toEqual({ ok: false, missing: true });
    await s.close();
  });

  it('optimistic versioning: a save naming an old account version is refused', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'f', 'F', 1);
    const first = await s.saveRun(a.id, save(2), 2, a.version);
    expect(first.ok).toBe(true);
    expect(await s.saveRun(a.id, save(3), 3, a.version)).toEqual({ ok: false, conflict: true }); // stale
    expect((await s.getRunSave(a.id))!.stage).toBe(2);
    await s.close();
  });

  it('deleting an account removes the account, its results and its save, and nothing else', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'g', 'G', 1), b = await s.upsertAccount('dev', 'h', 'H', 1);
    await s.recordClear(a.id, result(4), save(5), 2); await s.recordClear(b.id, result(4), save(5), 2);
    expect(await s.deleteAccount(a.id)).toBe(true);
    expect(await s.getAccount(a.id)).toBeNull();
    expect(await s.getRunSave(a.id)).toBeNull();
    expect(await s.listResults(a.id, 10)).toEqual([]);
    expect((await s.getAccount(b.id))!.highestStage).toBe(5);
    expect(await s.listResults(b.id, 10)).toHaveLength(1);
    expect(await s.deleteAccount(a.id)).toBe(false);
    expect(await s.recordClear(a.id, result(9), null, 3)).toBeNull(); // a deleted account is not resurrected by a late write
    await s.close();
  });

  it('concurrent updates never lose one another: many clears at once end at the maximum, every result kept, the version counts every write', async () => {
    const s = make();
    const a = await s.upsertAccount('dev', 'i', 'I', 1);
    const stages = [3, 17, 5, 40, 9, 22, 1, 31, 12, 8];
    await Promise.all(stages.map((st) => s.recordClear(a.id, result(st), save(st + 1), 10)));
    const after = (await s.getAccount(a.id))!;
    expect(after.highestStage).toBe(41);
    expect((await s.listResults(a.id, 50)).length).toBe(stages.length);
    expect(after.version).toBe(a.version + stages.length);
    await s.close();
  });
});

describe('concurrent writers: compare-and-set', () => {
  it('memory: a writer that slips in between a read and a write forces a re-read, and neither update is lost', async () => {
    const s = new MemoryProgressStore();
    const a = await s.upsertAccount('dev', 'x', 'X', 1);
    let once = true;
    s.hook = () => { if (once) { once = false; void s.recordClear(a.id, result(30), null, 5); } };
    const mine = await s.recordClear(a.id, result(4), null, 6);
    expect(mine!.highestStage).toBe(31); // the other room's higher stage survived; ours did not overwrite it
    expect((await s.listResults(a.id, 10)).length).toBe(2);
  });
  it('sqlite: two connections to one file (two rooms, two processes) cannot overwrite each other', async () => {
    const path = file();
    const one = new SqliteProgressStore(path), two = new SqliteProgressStore(path);
    const a = await one.upsertAccount('dev', 'y', 'Y', 1);
    await Promise.all([one.recordClear(a.id, result(11), save(12), 2), two.recordClear(a.id, result(25), save(26), 2), one.recordClear(a.id, result(7), null, 2), two.recordClear(a.id, result(2), null, 2)]);
    const after = (await two.getAccount(a.id))!;
    expect(after.highestStage).toBe(26);
    expect((await one.listResults(a.id, 10)).length).toBe(4);
    await one.close(); await two.close();
  });
  it('sqlite: a stale expected version across connections is refused', async () => {
    const path = file();
    const one = new SqliteProgressStore(path), two = new SqliteProgressStore(path);
    const a = await one.upsertAccount('dev', 'z', 'Z', 1);
    await two.recordClear(a.id, result(2), null, 2); // bumps the version behind one's back
    expect(await one.saveRun(a.id, save(3), 3, a.version)).toEqual({ ok: false, conflict: true });
    await one.close(); await two.close();
  });
});

describe('schema versions and forward migrations', () => {
  const DatabaseSync = (createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;

  it('a new database is created at the latest schema, with a version table', () => {
    const s = new SqliteProgressStore(file());
    expect(s.schemaVersion).toBe(LATEST_SCHEMA);
    expect(LATEST_SCHEMA).toBe(MIGRATIONS.length);
    expect((s.raw.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }).v).toBe(LATEST_SCHEMA);
  });

  it('an OLD (version 1) database migrates forward: every account, result and stage survives; new columns get sane values; rewards are backfilled', async () => {
    const path = file();
    const old = new DatabaseSync(path);
    old.exec('PRAGMA foreign_keys = ON;');
    expect(migrate(old, 1)).toBe(1); // the fixture: exactly what a build that shipped schema 1 would have written
    old.prepare('INSERT INTO accounts (id, provider, subject, name, created_at, last_seen, highest_stage) VALUES (?, ?, ?, ?, ?, ?, ?)').run('old-1', 'google', 'sub-1', 'Veteran', 111, 222, 31);
    old.prepare('INSERT INTO accounts (id, provider, subject, name, created_at, last_seen, highest_stage) VALUES (?, ?, ?, ?, ?, ?, ?)').run('old-2', 'dev', 'newbie', 'Newbie', 333, 444, 3);
    old.prepare('INSERT INTO results (account_id, stage, mode, ticks, score, players, deaths, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('old-1', 30, 'intermediate', 5000, 900, 3, 1, 555);
    expect((old.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }).v).toBe(1);
    expect(() => old.prepare('SELECT version FROM accounts').get()).toThrow(); // schema 1 has no version column
    old.close();

    const s = new SqliteProgressStore(path);
    expect(s.schemaVersion).toBe(LATEST_SCHEMA);
    const v = (await s.getAccount('old-1'))!;
    expect(v).toMatchObject({ name: 'Veteran', provider: 'google', subject: 'sub-1', createdAt: 111, lastSeen: 222, highestStage: 31, version: 0 });
    expect(v.rewards).toEqual(rewardsFor(31)); // three cosmetics for having reached 31
    expect((await s.getAccount('old-2'))!.rewards).toEqual([]);
    expect(await s.listResults('old-1', 10)).toEqual([{ stage: 30, mode: 'intermediate', ticks: 5000, score: 900, players: 3, deaths: 1, at: 555 }]);
    expect(await s.getRunSave('old-1')).toBeNull();
    // the migrated database works with the new features
    const after = (await s.recordClear('old-1', result(40), save(41), 999))!;
    expect(after.highestStage).toBe(41);
    expect(await s.getRunSave('old-1')).toEqual(save(41));
    await s.close();
  });

  it('opening twice does not migrate twice, and a database from a NEWER build is refused (never silently downgraded)', async () => {
    const path = file();
    new SqliteProgressStore(path);
    const again = new SqliteProgressStore(path);
    expect((again.raw.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as { c: number }).c).toBe(LATEST_SCHEMA);
    again.raw.prepare('INSERT INTO schema_version (version) VALUES (?)').run(LATEST_SCHEMA + 5);
    await again.close();
    expect(() => new SqliteProgressStore(path)).toThrow(/newer than this build/);
  });

  it('a migration that fails rolls back and leaves the old version in place', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, 1);
    db.exec('CREATE TABLE run_saves (x INTEGER)'); // makes migration 2 collide
    expect(() => migrate(db)).toThrow();
    expect((db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number }).v).toBe(1);
    expect(() => db.prepare('SELECT version FROM accounts').get()).toThrow(); // the ALTERs were rolled back too
    db.close();
  });
});

describe('WriteQueue', () => {
  const quick = { baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined };
  it('runs writes in order, one at a time, and idle() waits for all of them', async () => {
    const q = new WriteQueue(quick);
    const order: number[] = [];
    for (let i = 0; i < 5; i++) q.enqueue(`w${i}`, async () => { await Promise.resolve(); order.push(i); });
    await q.idle();
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(q.pending).toBe(0);
  });
  it('retries a failing write and succeeds when the store comes back', async () => {
    const q = new WriteQueue({ ...quick, attempts: 4 });
    let calls = 0;
    q.enqueue('flaky', async () => { if (++calls < 3) throw new Error('disk gone'); });
    await q.idle();
    expect(calls).toBe(3);
    expect(q.healthy).toBe(true);
    expect(q.failed).toBe(0);
  });
  it('gives up after the attempts, says so, and carries on with the next write', async () => {
    const logs: string[] = [];
    const q = new WriteQueue({ ...quick, attempts: 2, log: (m) => logs.push(m) });
    const done: string[] = [];
    q.enqueue('bad', async () => { throw new Error('nope'); });
    q.enqueue('good', async () => { done.push('good'); });
    await q.idle();
    expect(done).toEqual(['good']);
    expect(q.failed).toBe(1);
    expect(logs.some((l) => l.includes('dropped after 2 attempts'))).toBe(true);
  });
  it('is bounded: when full the OLDEST waiting write is dropped and counted', async () => {
    const q = new WriteQueue({ ...quick, max: 3 });
    const ran: number[] = [];
    let release: () => void = () => undefined;
    q.enqueue('blocker', () => new Promise<void>((r) => { release = r; })); // occupies the worker
    for (let i = 0; i < 10; i++) q.enqueue(`w${i}`, async () => { ran.push(i); });
    expect(q.dropped).toBe(7);
    release();
    await q.idle();
    expect(ran).toEqual([7, 8, 9]);
  });
  it('is unhealthy while the latest attempt failed', async () => {
    const q = new WriteQueue({ ...quick, attempts: 1 });
    q.enqueue('bad', async () => { throw new Error('x'); });
    await q.idle();
    expect(q.healthy).toBe(false);
    q.enqueue('ok', async () => undefined);
    await q.idle();
    expect(q.healthy).toBe(true);
  });
});

/** A store that fails every call while `down` is true (the disk is gone), and otherwise behaves like the memory store. */
class FlakyStore extends MemoryProgressStore {
  down = false;
  failures = 0;
  private gate<T>(fn: () => Promise<T>): Promise<T> { if (this.down) { this.failures++; return Promise.reject(new Error('storage is down')); } return fn(); }
  override upsertAccount(...a: Parameters<MemoryProgressStore['upsertAccount']>) { return this.gate(() => super.upsertAccount(...a)); }
  override getAccount(id: string) { return this.gate(() => super.getAccount(id)); }
  override recordClear(...a: Parameters<MemoryProgressStore['recordClear']>) { return this.gate(() => super.recordClear(...a)); }
  override saveRun(...a: Parameters<MemoryProgressStore['saveRun']>) { return this.gate(() => super.saveRun(...a)); }
  override getRunSave(id: string) { return this.gate(() => super.getRunSave(id)); }
}

describe('ProgressService when the store is down or missing', () => {
  const q = { baseDelayMs: 0, maxDelayMs: 0, sleep: async () => undefined };
  it('no store at all: a guest profile, nothing thrown, writes are no-ops, sign-in is refused', async () => {
    const p = new ProgressService(null);
    expect(await p.profile(null)).toEqual(guestProfile());
    expect(await p.login('dev', 'a', 'A')).toBeNull();
    expect(() => p.recordClear('x', result(2), null)).not.toThrow();
    expect(p.available).toBe(false);
    expect(await p.profile('some-id')).toMatchObject({ signedIn: false, storage: 'guest' });
  });
  it('store down at sign-in: refused (never faked); store down for a known account: guest-like profile that says storage is down', async () => {
    const s = new FlakyStore();
    const p = new ProgressService(s, { queue: q });
    const a = (await p.login('dev', 'a', 'A'))!;
    expect(a).not.toBeNull();
    s.down = true;
    expect(await p.login('dev', 'b', 'B')).toBeNull();
    const prof = await p.profile(a.id);
    expect(prof).toMatchObject({ signedIn: false, storage: 'down', unlocked: ['easy'], save: null });
    expect(p.available).toBe(false);
    s.down = false;
    expect((await p.profile(a.id)).signedIn).toBe(true);
    expect(p.available).toBe(true);
  });
  it('writes made while the store is down are retried and land when it recovers (within the attempts)', async () => {
    const s = new FlakyStore();
    const p = new ProgressService(s, { queue: { ...q, attempts: 6, sleep: async () => { if (s.failures >= 2) s.down = false; } } });
    const a = (await p.login('dev', 'a', 'A'))!;
    s.down = true;
    p.recordClear(a.id, result(9), save(10));
    await p.idle();
    s.down = false;
    expect((await s.getAccount(a.id))!.highestStage).toBe(10);
    expect(await s.getRunSave(a.id)).toEqual(save(10));
  });
  it('a write that never succeeds is dropped without ever throwing into the game', async () => {
    const s = new FlakyStore();
    const p = new ProgressService(s, { queue: { ...q, attempts: 2 } });
    const a = (await p.login('dev', 'a', 'A'))!;
    s.down = true;
    expect(() => p.recordClear(a.id, result(9), null)).not.toThrow();
    await p.idle();
    expect(p.available).toBe(false);
    s.down = false;
    expect((await s.getAccount(a.id))!.highestStage).toBe(1); // nothing half-written
  });
  it('the profile of an account carries its own highest stage, unlocks, rewards and save', async () => {
    const s = new MemoryProgressStore();
    const p = new ProgressService(s, { queue: q });
    const a = (await p.login('dev', 'v', 'V'))!;
    p.recordClear(a.id, result(19, { mode: 'intermediate' }), save(20, { mode: 'intermediate' }));
    await p.idle();
    expect(await p.profile(a.id)).toEqual({
      signedIn: true, name: 'V', highestStage: 20, unlocked: ['easy', 'intermediate', 'hardcore'], rewards: rewardsFor(20),
      save: { stage: 20, mode: 'intermediate' }, storage: 'ok',
    });
  });
  it('a corrupt save in the store reads as no save (never crashes the lobby)', async () => {
    const s = new MemoryProgressStore();
    const p = new ProgressService(s, { queue: q });
    const a = (await p.login('dev', 'w', 'W'))!;
    s.rawSave(a.id, '{not json'); expect(await p.runSave(a.id)).toBeNull();
    s.rawSave(a.id, JSON.stringify({ ...save(5), stage: -4 })); expect(await p.runSave(a.id)).toBeNull();
    expect((await p.profile(a.id)).save).toBeNull();
  });
  it('deleting waits for queued writes first, then removes everything', async () => {
    const s = new MemoryProgressStore();
    const p = new ProgressService(s, { queue: q });
    const a = (await p.login('dev', 'del', 'Del'))!;
    p.recordClear(a.id, result(9), save(10));
    expect(await p.deleteAccount(a.id)).toBe(true);
    expect(await s.getAccount(a.id)).toBeNull();
    expect(s.size).toBe(0);
  });
});
