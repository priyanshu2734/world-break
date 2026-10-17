import {
  SERVER_TICK_HZ, nextDisasterPhase,
  type DisasterEvent, type DisasterPhase, type DisasterPublic,
} from '@wb/shared';
import type { DisasterMeta } from './meta';

export type DisasterTone = 'info' | 'good' | 'warn' | 'bad';
export interface DisasterStepResult {
  /** True when anything public changed (phase change). */
  changed: boolean;
  /** Bounded score change to apply this tick (<= 0). */
  scoreDelta: number;
  feed: { text: string; tone: DisasterTone }[];
}
export interface HazardModifier { armed: boolean; periodTicks?: number; r?: number }

/** A RESOLVED disaster is shown for this long before its CLEANUP. */
export const RESOLVED_HOLD_TICKS = 2 * SERVER_TICK_HZ;

/**
 * Lifecycle of one disaster inside one stage attempt. Pure and socket-free. The engine calls `step()` once per
 * simulation tick (after objectives), so escalation depends on ticks only: no wall clock, no Math.random.
 *
 * Every effect of the disaster is a pure function of `phase` (`hazardMod`) plus the bounded heat drain, so
 * reaching CLEANUP removes all of them. `finish()` forces CLEANUP when the stage ends.
 */
export class DisasterRuntime {
  phase: DisasterPhase = 'warning';
  private since = 0;
  private drained = 0;

  constructor(readonly meta: DisasterMeta) {}

  /** Total heat score drained so far (always <= meta.heat.cap). */
  get heatDrained(): number { return this.drained; }
  message(): string { return this.meta.messages[this.phase]; }

  private go(event: DisasterEvent, tick: number, out: DisasterStepResult, text: string, tone: DisasterTone): void {
    this.phase = nextDisasterPhase(this.phase, event);
    this.since = tick;
    out.changed = true;
    out.feed.push({ text, tone });
  }

  /**
   * @param tick     the engine tick that was just simulated (1, 2, 3, ...)
   * @param resolved whether every `resolveObjectives` objective is complete
   */
  step(tick: number, resolved: boolean): DisasterStepResult {
    const out: DisasterStepResult = { changed: false, scoreDelta: 0, feed: [] };
    const { schedule: s, messages: m } = this.meta;

    switch (this.phase) {
      case 'warning':
      case 'active':
      case 'escalated': {
        if (resolved) { this.go('RESOLVE', tick, out, m.resolved, 'good'); break; }
        if (this.phase === 'warning' && tick >= s.activateAtTick) this.go('ACTIVATE', tick, out, m.active, 'warn');
        else if (this.phase === 'active' && tick >= s.escalateAtTick) this.go('ESCALATE', tick, out, m.escalated, 'bad');
        else if (this.phase === 'escalated' && tick >= s.failAtTick) {
          this.go('FAIL', tick, out, m.failed, 'bad');
          out.scoreDelta -= this.meta.failPenalty;
          break;
        }
        if (this.phase === 'escalated' && tick % SERVER_TICK_HZ === 0 && this.drained < this.meta.heat.cap) {
          const d = Math.min(this.meta.heat.perSecond, this.meta.heat.cap - this.drained);
          this.drained += d;
          out.scoreDelta -= d;
        }
        break;
      }
      case 'resolved':
        if (tick - this.since >= RESOLVED_HOLD_TICKS) this.go('CLEAN', tick, out, m.cleanup, 'info');
        break;
      case 'failed':
        if (tick - this.since >= s.failedHoldTicks) this.go('CLEAN', tick, out, m.cleanup, 'info');
        break;
      case 'cleanup':
        break;
    }
    return out;
  }

  /** Guaranteed cleanup: called when the stage ends. Idempotent; safe from every phase. */
  finish(tick: number): DisasterStepResult {
    const out: DisasterStepResult = { changed: false, scoreDelta: 0, feed: [] };
    const m = this.meta.messages;
    if (this.phase === 'cleanup') return out;
    if (this.phase === 'warning' || this.phase === 'active' || this.phase === 'escalated') this.go('RESOLVE', tick, out, m.resolved, 'good');
    this.go('CLEAN', tick, out, m.cleanup, 'info');
    return out;
  }

  /** How the current phase modifies a hazard, or undefined if this disaster does not touch it. */
  hazardMod(hazardId: string): HazardModifier | undefined {
    const hp = this.meta.hazardPhases.find((h) => h.hazardId === hazardId);
    if (!hp) return undefined;
    switch (this.phase) {
      case 'warning': return { armed: false };
      case 'active': return { armed: hp.armedFrom === 'active' };
      case 'escalated':
      case 'failed': return { armed: true, periodTicks: hp.escalated?.periodTicks, r: hp.escalated?.r };
      case 'resolved':
      case 'cleanup': return { armed: false };
    }
  }

  publicState(): DisasterPublic {
    const live = this.phase === 'warning' || this.phase === 'active';
    const pending = live || this.phase === 'escalated';
    return {
      id: this.meta.id,
      name: this.meta.name,
      version: this.meta.version,
      phase: this.phase,
      message: this.message(),
      escalatesAtTick: live ? this.meta.schedule.escalateAtTick : null,
      failsAtTick: pending ? this.meta.schedule.failAtTick : null,
      threats: this.meta.threats.map((t) => ({ ...t })),
    };
  }
}
