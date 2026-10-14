import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, isTeamWiped, nextPlayerLife, nextRoomPhase } from '../src';

describe('room phases', () => {
  it('follows the happy path', () => {
    let p = nextRoomPhase('lobby', 'START');
    p = nextRoomPhase(p, 'BEGIN');
    expect(p).toBe('playing');
    expect(nextRoomPhase(p, 'STAGE_CLEAR')).toBe('stage_complete');
  });
  it('wipe -> review -> retry gives a new attempt', () => {
    const p = nextRoomPhase(nextRoomPhase('playing', 'TEAM_WIPE'), 'REVIEW');
    expect(p).toBe('death_review');
    expect(nextRoomPhase(p, 'RETRY')).toBe('briefing');
  });
  it('rejects illegal transitions', () => {
    expect(() => nextRoomPhase('lobby', 'STAGE_CLEAR')).toThrow(InvalidTransitionError);
    expect(() => nextRoomPhase('team_wiped', 'RETRY')).toThrow(InvalidTransitionError);
  });
});

describe('player life', () => {
  it('downed players can be revived or bleed out; eliminated is terminal', () => {
    expect(nextPlayerLife('alive', 'DOWN')).toBe('downed');
    expect(nextPlayerLife('downed', 'REVIVE')).toBe('alive');
    expect(nextPlayerLife('downed', 'BLEED_OUT')).toBe('eliminated');
    expect(() => nextPlayerLife('eliminated', 'REVIVE')).toThrow(InvalidTransitionError);
  });
  it('team wipe works for 1-4 players', () => {
    expect(isTeamWiped(['eliminated'])).toBe(true);
    expect(isTeamWiped(['eliminated', 'downed'])).toBe(false);
    expect(isTeamWiped(['eliminated', 'eliminated', 'eliminated', 'eliminated'])).toBe(true);
    expect(isTeamWiped([])).toBe(false);
  });
});
