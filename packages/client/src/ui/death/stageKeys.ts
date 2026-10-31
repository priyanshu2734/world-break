import type { RoomPhase } from '@wb/shared';

/** What the N key does between stages: the host starts the next stage after a clear, or tries the same stage again after a wipe. */
export type StageKeyAction = 'next' | 'retry' | null;

/**
 * P4 step 6: the N key, as a pure function. The scene reads the key ONCE per frame (`JustDown` consumes the press) into `nPressed` and asks this what to do, so the two
 * uses of the key (next stage, retry) can never starve each other. Only the host acts; the server decides again and may refuse.
 */
export function stageKeyAction(o: { nPressed: boolean; isHost: boolean; phase: RoomPhase | undefined }): StageKeyAction {
  if (!o.nPressed || !o.isHost) return null;
  if (o.phase === 'stage_complete') return 'next';
  if (o.phase === 'death_review') return 'retry';
  return null;
}
