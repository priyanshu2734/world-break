import { CATCH_LIMITS, RANGE_DY, type GhostStatus, type HidingSpotPublic } from '@wb/shared';

/** P3E step 3: pure helpers for hiding, being caught and rescuing. No Phaser here, so they are unit-tested. */

/** The one line shown the first time a warning plays, so the flicker is explained. */
export const WARNING_TIP = 'The lights flicker. Something is near.';
/** Show the tip when a warning is playing and it has not been shown yet. */
export function shouldShowTip(warning: boolean, shown: boolean): boolean { return warning && !shown; }

const dist = (me: { x: number; y: number }, p: { x: number; y: number }) => ({ dx: Math.abs(me.x - p.x), dy: Math.abs(me.y - p.y) });

/** The hiding spot E would use: the nearest one in reach (the server re-checks every rule). */
export function nearestSpot(me: { x: number; y: number }, spots: readonly HidingSpotPublic[]): HidingSpotPublic | null {
  let best: HidingSpotPublic | null = null, bestD = Infinity;
  for (const s of spots) {
    const { dx, dy } = dist(me, s);
    if (dx <= CATCH_LIMITS.hideRange && dy <= RANGE_DY && dx < bestD) { best = s; bestD = dx; }
  }
  return best;
}

/** The caught teammate within rescue reach, if any (the nearest). `where` gives where each player is drawn. */
export function captiveInReach(
  me: { x: number; y: number }, captives: readonly { id: string; progress: number }[], where: ReadonlyMap<string, { x: number; y: number }>,
): { id: string; progress: number } | null {
  let best: { id: string; progress: number } | null = null, bestD = Infinity;
  for (const c of captives) {
    const p = where.get(c.id);
    if (!p) continue;
    const { dx, dy } = dist(me, p);
    if (dx <= CATCH_LIMITS.rescueRange && dy <= RANGE_DY && dx < bestD) { best = c; bestD = dx; }
  }
  return best;
}

export type HideMode = 'free' | 'hidden' | 'caught';
export function modeOf(status: GhostStatus | null | undefined): HideMode {
  if (!status) return 'free';
  if (status.caught) return 'caught';
  return status.hiddenIn !== null ? 'hidden' : 'free';
}

/** Movement and jumping are ignored by the server while hiding or caught; the client sends nothing so its prediction stays in step. */
export function canMove(status: GhostStatus | null | undefined): boolean { return modeOf(status) === 'free'; }

export function spotWord(kind: HidingSpotPublic['kind']): string { return kind === 'closet' ? 'closet' : 'vent'; }

/** The prompt near the bottom of the screen for the current situation ('' = none). */
export function hidePrompt(o: { status: GhostStatus | null | undefined; spot: HidingSpotPublic | null; captive: { id: string; progress: number } | null; captiveName: string }): string {
  const m = modeOf(o.status);
  if (m === 'caught') {
    const s = o.status!.caught!.secondsLeft;
    return `CAUGHT. A teammate can free you by holding E. If nobody does you are released in ${s} s.`;
  }
  if (m === 'hidden') return 'Hiding. Stay quiet. E to come out.';
  if (o.captive) return `Hold E to free ${o.captiveName}${o.captive.progress > 0 ? `  ${Math.round(o.captive.progress * 100)}%` : ''}`;
  if (o.spot) return `E  hide in the ${spotWord(o.spot.kind)}`;
  return '';
}

/** What a key press should do right now. Rescue is a HOLD carried by the input stream, so a tap near a caught teammate does nothing else. */
export type HideKey = 'hide' | 'leave' | 'none';
export function onEPressed(o: { status: GhostStatus | null | undefined; spot: HidingSpotPublic | null; captive: boolean; otherUse: boolean }): HideKey {
  const m = modeOf(o.status);
  if (m === 'caught') return 'none';
  if (m === 'hidden') return 'leave';
  if (o.captive || o.otherUse) return 'none';
  return o.spot ? 'hide' : 'none';
}
