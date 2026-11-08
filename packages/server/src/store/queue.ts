export interface QueueOptions { max?: number; attempts?: number; baseDelayMs?: number; maxDelayMs?: number; sleep?: (ms: number) => Promise<void>; log?: (msg: string) => void }

/**
 * A bounded, ordered write queue with retries. Progress writes go through here so a slow or failing disk never stalls the game: at most `max`
 * writes wait (the OLDEST is dropped on overflow and counted), each is tried `attempts` times with a growing delay, and a write that still fails is dropped
 * and logged (never silently). `healthy` is false while the latest attempt failed, which the lobby shows as "progress is not being saved".
 */
export class WriteQueue {
  private readonly q: { label: string; fn: () => Promise<unknown> }[] = [];
  private running = false;
  private waiters: (() => void)[] = [];
  private ok = true;
  dropped = 0;
  failed = 0;
  private readonly max: number; private readonly attempts: number; private readonly base: number; private readonly cap: number;
  private readonly sleep: (ms: number) => Promise<void>; private readonly log: (m: string) => void;

  constructor(o: QueueOptions = {}) {
    this.max = Math.max(1, o.max ?? 64); this.attempts = Math.max(1, o.attempts ?? 5);
    this.base = Math.max(0, o.baseDelayMs ?? 200); this.cap = Math.max(this.base, o.maxDelayMs ?? 5000);
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = o.log ?? (() => undefined);
  }
  get healthy(): boolean { return this.ok; }
  get pending(): number { return this.q.length + (this.running ? 1 : 0); }

  enqueue(label: string, fn: () => Promise<unknown>): void {
    while (this.q.length >= this.max) { const old = this.q.shift()!; this.dropped++; this.log(`write queue full: dropped ${old.label}`); }
    this.q.push({ label, fn });
    void this.run();
  }
  /** Resolves when nothing is waiting or running (tests and shutdown). */
  idle(): Promise<void> { return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.waiters.push(r)); }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.q.shift(); job; job = this.q.shift()) {
        let done = false;
        for (let i = 0; i < this.attempts && !done; i++) {
          try { await job.fn(); done = true; this.ok = true; }
          catch (e) {
            this.ok = false;
            this.log(`write ${job.label} failed (attempt ${i + 1}/${this.attempts}): ${e instanceof Error ? e.message : 'error'}`);
            if (i + 1 < this.attempts) await this.sleep(Math.min(this.cap, this.base * 2 ** i));
          }
        }
        if (!done) { this.failed++; this.log(`write ${job.label} dropped after ${this.attempts} attempts`); }
      }
    } finally {
      this.running = false;
      const w = this.waiters; this.waiters = [];
      for (const r of w) r();
    }
  }
}
