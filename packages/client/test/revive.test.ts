import { describe, expect, it } from 'vitest';
import type { DeathState } from '@wb/shared';
import { REVIVE_REACH, bodyInReach, carriesCell, isBody, lifeMark, reviveLine, type TeamLife } from '../src/ui/death/reviveLogic';

const team: TeamLife[] = [{ id: 'a', name: 'Ann', life: 'alive' }, { id: 'b', name: 'Bo', life: 'downed' }, { id: 'c', name: 'Cy', life: 'eliminated' }, { id: 'd', name: 'Di' }];
const where = new Map([['a', { x: 500, y: 680 }], ['b', { x: 540, y: 680 }], ['c', { x: 520, y: 680 }], ['d', { x: 510, y: 680 }]]);
const ds = (o: Partial<DeathState> = {}): DeathState => ({ tick: 1, life: 'alive', following: null, watchable: [], pingReadyIn: 0, reviveLeft: 0, ...o });

describe('P4 step 3: the revive prompt (client)', () => {
  it('only a downed teammate is a body; the living, the eliminated and a stage without life data are not', () => {
    expect(team.map(isBody)).toEqual([false, true, false, false]);
  });
  it('the Revive Cell is recognised among carried items', () => {
    expect(carriesCell([{ kind: 'fuse' }, { kind: 'revive_cell' }])).toBe(true);
    expect(carriesCell([{ kind: 'fuse' }])).toBe(false);
    expect(carriesCell([])).toBe(false);
  });
  it('the body in reach is the nearest one inside the same reach as the server (70 px across, 60 px up or down); none when far, high, or unknown', () => {
    const me = { x: 500, y: 680 };
    expect(bodyInReach(me, team, where)?.id).toBe('b');
    expect(bodyInReach({ x: 540 + REVIVE_REACH.range + 10, y: 680 }, team, where)).toBeNull();
    expect(bodyInReach({ x: 540, y: 680 - REVIVE_REACH.dy - 5 }, team, where)).toBeNull();
    expect(bodyInReach(me, team, new Map())).toBeNull(); // a body in another room is not in `where`
    expect(bodyInReach(null, team, where)).toBeNull();
    expect(bodyInReach(me, undefined, where)).toBeNull();
    const two: TeamLife[] = [{ id: 'b', name: 'Bo', life: 'downed' }, { id: 'e', name: 'Ed', life: 'downed' }];
    expect(bodyInReach(me, two, new Map([['b', { x: 560, y: 680 }], ['e', { x: 520, y: 680 }]]))?.id).toBe('e');
  });
  it('the line: a prompt for a carrier next to a body, a bar while holding, what a body is told, and nothing otherwise', () => {
    const near = team[1]!;
    expect(reviveLine(ds(), near, true)).toEqual({ text: 'Hold E to bring Bo back', progress: null });
    expect(reviveLine(ds(), near, false)).toEqual({ text: '', progress: null }); // no cell: no prompt
    expect(reviveLine(ds(), null, true)).toEqual({ text: '', progress: null });
    expect(reviveLine(null, near, true).text).toBe('Hold E to bring Bo back'); // a stage without death data
    expect(reviveLine(ds({ reviving: { id: 'b', name: 'Bo', progress: 0.5 } }), near, true)).toEqual({ text: 'Reviving Bo… 50%  (keep holding E)', progress: 0.5 });
    expect(reviveLine(ds({ life: 'downed', beingRevived: 0.25 }), null, false)).toEqual({ text: 'A teammate is bringing you back… 25%', progress: 0.25 });
    expect(reviveLine(ds({ life: 'downed', beingRevived: null }), near, true)).toEqual({ text: '', progress: null }); // a body never gets the carrier's prompt
    expect(reviveLine(ds({ life: 'eliminated' }), near, true)).toEqual({ text: '', progress: null });
    expect(reviveLine(ds({ reviving: { id: 'b', name: 'Bo', progress: 7 } }), null, false).text).toContain('100%'); // clamped
  });
  it('the marks in the team list', () => {
    expect(lifeMark('downed')).toBe('✝ body');
    expect(lifeMark('eliminated')).toBe('✝ out');
    expect(lifeMark('alive')).toBe('');
    expect(lifeMark(undefined)).toBe('');
  });
});
