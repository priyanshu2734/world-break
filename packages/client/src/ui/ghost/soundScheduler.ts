import type { GhostCue, GhostType } from '@wb/shared';
import { CUE_STALE_MS, MAX_CATCHUP_MS, WHISPER_PERIOD_MS, footstepPeriodMs, heartbeatGain, heartbeatPeriodMs, nearest, panFor, soundGain } from './cueMath';

export const KNOCK_PERIOD_MS = 500;
export type SoundEvent =
  | { kind: 'step'; ghost: string; type: string; gain: number; pan: number; hunting: boolean }
  | { kind: 'beat'; gain: number; fast: boolean }
  /** `type` (P3E step 5, only when the cue names the ghost in its warning): each type has its own whisper. */
  | { kind: 'whisper'; type?: GhostType }
  /** A Howler winding up its scream (P3E step 5): once, when the wind-up starts. */
  | { kind: 'scream'; gain: number; pan: number }
  /** The ghost stands at a hiding place and is about to open it (P3E step 3): a slow knocking. */
  | { kind: 'knock'; gain: number; pan: number };

/**
 * Turns the latest server cue into timed sound events. Pure: the caller passes the clock, so it is deterministic and testable.
 * - WARNING: a whisper now and every ~1.8 s, nothing else (the ghost is not there yet).
 * - a ghost in earshot: a heartbeat for the nearest one (faster and louder as it nears), and footsteps for each moving ghost
 *   (volume by distance, pan by direction). A stunned or still ghost makes no steps. A stale cue (no news for 1.6 s) is silence.
 */
export class SoundScheduler {
  private nextBeat = 0;
  private nextWhisper = 0;
  private nextKnock = 0;
  private nextStep = new Map<string, number>();
  private screaming = new Set<string>();

  tick(cue: GhostCue | null, receivedAt: number, now: number): SoundEvent[] {
    const out: SoundEvent[] = [];
    if (!cue || now - receivedAt > CUE_STALE_MS) { this.reset(); return out; }
    if (cue.warning) {
      this.nextStep.clear(); this.nextBeat = 0;
      if (this.nextWhisper === 0 || now >= this.nextWhisper) {
        out.push(cue.warnKinds && cue.warnKinds[0] ? { kind: 'whisper', type: cue.warnKinds[0] } : { kind: 'whisper' });
        this.nextWhisper = now + WHISPER_PERIOD_MS;
      }
      return out;
    }
    this.nextWhisper = 0;
    for (const s of cue.sounds) {
      if (s.screaming === true) {
        if (!this.screaming.has(s.id)) { this.screaming.add(s.id); out.push({ kind: 'scream', gain: Math.max(0.5, soundGain(s.band)), pan: panFor(s.dir) }); }
      } else this.screaming.delete(s.id);
    }
    const near = nearest(cue.sounds);
    if (!near) { this.nextBeat = 0; this.nextStep.clear(); return out; }
    const hunting = near.state === 'hunting';
    if (this.nextBeat === 0 || now - this.nextBeat > MAX_CATCHUP_MS) this.nextBeat = now; // first beat now; never replay a backlog
    if (now >= this.nextBeat) {
      out.push({ kind: 'beat', gain: heartbeatGain(near.band, hunting), fast: hunting });
      this.nextBeat += heartbeatPeriodMs(near.band, hunting);
    }
    const checking = cue.sounds.find((x) => x.inspecting === true);
    if (checking) {
      if (this.nextKnock === 0 || now - this.nextKnock > MAX_CATCHUP_MS) this.nextKnock = now;
      if (now >= this.nextKnock) { out.push({ kind: 'knock', gain: Math.max(0.35, soundGain(checking.band)), pan: panFor(checking.dir) }); this.nextKnock += KNOCK_PERIOD_MS; }
    } else this.nextKnock = 0;
    const alive = new Set<string>();
    for (const s of cue.sounds) {
      alive.add(s.id);
      if (!s.moving || s.state === 'stunned') { this.nextStep.delete(s.id); continue; }
      const due = this.nextStep.get(s.id);
      const h = s.state === 'hunting';
      if (due === undefined || now - due > MAX_CATCHUP_MS) this.nextStep.set(s.id, now);
      if (now >= this.nextStep.get(s.id)!) {
        out.push({ kind: 'step', ghost: s.id, type: s.kind, gain: soundGain(s.band), pan: panFor(s.dir), hunting: h });
        this.nextStep.set(s.id, this.nextStep.get(s.id)! + footstepPeriodMs(s.kind, h));
      }
    }
    for (const id of [...this.nextStep.keys()]) if (!alive.has(id)) this.nextStep.delete(id);
    return out;
  }

  reset(): void { this.nextBeat = 0; this.nextWhisper = 0; this.nextKnock = 0; this.nextStep.clear(); this.screaming.clear(); }
}
