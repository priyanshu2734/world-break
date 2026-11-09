// Consistent online backup of the SQLite progress database (safe while the server is running, WAL included).
// Usage:  node scripts/backup-db.mjs [source] [destination-directory]
//   source      default: $DATABASE_PATH or data/world-break.sqlite
//   destination default: backups/   (a file world-break-<UTC timestamp>.sqlite is written, and only the newest 14 are kept)
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const source = resolve(process.argv[2] ?? process.env.DATABASE_PATH ?? 'data/world-break.sqlite');
const dir = resolve(process.argv[3] ?? 'backups');
if (!existsSync(source)) { console.error(`no database at ${source}`); process.exit(1); }
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(dir, `world-break-${stamp}.sqlite`);
const db = new DatabaseSync(source);
try {
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); // a consistent snapshot in one file, no -wal/-shm
} finally { db.close(); }
const keep = readdirSync(dir).filter((f) => /^world-break-.*\.sqlite$/.test(f)).sort();
for (const old of keep.slice(0, Math.max(0, keep.length - 14))) { try { rmSync(join(dir, old)); } catch { /* ignore */ } }
console.log(`backup written: ${out}`);
