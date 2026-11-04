import type { DraftPublic } from '@wb/shared';

/** P3F step 4: the draft screen's logic (no Phaser, so it is unit-tested). */
export interface DraftLine { index: number; key: string; title: string; text: string; tradeoff: string | null; votes: number; mine: boolean; picked: boolean }

/** The lines of the screen: one per offered upgrade, with the team's votes and (when known on this side) this player's own vote. */
export function draftLines(d: DraftPublic, myVote: number | null): DraftLine[] {
  return d.options.map((o, index) => ({
    index, key: String(index + 1), title: o.name, text: o.text, tradeoff: o.tradeoff ?? null, votes: o.votes, mine: myVote === index, picked: d.picked === o.id,
  }));
}

export function draftHeader(d: DraftPublic, isHost: boolean): string {
  if (d.picked) return `UPGRADE TAKEN${isHost ? '   N  next stage' : '   waiting for the host'}`;
  return `CHOOSE AN UPGRADE (kept for the run)   press 1, 2 or 3${isHost ? '   N  go on (settles the vote)' : ''}`;
}

/** The option a key press means (`1`..`3`), or null. */
export function voteFromKeys(pressed: readonly boolean[], offered: number): number | null {
  const i = pressed.findIndex((p) => p);
  return i >= 0 && i < offered ? i : null;
}
