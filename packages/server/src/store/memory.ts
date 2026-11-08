import { randomUUID } from 'node:crypto';
import { RunSaveSchema, rewardsFor, type RunSave, type StageResult } from '@wb/shared';
import { CAS_RETRIES, RESULTS_KEPT, type Account, type ProgressStore, type SaveWrite, type StoredResult } from './types';

/**
 * An in-memory `ProgressStore`: used by the tests and as the reference behaviour the SQLite store must match. `hook` lets a test run code between the
 * read and the write of a compare-and-set, which is how a concurrent writer is simulated deterministically.
 */
export class MemoryProgressStore implements ProgressStore {
  readonly schemaVersion = 2;
  private accounts = new Map<string, Account>();
  private results = new Map<string, StoredResult[]>();
  private saves = new Map<string, string>();
  /** Test seam: called after a read and before the matching write inside `recordClear`. */
  hook: (() => void) | null = null;

  async upsertAccount(provider: string, subject: string, name: string, now: number): Promise<Account> {
    for (const a of this.accounts.values()) if (a.provider === provider && a.subject === subject) { a.name = name; a.lastSeen = now; a.version++; return { ...a, rewards: [...a.rewards] }; }
    const a: Account = { id: randomUUID(), provider, subject, name, createdAt: now, lastSeen: now, highestStage: 1, rewards: [], version: 0 };
    this.accounts.set(a.id, a);
    return { ...a, rewards: [] };
  }
  async getAccount(id: string): Promise<Account | null> { const a = this.accounts.get(id); return a ? { ...a, rewards: [...a.rewards] } : null; }

  async recordClear(accountId: string, result: StageResult, save: RunSave | null, now: number): Promise<Account | null> {
    for (let i = 0; i < CAS_RETRIES; i++) {
      const a = this.accounts.get(accountId);
      if (!a) return null;
      const seen = a.version, highest = Math.max(a.highestStage, result.stage + 1);
      this.hook?.();
      const cur = this.accounts.get(accountId);
      if (!cur) return null;
      if (cur.version !== seen) continue; // somebody else wrote in between: read again
      cur.highestStage = Math.max(cur.highestStage, highest);
      cur.rewards = rewardsFor(cur.highestStage);
      cur.lastSeen = now; cur.version++;
      const list = this.results.get(accountId) ?? [];
      list.push({ ...result, at: now });
      this.results.set(accountId, list.slice(-RESULTS_KEPT));
      if (save) this.saves.set(accountId, JSON.stringify(save));
      return { ...cur, rewards: [...cur.rewards] };
    }
    throw new Error('progress update kept conflicting');
  }

  async saveRun(accountId: string, save: RunSave, now: number, expectedVersion?: number): Promise<SaveWrite> {
    const a = this.accounts.get(accountId);
    if (!a) return { ok: false, missing: true };
    if (expectedVersion !== undefined && a.version !== expectedVersion) return { ok: false, conflict: true };
    this.saves.set(accountId, JSON.stringify(save)); a.lastSeen = now; a.version++;
    return { ok: true, version: a.version };
  }
  async getRunSave(accountId: string): Promise<RunSave | null> {
    const raw = this.saves.get(accountId);
    if (raw === undefined) return null;
    try { const p = RunSaveSchema.safeParse(JSON.parse(raw)); return p.success ? p.data : null; } catch { return null; }
  }
  async clearRunSave(accountId: string): Promise<void> { this.saves.delete(accountId); }
  async listResults(accountId: string, limit: number): Promise<StoredResult[]> { return [...(this.results.get(accountId) ?? [])].slice(-Math.max(0, limit)).reverse(); }
  async deleteAccount(accountId: string): Promise<boolean> {
    this.results.delete(accountId); this.saves.delete(accountId);
    return this.accounts.delete(accountId);
  }
  async close(): Promise<void> { /* nothing to release */ }
  /** Test helper: write a raw (possibly corrupt) save string. */
  rawSave(accountId: string, raw: string): void { this.saves.set(accountId, raw); }
  get size(): number { return this.accounts.size; }
}
