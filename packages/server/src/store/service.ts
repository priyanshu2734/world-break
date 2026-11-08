import { guestProfile, rewardsFor, unlockedDifficulties, type Profile, type RunSave, type StageResult } from '@wb/shared';
import { WriteQueue, type QueueOptions } from './queue';
import type { Account, ProgressStore } from './types';

/**
 * What the game talks to: a `ProgressStore` (or none) behind a health flag and a bounded write queue.
 * - No store, or a store that fails: every method degrades to "guest-like, nothing saved" instead of throwing, and `storageDown` says so (the lobby shows it).
 * - Reads that fail mark the store down; the next success marks it up again.
 * - Writes (`recordClear`, `saveRun`) are queued, retried and ordered; they never block a tick.
 */
export class ProgressService {
  private readonly queue: WriteQueue;
  private readFailed = false;
  private readonly now: () => number;
  private readonly log: (m: string) => void;

  constructor(private readonly store: ProgressStore | null, o: { queue?: QueueOptions; now?: () => number; log?: (m: string) => void } = {}) {
    this.now = o.now ?? Date.now;
    this.log = o.log ?? (() => undefined);
    this.queue = new WriteQueue({ ...o.queue, log: o.queue?.log ?? this.log });
  }

  /** False when there is no store, or the latest read or write failed. */
  get available(): boolean { return this.store !== null && !this.readFailed && this.queue.healthy; }
  get configured(): boolean { return this.store !== null; }
  get pendingWrites(): number { return this.queue.pending; }
  idle(): Promise<void> { return this.queue.idle(); }

  private async read<T>(fn: (s: ProgressStore) => Promise<T>, fallback: T): Promise<T> {
    if (!this.store) return fallback;
    try { const r = await fn(this.store); this.readFailed = false; return r; }
    catch (e) { this.readFailed = true; this.log(`store read failed: ${e instanceof Error ? e.message : 'error'}`); return fallback; }
  }

  /** Sign-in: the account for this identity, or null when the store is unavailable (sign-in is then refused, never faked). */
  login(provider: string, subject: string, name: string): Promise<Account | null> { return this.read((s) => s.upsertAccount(provider, subject, name, this.now()), null); }
  account(id: string): Promise<Account | null> { return this.read((s) => s.getAccount(id), null); }
  runSave(accountId: string): Promise<RunSave | null> { return this.read((s) => s.getRunSave(accountId), null); }
  results(accountId: string, limit = 20) { return this.read((s) => s.listResults(accountId, limit), []); }

  /** Queue one cleared stage for a signed-in player (and the save slot, for the host). Never throws, never waits. */
  recordClear(accountId: string, result: StageResult, save: RunSave | null): void {
    const s = this.store;
    if (!s) return;
    this.queue.enqueue(`clear:${result.stage}`, () => s.recordClear(accountId, result, save, this.now()));
  }
  /** Queue a replacement of the save slot (for instance after the draft is settled). */
  saveRun(accountId: string, save: RunSave): void {
    const s = this.store;
    if (!s) return;
    this.queue.enqueue('save', () => s.saveRun(accountId, save, this.now()));
  }
  async deleteAccount(accountId: string): Promise<boolean> {
    await this.queue.idle(); // earlier writes land first, so they cannot recreate anything afterwards
    if (!this.store) return false;
    try { return await this.store.deleteAccount(accountId); }
    catch (e) { this.readFailed = true; this.log(`delete failed: ${e instanceof Error ? e.message : 'error'}`); throw e; }
  }

  /** The profile of a signed-in account (its own numbers, never the room's). */
  async profile(accountId: string | null): Promise<Profile> {
    if (accountId === null) return this.store && !this.available ? { ...guestProfile(), storage: 'down' } : guestProfile();
    const a = await this.account(accountId);
    if (!a) return { ...guestProfile(), storage: this.configured ? 'down' : 'guest' };
    const save = await this.runSave(accountId);
    return {
      signedIn: true, name: a.name, highestStage: a.highestStage, unlocked: unlockedDifficulties(a.highestStage), rewards: rewardsFor(a.highestStage),
      save: save ? { stage: save.stage, mode: save.mode } : null, storage: this.available ? 'ok' : 'down',
    };
  }
  async close(): Promise<void> { await this.queue.idle(); await this.store?.close(); }
}
