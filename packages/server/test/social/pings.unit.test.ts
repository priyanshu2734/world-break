import { describe, expect, it } from 'vitest';
import { GHOST_TYPES, PING_KINDS, PING_LABELS, PING_LIMITS, type PingKind, type PingRequest } from '@wb/shared';
import { PingBoard, type PingEnv, type Pinger, type Recipient } from '../../src/social';

const pinger = (o: Partial<Pinger> = {}): Pinger => ({ id: 'p0', name: 'Ann', slot: 0, alive: true, connected: true, room: 'r1', x: 100, y: 200, hidden: false, ...o });
const team = (...o: Partial<Recipient>[]): Recipient[] => [
  { id: 'p0', room: 'r1', connected: true, alive: true },
  { id: 'p1', room: 'r1', connected: true, alive: true },
  { id: 'p2', room: 'r2', connected: true, alive: true },
  { id: 'p3', room: 'r1', connected: true, alive: false },
  ...o.map((x, i) => ({ id: `x${i}`, room: 'r1', connected: true, alive: true, ...x })),
];
const env = (o: Partial<PingEnv> = {}): PingEnv => ({ tick: 100, sees: () => true, seenGhosts: [], hearsGhost: false, recipients: team(), ...o });
const req = (kind: PingKind, x?: number, y?: number): PingRequest => ({ kind, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) });

describe('P6 A PingBoard validation', () => {
  it('accepts a point in the pinger’s own view and refuses one outside it (nothing is queued, nothing recorded)', () => {
    const b = new PingBoard();
    const r = b.place(pinger(), req('key', 500, 60), env({ sees: () => false }));
    expect(r).toEqual({ ok: false, error: 'You can only ping what you can see.' });
    expect(b.drain()).toEqual([]);
    expect(b.active).toHaveLength(0);
    expect(b.place(pinger(), req('key', 500, 60), env({ sees: (x, y) => x === 500 && y === 60 })).ok).toBe(true);
  });
  it('a point kind needs a point', () => {
    const b = new PingBoard();
    for (const k of ['key', 'danger', 'door', 'go'] as const) expect(new PingBoard().place(pinger(), req(k), env()).ok, k).toBe(false);
    expect(b.place(pinger(), req('key', 1, 2), env()).ok).toBe(true);
  });
  it('self kinds ignore the client’s coordinates: the marker is where the server says the pinger stands', () => {
    const b = new PingBoard();
    expect(b.place(pinger(), req('help', 9999, 9999), env({ sees: () => false }))).toEqual({ ok: true, message: 'Pinged.' });
    const m = b.drain().find((d) => d.to === 'p1')!.marker;
    expect([m.x, m.y]).toEqual([100, 200]);
  });
  it('“Hiding here” needs the pinger to be hiding', () => {
    expect(new PingBoard().place(pinger({ hidden: false }), req('hide'), env()).ok).toBe(false);
    expect(new PingBoard().place(pinger({ hidden: true }), req('hide'), env()).ok).toBe(true);
  });
  it('“Ghost near”: the nearest SEEN ghost; else where the pinger stands if a ghost is only heard; else refused', () => {
    const seen = new PingBoard();
    expect(seen.place(pinger(), req('ghost'), env({ seenGhosts: [{ x: 900, y: 10 }, { x: 150, y: 190 }], hearsGhost: true })).ok).toBe(true);
    const m = seen.drain().find((d) => d.to === 'p1')!.marker;
    expect([m.x, m.y]).toEqual([150, 190]);
    const heard = new PingBoard();
    expect(heard.place(pinger(), req('ghost'), env({ hearsGhost: true })).ok).toBe(true);
    const h = heard.drain().find((d) => d.to === 'p1')!.marker;
    expect([h.x, h.y]).toEqual([100, 200]); // never where the unseen ghost is
    expect(new PingBoard().place(pinger(), req('ghost'), env()).ok).toBe(false);
  });
  it('the dead, the disconnected and a pinger outside every room cannot ping', () => {
    expect(new PingBoard().place(pinger({ alive: false }), req('help'), env()).ok).toBe(false);
    expect(new PingBoard().place(pinger({ connected: false }), req('help'), env()).ok).toBe(false);
    expect(new PingBoard().place(pinger({ room: null }), req('help'), env()).ok).toBe(false);
  });
});

describe('P6 A PingBoard limits and expiry', () => {
  it('a cooldown separates two accepted pings of one player, and another player is not held up by it', () => {
    const b = new PingBoard();
    expect(b.place(pinger(), req('help'), env({ tick: 100 })).ok).toBe(true);
    expect(b.place(pinger(), req('help'), env({ tick: 100 + PING_LIMITS.cooldownTicks - 1 })).ok).toBe(false);
    expect(b.place(pinger({ id: 'p1', name: 'Bo', slot: 1 }), req('help'), env({ tick: 101 })).ok).toBe(true);
    expect(b.place(pinger(), req('help'), env({ tick: 100 + PING_LIMITS.cooldownTicks })).ok).toBe(true);
  });
  it('a flood of requests, accepted or not, is cut off by the attempt window', () => {
    const b = new PingBoard();
    let refusedSlow = 0;
    for (let i = 0; i < 40; i++) { const r = b.place(pinger(), req('key', 1, 1), env({ tick: 100, sees: () => false })); if (!r.ok && r.error === 'Slow down.') refusedSlow++; }
    expect(refusedSlow).toBe(40 - PING_LIMITS.attemptMax);
    expect(b.place(pinger(), req('help'), env({ tick: 100 + PING_LIMITS.attemptWindowTicks })).ok).toBe(true); // the window passes
  });
  it('markers expire after the ttl and are gone from the board', () => {
    const b = new PingBoard();
    b.place(pinger(), req('help'), env({ tick: 100 }));
    expect(b.active).toHaveLength(1);
    b.expire(100 + PING_LIMITS.ttlTicks - 1); expect(b.active).toHaveLength(1);
    b.expire(100 + PING_LIMITS.ttlTicks); expect(b.active).toHaveLength(0);
  });
  it('at most perPlayer live markers per player (the oldest goes) and perTeam in all', () => {
    const b = new PingBoard();
    let t = 100;
    for (let i = 0; i < 6; i++) { expect(b.place(pinger(), req('go', i, i), env({ tick: t })).ok).toBe(true); t += PING_LIMITS.cooldownTicks; if (t - 100 >= PING_LIMITS.ttlTicks) break; }
    expect(b.active.filter((a) => a.owner === 'p0').length).toBeLessThanOrEqual(PING_LIMITS.perPlayer);
    const c = new PingBoard();
    for (let p = 0; p < 8; p++) for (let i = 0; i < 3; i++) c.place(pinger({ id: `q${p}`, name: `Q${p}` }), req('go', i, i), env({ tick: 100 + i * PING_LIMITS.cooldownTicks }));
    expect(c.active.length).toBeLessThanOrEqual(PING_LIMITS.perTeam);
  });
  it('the delivery queue is bounded', () => {
    const b = new PingBoard();
    for (let p = 0; p < 60; p++) b.place(pinger({ id: `q${p}` }), req('help'), env({ tick: 100, recipients: team() }));
    expect(b.drain().length).toBeLessThanOrEqual(64);
  });
});

describe('P6 A who is told what', () => {
  it('a teammate in the same room gets the position; one in another room gets the room and the name, never a position', () => {
    const b = new PingBoard();
    b.place(pinger(), req('danger', 321, 123), env());
    const out = b.drain();
    const same = out.find((d) => d.to === 'p1')!.marker, far = out.find((d) => d.to === 'p2')!.marker;
    expect([same.x, same.y]).toEqual([321, 123]);
    expect(far.x).toBeUndefined(); expect(far.y).toBeUndefined();
    expect(JSON.stringify(far)).not.toMatch(/321|123/);
    expect([far.room, far.name, far.kind]).toEqual(['r1', 'Ann', 'danger']);
    expect(out.find((d) => d.to === 'p0')).toBeDefined(); // the pinger sees their own marker
  });
  it('the dead and the disconnected are sent nothing (a spectator keeps only “ghost here”)', () => {
    const b = new PingBoard();
    b.place(pinger(), req('help'), env({ recipients: team({ connected: false }) }));
    const to = b.drain().map((d) => d.to);
    expect(to).not.toContain('p3'); expect(to).not.toContain('x0');
    expect(to.sort()).toEqual(['p0', 'p1', 'p2']);
  });
  it('no marker ever names a ghost type, whatever the kind, and a label carries no information', () => {
    for (const k of PING_KINDS) {
      const b = new PingBoard();
      b.place(pinger({ hidden: true }), req(k, 5, 5), env({ seenGhosts: [{ x: 5, y: 5 }], hearsGhost: true }));
      const raw = JSON.stringify(b.drain());
      for (const g of GHOST_TYPES) expect(raw, `${k} leaks ${g}`).not.toContain(g);
      expect(PING_LABELS[k]).not.toMatch(/\d/);
    }
  });
  it('clear() forgets markers, queue, cooldowns and attempt counts', () => {
    const b = new PingBoard();
    b.place(pinger(), req('help'), env({ tick: 100 }));
    b.clear();
    expect(b.active).toHaveLength(0); expect(b.drain()).toEqual([]);
    expect(b.place(pinger(), req('help'), env({ tick: 101 })).ok).toBe(true);
  });
});
