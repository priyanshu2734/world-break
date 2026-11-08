import { rewardsFor } from '@wb/shared';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Forward-only schema migrations. A migration runs once, inside a transaction, and the `schema_version` row is raised in the same transaction, so a crash
 * leaves either the old schema or the new one. Never edit a shipped migration: add a new one. `test/store/migrate.test.ts` opens a database built by
 * migration 1 alone (an "old" install) and checks every row survives.
 */
export interface Migration { version: number; name: string; up(db: DatabaseSync): void }

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'accounts and results',
    up(db) {
      db.exec(`
        CREATE TABLE accounts (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          subject TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          highest_stage INTEGER NOT NULL DEFAULT 1,
          UNIQUE (provider, subject)
        );
        CREATE TABLE results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          stage INTEGER NOT NULL, mode TEXT NOT NULL, ticks INTEGER NOT NULL,
          score INTEGER NOT NULL, players INTEGER NOT NULL, deaths INTEGER NOT NULL, at INTEGER NOT NULL
        );
        CREATE INDEX results_by_account ON results(account_id, id);
      `);
    },
  },
  {
    version: 2,
    name: 'optimistic version, rewards, run save slot',
    up(db) {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE accounts ADD COLUMN rewards TEXT NOT NULL DEFAULT '[]';
        CREATE TABLE run_saves (
          account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
          json TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      // accounts made on schema 1 already reached some stage: grant the cosmetics that earns
      const rows = db.prepare('SELECT id, highest_stage FROM accounts').all() as { id: string; highest_stage: number }[];
      const upd = db.prepare('UPDATE accounts SET rewards = ? WHERE id = ?');
      for (const r of rows) upd.run(JSON.stringify(rewardsFor(r.highest_stage)), r.id);
    },
  },
];
export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function currentVersion(db: DatabaseSync): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}

/** Brings the database to `target` (default: the latest). Refuses a database from a NEWER build (never silently downgrade or guess). */
export function migrate(db: DatabaseSync, target: number = LATEST_SCHEMA): number {
  let v = currentVersion(db);
  if (v > LATEST_SCHEMA) throw new Error(`database schema ${v} is newer than this build (${LATEST_SCHEMA}); refusing to open it`);
  for (const m of MIGRATIONS) {
    if (m.version <= v || m.version > target) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
      v = m.version;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }
  return v;
}
