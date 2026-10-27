import { describe, expect, it } from 'vitest';
import { GUN_LIMITS } from '@wb/shared';
import { PulseGun, type GunHost } from '../../src/ghost';
import { Room } from '../../src/room';

type Pt = { x: number; y: number };
class FakeGunHost implements GunHost {
  tick = 0;
  aim: number | null = 0;
  gun = true;
  ghostAt: Pt | null = { x: 400, y: 652 };
  wallAtX: number | null = null;
  canHit = true;
  cooldownTicks = 600;
  hits: string[] = [];
  noises = 0;
  logs: string[] = [];
  said: string[] = [];
  shooter(id: string) { return id === 'a' ? { room: 'r0', x: 100, y: 680, aim: this.aim, name: 'A', connected: true } : undefined; }
  carries(): boolean { return this.gun; }
  trace(_room: string, from: Pt, to: Pt, radius: number): { hit: string | null; blocked: boolean } {
    if (this.wallAtX !== null && from.x < this.wallAtX && to.x >= this.wallAtX) return { hit: null, blocked: true };
    const g = this.ghostAt;
    if (g && Math.abs(g.y - to.y) <= radius && g.x >= Math.min(from.x, to.x) - radius && g.x <= Math.max(from.x, to.x) + radius) return { hit: 'g0', blocked: false };
    return { hit: null, blocked: false };
  }
  destroy(ghostId: string): boolean { this.hits.push(ghostId); return this.canHit; }
  noise(): void { this.noises++; }
  say(text: string): void { this.said.push(text); }
  log(_by: string, phase: string): void { this.logs.push(phase); }
  playerIds(): string[] { return ['a', 'b']; }
  sees(viewer: string): boolean { return viewer === 'b'; }
}
const run = (h: FakeGunHost, g: PulseGun, n = 30) => { for (let i = 0; i < n; i++) { h.tick++; g.step(); } };

describe('PulseGun v2 (unit)', () => {
  it('a hit destroys the ghost, makes a noise, tells the viewers, and the gun is KEPT', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    expect(g.fire('a').ok).toBe(true);
    expect(h.noises).toBe(1);
    expect(g.drainDeliveries()[0]!.to.sort()).toEqual(['a', 'b']);
    run(h, g);
    expect(h.hits).toEqual(['g0']);
    expect(h.logs).toContain('destroyed');
    expect(g.flying).toBe(0);
    expect(h.gun).toBe(true);
  });
  it('the gun is reusable but recharges: refused during the cooldown, ready exactly when it ends', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    expect(g.fire('a').ok).toBe(true);
    run(h, g, 5);
    const r = g.fire('a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/recharging/);
    expect(g.cooldownLeft()).toBe(h.cooldownTicks - 5);
    h.tick = h.cooldownTicks - 1;
    expect(g.fire('a').ok).toBe(false);
    h.tick = h.cooldownTicks;
    expect(g.cooldownLeft()).toBe(0);
    expect(g.fire('a').ok).toBe(true);
    expect(g.cooldownLeft()).toBe(h.cooldownTicks);
  });
  it('refuses: unknown player, no gun, no aim; a refusal costs no cooldown', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    expect(g.fire('zzz').ok).toBe(false);
    h.aim = null; expect(g.fire('a')).toMatchObject({ ok: false, error: expect.stringMatching(/Aim/) });
    h.aim = 0; h.gun = false; expect(g.fire('a')).toMatchObject({ ok: false });
    expect(g.cooldownLeft()).toBe(0);
    h.gun = true;
    expect(g.fire('a').ok).toBe(true);
  });
  it('a wall stops the bolt before the ghost', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.wallAtX = 250; g.fire('a'); run(h, g);
    expect(h.hits).toEqual([]); expect(h.logs).toContain('wall');
  });
  it('range: a ghost beyond rangePx is never hit, and the bolt ends', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.ghostAt = { x: 100 + GUN_LIMITS.rangePx + 200, y: 652 };
    g.fire('a'); run(h, g);
    expect(h.hits).toEqual([]); expect(h.logs).toContain('miss'); expect(g.flying).toBe(0);
  });
  it('a ghost that cannot be hit now (not roaming or hunting) absorbs the pulse: no effect, the cooldown still runs', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.canHit = false; g.fire('a'); run(h, g);
    expect(h.logs).toContain('absorbed'); expect(h.logs).not.toContain('destroyed');
    expect(g.cooldownLeft()).toBeGreaterThan(0);
  });
});

describe('the ghost cannot be destroyed in WARNING or while absent', () => {
  it('destroy() refuses a dormant ghost, and a ghost already gone', () => {
    const r = new Room('WARN', 3, 9, { escape: true, ghost: true, startStage: 2 });
    r.join('p0', 'P0');
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 20 && r.phase !== 'playing'; i++) r.tick();
    const g = r.ghostSystem!;
    expect(g.snapshotActors()[0]!.state).toBe('dormant');
    expect(g.destroy('g0', 'p0')).toBe(false);
    expect(g.snapshotActors()[0]!.state).toBe('dormant');
    g.placeForTest('g0', { room: r.gameSnapshot()!.players[0]!.roomId!, x: 900, y: 600, state: 'roaming' });
    expect(g.destroy('g0', 'p0')).toBe(true);
    expect(g.snapshotActors()[0]!.state).toBe('respawn');
    expect(g.destroy('g0', 'p0')).toBe(false); // already gone
  });
});
