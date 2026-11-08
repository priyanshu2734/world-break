import type { CosmeticId, RunSave, StageResult } from '@wb/shared';

/** What the server remembers about a signed-in player. No email, no password: only who the provider says they are, a display name and times. */
export interface Account {
  id: string;
  provider: string;
  subject: string;
  name: string;
  createdAt: number;
  lastSeen: number;
  /** The highest stage REACHED (clearing stage S reaches S + 1). Only ever goes up. */
  highestStage: number;
  rewards: CosmeticId[];
  /** Bumped by every write to the account; a write that names an older version is refused (optimistic versioning). */
  version: number;
}
export type SaveWrite = { ok: true; version: number } | { ok: false; conflict: true } | { ok: false; missing: true };

export interface StoredResult extends StageResult { at: number }

/**
 * The only persistence the game has (docs/PROGRESSION.md). Every method may reject (the disk is gone, the file is locked): callers go through
 * `ProgressService`, which turns that into "guest-like, nothing saved" and retries writes through a bounded queue.
 */
export interface ProgressStore {
  /** Version of the schema the store is on (after migrations). */
  readonly schemaVersion: number;
  /** The account for (provider, subject), created on first sight. Updates the name and the last-seen time. */
  upsertAccount(provider: string, subject: string, name: string, now: number): Promise<Account>;
  getAccount(id: string): Promise<Account | null>;
  /**
   * One cleared stage, atomically: record the result, raise the highest stage to `result.stage + 1` (never lower it), grant the cosmetics that earns,
   * and (when `save` is given) replace the run save slot. Concurrent calls cannot overwrite each other: the update is a compare-and-set on the
   * account version, retried a bounded number of times. Returns the account as it is afterwards, or null if it no longer exists.
   */
  recordClear(accountId: string, result: StageResult, save: RunSave | null, now: number): Promise<Account | null>;
  /** Replace the save slot. With `expectedVersion`, refused (`conflict`) when the account changed since the caller read it. */
  saveRun(accountId: string, save: RunSave, now: number, expectedVersion?: number): Promise<SaveWrite>;
  getRunSave(accountId: string): Promise<RunSave | null>;
  clearRunSave(accountId: string): Promise<void>;
  listResults(accountId: string, limit: number): Promise<StoredResult[]>;
  /** Delete the account and everything stored for it. True if it existed. */
  deleteAccount(accountId: string): Promise<boolean>;
  close(): Promise<void>;
}

/** Most results kept per account (older ones are dropped as new ones arrive). */
export const RESULTS_KEPT = 200;
/** How many times a compare-and-set is retried before the write is reported as failed. */
export const CAS_RETRIES = 5;
