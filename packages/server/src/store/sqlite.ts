import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { COSMETIC_IDS, RunSaveSchema, rewardsFor, type CosmeticId, type RunSave, type StageResult } from '@wb/shared';
import type { DatabaseSync as Db } from 'node:sqlite';
import { LATEST_SCHEMA, migrate } from './migrations';
import { CAS_RETRIES, RESULTS_KEPT, type Account, type ProgressStore, type SaveWrite, type StoredResult } from './types';

// `node:sqlite` is loaded at run time (not as a static import) so a Node build without it fails with a clear message here, not at module load.
function openDb(path: string): Db {
  let mod: typeof import('node:sqlite');
  try { mod = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite'); }
  catch { throw new Error('node:sqlite is not available in this Node build (needs Node 22.5+; see docs/PROGRESSION.md)'); }
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new mod.DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

interface AccountRow { id: string; provider: string; subject: string; name: string; created_at: number; last_seen: number; highest_stage: number; version: number; rewards: string }
const isCosmetic = (x: unknown): x is CosmeticId => typeof x === 'string' && (COSMETIC_IDS as readonly string[]).includes(x);
function toAccount(r: AccountRow): Account {
  let rewards: CosmeticId[] = [];
  try { const p: unknown = JSON.parse(r.rewards); if (Array.isArray(p)) rewards = p.filter(isCosmetic); } catch { /* a corrupt list is an empty list */ }
  return { id: r.id, provider: r.provider, subject: r.subject, name: r.name, createdAt: r.created_at, lastSeen: r.last_seen, highestStage: r.highest_stage, rewards, version: r.version };
}

/**
 * The production `ProgressStore`: the Node built-in `node:sqlite` (no native compilation, installs on Windows with nothing but Node 22.5+).
 * One file, WAL mode. Needs a PERSISTENT DISK where it runs (docs/PROGRESSION.md): on an ephemeral filesystem the file is lost at every deploy.
 */
export class SqliteProgressStore implements ProgressStore {
  readonly schemaVersion: number;
  private readonly db: Db;

  constructor(path: string) {
    this.db = openDb(path);
    try { this.schemaVersion = migrate(this.db); }
    catch (e) { this.db.close(); throw e; }
  }

  async upsertAccount(provider: string, subject: string, name: string, now: number): Promise<Account> {
    const found = this.db.prepare('SELECT * FROM accounts WHERE provider = ? AND subject = ?').get(provider, subject) as unknown as AccountRow | undefined;
    if (found) {
      this.db.prepare('UPDATE accounts SET name = ?, last_seen = ?, version = version + 1 WHERE id = ?').run(name, now, found.id);
      return toAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(found.id) as unknown as AccountRow);
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO accounts (id, provider, subject, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)').run(id, provider, subject, name, now, now);
    return toAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow);
  }
  async getAccount(id: string): Promise<Account | null> {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as unknown as AccountRow | undefined;
    return r ? toAccount(r) : null;
  }

  async recordClear(accountId: string, result: StageResult, save: RunSave | null, now: number): Promise<Account | null> {
    for (let i = 0; i < CAS_RETRIES; i++) {
      const a = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as unknown as AccountRow | undefined;
      if (!a) return null;
      const highest = Math.max(a.highest_stage, result.stage + 1);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // compare-and-set on the version we read: if another connection (another server process, another room) wrote first, nothing changes and we read again
        const upd = this.db.prepare('UPDATE accounts SET highest_stage = ?, rewards = ?, last_seen = ?, version = version + 1 WHERE id = ? AND version = ?')
          .run(highest, JSON.stringify(rewardsFor(highest)), now, accountId, a.version);
        if (Number(upd.changes) !== 1) { this.db.exec('ROLLBACK'); continue; }
        this.db.prepare('INSERT INTO results (account_id, stage, mode, ticks, score, players, deaths, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(accountId, result.stage, result.mode, result.ticks, result.score, result.players, result.deaths, now);
        this.db.prepare('DELETE FROM results WHERE account_id = ? AND id NOT IN (SELECT id FROM results WHERE account_id = ? ORDER BY id DESC LIMIT ?)').run(accountId, accountId, RESULTS_KEPT);
        if (save) this.db.prepare('INSERT INTO run_saves (account_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').run(accountId, JSON.stringify(save), now);
        this.db.exec('COMMIT');
        return toAccount(this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as unknown as AccountRow);
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch { /* already closed */ }
        throw e;
      }
    }
    throw new Error('progress update kept conflicting');
  }

  async saveRun(accountId: string, save: RunSave, now: number, expectedVersion?: number): Promise<SaveWrite> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const a = this.db.prepare('SELECT version FROM accounts WHERE id = ?').get(accountId) as { version: number } | undefined;
      if (!a) { this.db.exec('ROLLBACK'); return { ok: false, missing: true }; }
      if (expectedVersion !== undefined && a.version !== expectedVersion) { this.db.exec('ROLLBACK'); return { ok: false, conflict: true }; }
      this.db.prepare('INSERT INTO run_saves (account_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at').run(accountId, JSON.stringify(save), now);
      this.db.prepare('UPDATE accounts SET last_seen = ?, version = version + 1 WHERE id = ?').run(now, accountId);
      this.db.exec('COMMIT');
      return { ok: true, version: a.version + 1 };
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* already closed */ }
      throw e;
    }
  }
  async getRunSave(accountId: string): Promise<RunSave | null> {
    const r = this.db.prepare('SELECT json FROM run_saves WHERE account_id = ?').get(accountId) as { json: string } | undefined;
    if (!r) return null;
    try { const p = RunSaveSchema.safeParse(JSON.parse(r.json)); return p.success ? p.data : null; } catch { return null; }
  }
  async clearRunSave(accountId: string): Promise<void> { this.db.prepare('DELETE FROM run_saves WHERE account_id = ?').run(accountId); }
  async listResults(accountId: string, limit: number): Promise<StoredResult[]> {
    const rows = this.db.prepare('SELECT stage, mode, ticks, score, players, deaths, at FROM results WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, Math.max(0, Math.min(limit, RESULTS_KEPT))) as unknown as StoredResult[];
    return rows.map((r) => ({ stage: r.stage, mode: r.mode, ticks: r.ticks, score: r.score, players: r.players, deaths: r.deaths, at: r.at }));
  }
  async deleteAccount(accountId: string): Promise<boolean> {
    const r = this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId); // results and the save slot go with it (ON DELETE CASCADE)
    return Number(r.changes) > 0;
  }
  async close(): Promise<void> { try { this.db.close(); } catch { /* already closed */ } }
  /** Test helper: the raw database (for the migration fixture checks). */
  get raw(): Db { return this.db; }
}
export { LATEST_SCHEMA };
