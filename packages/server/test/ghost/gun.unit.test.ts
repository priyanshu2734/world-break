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
  canStun = true;
  stuns: string[] = [];
  noises = 0;
  logs: string[] = [];
  said: string[] = [];
  shooter(id: string) { return id === 'a' ? { room: 'r0', x: 100, y: 680, aim: this.aim, name: 'A', connected: true } : undefined; }
  spend(): boolean { if (!this.gun) return false; this.gun = false; return true; }
  carries(): boolean { return this.gun; }
  trace(_room: string, from: Pt, to: Pt, radius: number): { hit: string | null; blocked: boolean } {
    if (this.wallAtX !== null && from.x < this.wallAtX && to.x >= this.wallAtX) return { hit: null, blocked: true };
    const g = this.ghostAt;
    if (g && Math.abs(g.y - to.y) <= radius && g.x >= Math.min(from.x, to.x) - radius && g.x <= Math.max(from.x, to.x) + radius) return { hit: 'g0', blocked: false };
    return { hit: null, blocked: false };
  }
  stun(ghostId: string): boolean { this.stuns.push(ghostId); return this.canStun; }
  noise(): void { this.noises++; }
  say(text: string): void { this.said.push(text); }
  log(_by: string, phase: string): void { this.logs.push(phase); }
  playerIds(): string[] { return ['a', 'b']; }
  sees(viewer: string): boolean { return viewer === 'b'; }
}
const run = (h: FakeGunHost, g: PulseGun, n = 30) => { for (let i = 0; i < n; i++) { h.tick++; g.step(); } };

describe('PulseGun (unit)', () => {
  it('a hit stuns once, spends the charge, makes a noise, tells the viewers', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    expect(g.fire('a').ok).toBe(true);
    expect(h.noises).toBe(1);
    expect(g.drainDeliveries()[0]!.to.sort()).toEqual(['a', 'b']);
    run(h, g);
    expect(h.stuns).toEqual(['g0']);
    expect(h.logs).toContain('stunned');
    expect(g.flying).toBe(0);
    expect(g.fire('a')).toMatchObject({ ok: false });
  });
  it('refuses: unknown player, no gun, no aim', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    expect(g.fire('zzz').ok).toBe(false);
    h.aim = null; expect(g.fire('a')).toMatchObject({ ok: false, error: expect.stringMatching(/Aim/) });
    expect(h.gun).toBe(true); // a refusal costs nothing
    h.aim = 0; h.gun = false; expect(g.fire('a')).toMatchObject({ ok: false });
  });
  it('a wall stops the bolt before the ghost', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.wallAtX = 250; g.fire('a'); run(h, g);
    expect(h.stuns).toEqual([]); expect(h.logs).toContain('wall');
  });
  it('range: a ghost beyond rangePx is never hit, and the bolt ends', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.ghostAt = { x: 100 + GUN_LIMITS.rangePx + 200, y: 652 };
    g.fire('a'); run(h, g);
    expect(h.stuns).toEqual([]); expect(h.logs).toContain('miss'); expect(g.flying).toBe(0);
  });
  it('a ghost that cannot be stunned absorbs the pulse (no effect, charge gone)', () => {
    const h = new FakeGunHost(), g = new PulseGun(h);
    h.canStun = false; g.fire('a'); run(h, g);
    expect(h.logs).toContain('absorbed'); expect(h.logs).not.toContain('stunned');
  });
});

describe('the ghost cannot be stunned in WARNING or while absent', () => {
  it('stun() refuses a dormant ghost', () => {
    const r = new Room('WARN', 3, 9, { escape: true, ghost: true, startStage: 2 });
    r.join('p0', 'P0');
    expect(r.start('p0').ok).toBe(true);
    for (let i = 0; i < 20 && r.phase !== 'playing'; i++) r.tick();
    const g = r.ghostSystem!;
    expect(g.snapshotActors()[0]!.state).toBe('dormant');
    expect(g.stun('g0', 'p0')).toBe(false);
    expect(g.snapshotActors()[0]!.state).toBe('dormant');
  });
});
