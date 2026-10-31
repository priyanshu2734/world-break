import { describe, expect, it } from 'vitest';
import { SPECTATE, stepSpectatorCam, type DeathState, type SpectatorCam } from '@wb/shared';
import { FLY_HINT, focusFor, intentFromKeys, reconcileCam, roomText, shouldSendIntent, whereLines } from '../src/ui/death/flyLogic';

const ds = (o: Partial<DeathState> = {}): DeathState => ({ tick: 1, life: 'downed', following: { id: 'b', name: 'Bea' }, watchable: [{ id: 'b', name: 'Bea' }], pingReadyIn: 0, reviveLeft: 0, ...o });
const cam = (o: Partial<SpectatorCam> = {}): SpectatorCam => ({ room: 'r0', x: 100, y: 200, free: true, ...o });

describe('P4 step 6: the free-fly camera (client)', () => {
  it('the keys held become an intent of -1, 0 or 1 per axis; opposite keys cancel; up is negative', () => {
    expect(intentFromKeys({ left: false, right: false, up: false, down: false })).toEqual({ x: 0, y: 0 });
    expect(intentFromKeys({ left: true, right: false, up: true, down: false })).toEqual({ x: -1, y: -1 });
    expect(intentFromKeys({ left: false, right: true, up: false, down: true })).toEqual({ x: 1, y: 1 });
    expect(intentFromKeys({ left: true, right: true, up: true, down: true })).toEqual({ x: 0, y: 0 });
  });
  it('an intent is sent when it changes and every 250 ms while held; never while nothing is held; a held key is not spammed', () => {
    const none = { x: 0, y: 0 } as const, right = { x: 1, y: 0 } as const;
    expect(shouldSendIntent(null, none, 0)).toBe(false);
    expect(shouldSendIntent(null, right, 0)).toBe(true);
    expect(shouldSendIntent({ move: right, atMs: 0 }, right, 100)).toBe(false);
    expect(shouldSendIntent({ move: right, atMs: 0 }, right, 250)).toBe(true);
    expect(shouldSendIntent({ move: right, atMs: 0 }, none, 10)).toBe(true); // let go: tell the server at once
    expect(shouldSendIntent({ move: none, atMs: 0 }, none, 99_999)).toBe(false);
    // the keepalive is well inside the server's time to live (10 ticks = 500 ms)
    expect(250).toBeLessThan((SPECTATE.camIntentTtlTicks * 1000) / 20);
  });
  it('the predicted camera uses the server’s own step: same speed, same bounds, same diagonal rule', () => {
    const b = { w: 1000, h: 700 };
    const one = stepSpectatorCam(cam({ x: 500, y: 300 }), { x: 1, y: 0 }, 0.5, b);
    expect(one.x).toBeCloseTo(500 + SPECTATE.camSpeed * 0.5, 6);
    const diag = stepSpectatorCam(cam({ x: 500, y: 300 }), { x: 1, y: 1 }, 0.5, b);
    expect(Math.hypot(diag.x - 500, diag.y - 300)).toBeCloseTo(SPECTATE.camSpeed * 0.5, 6);
    expect(stepSpectatorCam(cam({ x: 990, y: 5 }), { x: 1, y: -1 }, 5, b)).toMatchObject({ x: 1000, y: 0 });
    expect(stepSpectatorCam(cam({ free: false }), { x: 0, y: 0 }, 1, b).free).toBe(false);
    expect(stepSpectatorCam(cam({ free: false }), { x: 0, y: 1 }, 0.01, b).free).toBe(true);
  });
  it('the client’s camera snaps to the server’s on a room change or a big drift, and keeps its own otherwise', () => {
    const mine = cam({ x: 300, y: 300 });
    expect(reconcileCam(mine, undefined)).toBe(mine);
    expect(reconcileCam(null, cam({ x: 5 }))).toEqual(cam({ x: 5 }));
    expect(reconcileCam(mine, cam({ x: 320, y: 300 }))).toBe(mine); // a little behind: keep the smooth one
    expect(reconcileCam(mine, cam({ x: 900, y: 300 }))).toEqual(cam({ x: 900, y: 300 })); // far apart: the server wins
    expect(reconcileCam(mine, cam({ room: 'r1', x: 300, y: 300 }))).toEqual(cam({ room: 'r1', x: 300, y: 300 }));
    expect(reconcileCam(mine, cam({ x: 310, free: false }))).toEqual(cam({ x: 310, free: false })); // the server says follow: follow
  });
  it('what the camera looks at: where it flies, else the teammate being followed (from the snapshot), else the server’s camera, else nothing', () => {
    const players = [{ id: 'b', roomId: 'r2', x: 800, y: 680 }];
    expect(focusFor({ death: ds(), players, cam: cam({ x: 5, y: 6 }) })).toEqual({ room: 'r0', x: 5, y: 6, free: true });
    expect(focusFor({ death: ds(), players, cam: cam({ free: false }) })).toEqual({ room: 'r2', x: 800, y: 680, free: false });
    expect(focusFor({ death: ds(), players, cam: null })).toEqual({ room: 'r2', x: 800, y: 680, free: false });
    expect(focusFor({ death: ds({ following: null }), players, cam: cam({ free: false }) })).toEqual({ room: 'r0', x: 100, y: 200, free: false });
    expect(focusFor({ death: ds({ following: null }), players, cam: null })).toBeNull();
  });
  it('the room text, and where everybody is (teammates and ghosts only; the ones in view marked; bounded)', () => {
    expect(roomText(['a', 'b', 'c'], 'b')).toBe('Room 2 of 3');
    expect(roomText(['a'], 'a')).toBe('');
    expect(roomText(undefined, 'a')).toBe('');
    expect(roomText(['a', 'b'], 'zzz')).toBe('');
    const lines = whereLines({
      selfId: 'me', rooms: ['r0', 'r1', 'r2'], camRoom: 'r1',
      players: [{ id: 'me', name: 'Me', roomId: 'r0' }, { id: 'b', name: 'Bea', roomId: 'r1' }, { id: 'c', name: 'Cy', roomId: 'r2' }],
      ghosts: [{ id: 'g0', kind: 'wisp', room: 'r2' }],
    });
    expect(lines).toEqual(['Bea · room 2 (in view)', 'Cy · room 3', 'Wisp · room 3']);
    expect(whereLines({ selfId: 'me', rooms: ['r0'], camRoom: 'r0', players: [{ id: 'b', name: 'Bea', roomId: 'r0' }], ghosts: [] })).toEqual(['Bea · here']);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, roomId: 'r0' }));
    expect(whereLines({ selfId: 'x', rooms: ['r0', 'r1'], camRoom: 'r0', players: many, ghosts: [] })).toHaveLength(8);
    // nothing but teammates and ghosts: no item, door, code or objective word can appear
    expect(lines.join(' ')).not.toMatch(/key|door|safe|code|exit|item/i);
  });
  it('the hint names every key', () => {
    for (const w of ['fly', 'Q E room', 'Z X teammate', 'F follow', 'G ghost here']) expect(FLY_HINT).toContain(w);
  });
});
