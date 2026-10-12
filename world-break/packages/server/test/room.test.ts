import { describe, expect, it } from 'vitest';
import { Room, RoomManager } from '../src/room';

const mk = (n: number) => {
  const r = new Room('ABCD');
  for (let i = 0; i < n; i++) expect(r.join(`p${i}`, `P${i}`).ok).toBe(true);
  return r;
};

describe('Room', () => {
  it('a solo player can start without other slots filled', () => {
    const r = mk(1);
    expect(r.start('p0').ok).toBe(true);
    expect(r.phase).toBe('briefing');
  });
  it('supports 2, 3 and 4 players and rejects a 5th', () => {
    for (const n of [2, 3, 4]) expect(mk(n).size).toBe(n);
    expect(mk(4).join('p9', 'X')).toEqual({ ok: false, error: 'Room is full' });
  });
  it('requires non-host players to ready before start', () => {
    const r = mk(3);
    expect(r.start('p0').ok).toBe(false);
    r.setReady('p1', true); r.setReady('p2', true);
    expect(r.start('p0').ok).toBe(true);
  });
  it('only the host can start or change difficulty', () => {
    const r = mk(2);
    expect(r.start('p1').ok).toBe(false);
    expect(r.setDifficulty('p1', 'easy').ok).toBe(false);
  });
  it('rejects locked difficulties and accepts them once progression allows', () => {
    const r = mk(1);
    expect(r.setDifficulty('p0', 'intermediate')).toEqual({ ok: false, error: 'intermediate is locked' });
    r.highestStage = 10;
    expect(r.setDifficulty('p0', 'intermediate').ok).toBe(true);
    expect(r.setDifficulty('p0', 'hardcore').ok).toBe(false);
  });
  it('migrates host when the host leaves', () => {
    const r = mk(2);
    r.leave('p0');
    expect(r.hostId).toBe('p1');
  });
  it('snapshot exposes only public fields', () => {
    const snap = mk(2).snapshot();
    expect(Object.keys(snap.players[0]!).sort()).toEqual(['id', 'isHost', 'name', 'ready']);
  });
});

describe('RoomManager', () => {
  it('creates unique valid codes', () => {
    const m = new RoomManager();
    const codes = new Set(Array.from({ length: 50 }, () => m.create().code));
    expect(codes.size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
});
