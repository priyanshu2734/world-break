import type { GhostCue, GhostCueSound } from '@wb/shared';

/** P3E step 2: pure maths for the ghost's sound. No WebAudio or Phaser here, so it is unit-tested. */

/** Loudness of a ghost sound by distance bucket (1 near .. 3 far). */
export function soundGain(band: 1 | 2 | 3): number {
  return band === 1 ? 1 : band === 2 ? 0.5 : 0.2;
}

/** Stereo pan by direction bucket: -1 left, 0 ahead (centre), 1 right. Kept short of the extremes so a sound is never one-eared. */
export function panFor(dir: -1 | 0 | 1): number {
  return dir * 0.75;
}

/** Heartbeat period in ms: slow and quiet far away, fast and loud close, faster again while hunted. */
export function heartbeatPeriodMs(band: 1 | 2 | 3, hunting: boolean): number {
  const base = band === 1 ? 480 : band === 2 ? 750 : 1100;
  return hunting ? Math.round(base * 0.8) : base;
}
export function heartbeatGain(band: 1 | 2 | 3, hunting: boolean): number {
  const g = band === 1 ? 0.55 : band === 2 ? 0.32 : 0.16;
  return hunting ? Math.min(0.7, g * 1.25) : g;
}

/** Footstep period in ms by ghost type (a Wisp drifts: light, slow patter; the others are heavier). A hunting ghost steps faster. */
export function footstepPeriodMs(kind: string, hunting: boolean): number {
  const base = kind === 'wisp' ? 620 : kind === 'shade' ? 520 : 700;
  return hunting ? Math.round(base * 0.7) : base;
}

export const WHISPER_PERIOD_MS = 1800;
export const MAX_CATCHUP_MS = 400;
/** A cue older than this many ms is stale (the server re-sends at least once per second). */
export const CUE_STALE_MS = 1600;

/** Short text for the visual cue (for players who cannot hear): where the nearest ghost is, in words. Empty when nothing is near. */
export function cueIndicator(cue: GhostCue | null): string {
  if (!cue) return '';
  if (cue.warning) {
    // P3E step 5: each type warns in its own words (the cue names the type in its warning)
    const k = cue.warnKinds?.[0];
    return k === 'shade' ? 'The air turns cold... keep your light ready.' : k === 'howler' ? 'A distant howl... stay quiet.' : 'Something is coming...';
  }
  if (cue.sounds.some((x) => x.screaming === true)) return 'IT IS ABOUT TO SCREAM: crouch (Shift) and break line of sight!';
  const s = nearest(cue.sounds);
  if (!s) return '';
  if (s.inspecting === true) return s.dir < 0 ? '◀ it is checking a hiding place' : s.dir > 0 ? 'it is checking a hiding place ▶' : 'it is checking a hiding place';
  const dist = s.band === 1 ? 'very close' : s.band === 2 ? 'near' : 'far';
  const side = s.dir < 0 ? '◀ ' : s.dir > 0 ? ' ▶' : '';
  const word = s.state === 'hunting' ? 'HUNTING' : s.state === 'stunned' ? 'stunned' : 'footsteps';
  return s.dir < 0 ? `${side}${word} ${dist}` : `${word} ${dist}${side}`;
}

export function nearest(sounds: readonly GhostCueSound[]): GhostCueSound | null {
  let best: GhostCueSound | null = null;
  for (const s of sounds) if (!best || s.band < best.band) best = s;
  return best;
}
