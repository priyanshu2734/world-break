import { describe, expect, it } from 'vitest';
import type { RoomPhase } from '@wb/shared';
import { stageKeyAction } from '../src/ui/death/stageKeys';

const PHASES: RoomPhase[] = ['lobby', 'briefing', 'playing', 'stage_complete', 'team_wiped', 'death_review'];

describe('P4 step 6: the N key between stages', () => {
  it('the host starts the next stage after a clear and retries after a wipe', () => {
    expect(stageKeyAction({ nPressed: true, isHost: true, phase: 'stage_complete' })).toBe('next');
    expect(stageKeyAction({ nPressed: true, isHost: true, phase: 'death_review' })).toBe('retry');
  });
  it('nothing happens without a press, for a player who is not the host, or in any other phase', () => {
    for (const phase of PHASES) expect(stageKeyAction({ nPressed: false, isHost: true, phase })).toBeNull();
    for (const phase of PHASES) expect(stageKeyAction({ nPressed: true, isHost: false, phase })).toBeNull();
    for (const phase of PHASES.filter((p) => p !== 'stage_complete' && p !== 'death_review')) expect(stageKeyAction({ nPressed: true, isHost: true, phase })).toBeNull();
    expect(stageKeyAction({ nPressed: true, isHost: true, phase: undefined })).toBeNull();
  });
  it('one press gives exactly one action (the regression: a key consumed by the first check starved the second)', () => {
    // the scene reads the key once; whatever the phase, one press yields at most one of the two actions
    for (const phase of PHASES) {
      const a = stageKeyAction({ nPressed: true, isHost: true, phase });
      expect(['next', 'retry', null]).toContain(a);
    }
    const results = PHASES.map((phase) => stageKeyAction({ nPressed: true, isHost: true, phase }));
    expect(results.filter((r) => r === 'next')).toHaveLength(1);
    expect(results.filter((r) => r === 'retry')).toHaveLength(1);
  });
});
