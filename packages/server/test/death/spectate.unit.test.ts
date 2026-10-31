import { describe, expect, it } from 'vitest';
import { SERVER_TICK_HZ, SPECTATE, GhostPingSchema, DeathStateSchema, SpectateFollowSchema, SpectateMoveSchema, SpectateRoomSchema, stepSpectatorCam, type GhostPublic } from '@wb/shared';
import { SpectateSystem, type SpectateHost } from '../../src/death';

class FakeHost implements SpectateHost {
  tick = 1000;
  players: { id: string; name: string; connected: boolean; dead: boolean }[] = [];
  roster() { return this.players.map(({ id, name, connected }) => ({ id, name, connected })); }
  isDead(id: string): boolean { return this.players.find((p) => p.id === id)?.dead === true; }
  isAlive(id: string): boolean { const p = this.players.find((q) => q.id === id); return !!p && !p.dead; }
  set(id: string, o: Partial<{ connected: boolean; dead: boolean }>): void { Object.assign(this.players.find((p) => p.id === id)!, o); }
  /** P4 step 6: three rooms of different sizes, and where each player is. */
  roomIds = ['r0', 'r1', 'r2'];
  sizes: Record<string, { w: number; h: number }> = { r0: { w: 1920, h: 720 }, r1: { w: 2560, h: 720 }, r2: { w: 1920, h: 720 } };
  pos = new Map<string, { room: string; x: number; y: number }>();
  rooms(): string[] { return this.roomIds; }
  bounds(room: string): { w: number; h: number } | null { return this.sizes[room] ?? null; }
  positionOf(id: string): { room: string; x: number; y: number } | null { return this.pos.get(id) ?? null; }
}
const team = (ids: string[]): FakeHost => { const h = new FakeHost(); h.players = ids.map((id) => ({ id, name: id.toUpperCase(), connected: true, dead: false })); return h; };
const ghost = (o: Partial<GhostPublic> = {}): GhostPublic => ({ id: 'g0', kind: 'wraith' as GhostPublic['kind'], x: 812.4, y: 650.6, angle: 0, state: 'hunting', room: 'r0', ...o });

describe('P4 spectating: whom a dead player watches', () => {
  it('starts on the next living teammate after themselves in team order, and never on themselves or another dead player', () => {
    const h = team(['a', 'b', 'c', 'd']);
    const s = new SpectateSystem(h);
    h.set('b', { dead: true }); h.set('c', { dead: true });
    s.step();
    expect(s.targetOf('b')).toBe('d'); // c is dead too: skipped
    expect(s.targetOf('c')).toBe('d');
    expect(s.targetOf('a')).toBeNull(); // the living watch nobody
    expect(s.watchable('b').map((w) => w.id)).toEqual(['a', 'd']);
  });
  it('follow by id, next and prev (in team order, wrapping); refuses the dead, itself, strangers and the living caller', () => {
    const h = team(['a', 'b', 'c', 'd']);
    const s = new SpectateSystem(h);
    h.set('d', { dead: true }); s.step();
    expect(s.targetOf('d')).toBe('a'); // wraps past the end
    expect(s.request('d', 'c')).toEqual({ ok: true, message: 'Watching C.' });
    expect(s.targetOf('d')).toBe('c');
    s.request('d', 'next'); expect(s.targetOf('d')).toBe('a');
    s.request('d', 'prev'); expect(s.targetOf('d')).toBe('c');
    s.request('d', 'prev'); expect(s.targetOf('d')).toBe('b');
    expect(s.request('d', 'd')).toEqual({ ok: false, error: 'You cannot watch that player.' });
    expect(s.request('d', 'zzz')).toEqual({ ok: false, error: 'You cannot watch that player.' });
    h.set('a', { dead: true });
    expect(s.request('d', 'a')).toEqual({ ok: false, error: 'You cannot watch that player.' });
    expect(s.request('b', 'c')).toEqual({ ok: false, error: 'You are not dead.' });
  });
  it('the camera moves on when the target dies, and when the target disconnects (the next living teammate after it)', () => {
    const h = team(['a', 'b', 'c', 'd']);
    const s = new SpectateSystem(h);
    h.set('a', { dead: true }); s.step();
    expect(s.targetOf('a')).toBe('b');
    h.set('b', { dead: true }); s.step();
    expect(s.targetOf('a')).toBe('c');
    h.set('c', { connected: false }); s.step();
    expect(s.targetOf('a')).toBe('d');
    h.set('c', { connected: true }); s.step();
    expect(s.targetOf('a')).toBe('d'); // a valid target is never taken away
  });
  it('nobody left to watch: no target, and next/prev say so; a living teammate who returns is picked up', () => {
    const h = team(['a', 'b']);
    const s = new SpectateSystem(h);
    h.set('a', { dead: true }); h.set('b', { dead: true }); s.step();
    expect(s.targetOf('a')).toBeNull();
    expect(s.request('a', 'next')).toEqual({ ok: false, error: 'Nobody is left to watch.' });
    h.set('b', { dead: false }); s.step();   // revived
    expect(s.targetOf('a')).toBe('b');
    expect(s.targetOf('b')).toBeNull();       // the revived are not spectators
  });
  it('is deterministic: two systems given the same calls agree', () => {
    const run = () => {
      const h = team(['a', 'b', 'c', 'd']); const s = new SpectateSystem(h); const out: (string | null)[] = [];
      h.set('a', { dead: true }); s.step(); out.push(s.targetOf('a'));
      h.set('b', { dead: true }); s.step(); out.push(s.targetOf('a'));
      s.request('a', 'next'); out.push(s.targetOf('a'));
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('P4 the ghost-here ping', () => {
  it('uses the ghost the SERVER says is in the spectator’s view, rounds it, and names the sender; there is nothing for the client to fake', () => {
    const h = team(['a', 'b']); const s = new SpectateSystem(h);
    h.set('a', { dead: true }); s.step();
    const r = s.ping('a', [ghost()]);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.ping).toEqual({ tick: 1000, room: 'r0', x: 812, y: 651, from: 'A' }); expect(GhostPingSchema.safeParse(r.ping).success).toBe(true); }
    expect(SpectateFollowSchema.safeParse({ target: 'next', x: 5 }).success).toBe(true); // extra keys are ignored by zod: no coordinate field exists to read
    expect('x' in SpectateFollowSchema.parse({ target: 'next', x: 5 })).toBe(false);
  });
  it('refused: the living, and no ghost to point at', () => {
    const h = team(['a', 'b']); const s = new SpectateSystem(h);
    expect(s.ping('b', [ghost()])).toEqual({ ok: false, error: 'You are not dead.' });
    h.set('a', { dead: true }); s.step();
    expect(s.ping('a', [])).toEqual({ ok: false, error: 'No ghost in view.' });
    // a free-fly spectator needs no living teammate to look through: with everybody dead they can still say "ghost here" (to the other spectators)
    h.set('b', { dead: true }); s.step();
    expect(s.ping('a', [ghost()]).ok).toBe(true);
  });
  it('rate limit: one per 3 s; a refusal costs nothing; ready again after exactly the cooldown', () => {
    const h = team(['a', 'b']); const s = new SpectateSystem(h);
    h.set('a', { dead: true }); s.step();
    expect(s.ping('a', [ghost()]).ok).toBe(true);
    expect(s.pingReadyIn('a')).toBe(SPECTATE.pingCooldownTicks);
    h.tick += SPECTATE.pingCooldownTicks - 1;
    expect(s.ping('a', [ghost()])).toEqual({ ok: false, error: 'Too fast.' });
    expect(s.pingReadyIn('a')).toBe(1);
    h.tick += 1;
    expect(s.pingReadyIn('a')).toBe(0);
    expect(s.ping('a', [ghost()]).ok).toBe(true);
  });
  it('the numbers do not depend on the stage and the schemas accept what the server sends', () => {
    expect(SPECTATE.pingCooldownTicks).toBe(60);
    expect(SPECTATE.pingTtlTicks).toBe(100);
    const ds = { tick: 5, life: 'downed', following: { id: 'b', name: 'B' }, watchable: [{ id: 'b', name: 'B' }], pingReadyIn: 0, reviveLeft: 900 };
    expect(DeathStateSchema.safeParse(ds).success).toBe(true);
    expect(DeathStateSchema.safeParse({ ...ds, life: 'ghost' }).success).toBe(false);
  });
});

describe('P4 step 6: the free-fly camera (bounded by the server)', () => {
  const dt = 1 / SERVER_TICK_HZ;
  function dead(): { h: FakeHost; s: SpectateSystem } {
    const h = team(['a', 'b', 'c']);
    h.pos.set('a', { room: 'r0', x: 300, y: 680 }); h.pos.set('b', { room: 'r1', x: 900, y: 680 }); h.pos.set('c', { room: 'r2', x: 1500, y: 680 });
    const s = new SpectateSystem(h);
    h.set('a', { dead: true });
    s.step();
    return { h, s };
  }
  it('starts on the teammate it follows (in that teammate’s room), and follows them as they move', () => {
    const { h, s } = dead();
    expect(s.camOf('a')).toEqual({ room: 'r1', x: 900, y: 680, free: false });
    h.pos.set('b', { room: 'r2', x: 100, y: 500 }); s.step();
    expect(s.camOf('a')).toEqual({ room: 'r2', x: 100, y: 500, free: false });
    expect(s.camOf('b')).toBeNull(); // the living have none
  });
  it('a move intent frees the camera and it flies at the bounded speed; silence stops it after the intent’s time to live', () => {
    const { h, s } = dead();
    h.tick = 2000;
    expect(s.move('a', { x: 1, y: 0 })).toEqual({ ok: true, message: 'Camera moved.' });
    const x0 = s.camOf('a')!.x;
    for (let i = 0; i < SPECTATE.camIntentTtlTicks; i++) { h.tick++; s.step(); }
    const c = s.camOf('a')!;
    expect(c.free).toBe(true);
    expect(c.x - x0).toBeCloseTo(SPECTATE.camSpeed * dt * SPECTATE.camIntentTtlTicks, 5);
    expect(c.y).toBe(680);
    h.tick += 5; s.step(); const stopped = s.camOf('a')!.x;
    h.tick += 5; s.step();
    expect(s.camOf('a')!.x).toBe(stopped); // the intent lapsed: no message, no movement
  });
  it('is bounded in speed (a diagonal is no faster), in area (never outside the room’s arena) and in message rate (one per 2 ticks)', () => {
    const { h, s } = dead();
    h.tick = 3000;
    let prev = s.camOf('a')!, worst = 0;
    for (let i = 0; i < 400; i++) {
      h.tick++;
      s.move('a', i % 400 < 200 ? { x: 1, y: -1 } : { x: -1, y: 1 }); // the keys held down as fast as the client may send
      s.step();
      const c = s.camOf('a')!;
      worst = Math.max(worst, Math.hypot(c.x - prev.x, c.y - prev.y));
      expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(h.sizes[c.room]!.w);
      expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(h.sizes[c.room]!.h);
      prev = c;
    }
    expect(worst).toBeLessThanOrEqual(SPECTATE.camSpeed * dt + 1e-9);
    // the rate: a second message in the same tick, or the next one, is refused
    h.tick += 10;
    expect(s.move('a', { x: 1, y: 0 }).ok).toBe(true);
    expect(s.move('a', { x: 0, y: 1 })).toEqual({ ok: false, error: 'Too fast.' });
    h.tick += 1;
    expect(s.move('a', { x: 0, y: 1 })).toEqual({ ok: false, error: 'Too fast.' });
    h.tick += 1;
    expect(s.move('a', { x: 0, y: 1 }).ok).toBe(true);
  });
  it('can not leave the stage: it sits inside the arena of a room that exists, and there is no exit to go through', () => {
    const { h, s } = dead();
    h.tick = 4000;
    for (let i = 0; i < 2000; i++) { h.tick += 2; s.move('a', { x: 1, y: 1 }); s.step(); }
    const c = s.camOf('a')!;
    expect(h.roomIds).toContain(c.room);
    expect(c.x).toBe(h.sizes[c.room]!.w); expect(c.y).toBe(h.sizes[c.room]!.h); // pinned in the corner of its room, not beyond it
    expect(stepSpectatorCam({ room: 'r0', x: 5, y: 5, free: true }, { x: -1, y: -1 }, 100, { w: 10, h: 10 })).toEqual({ room: 'r0', x: 0, y: 0, free: true });
  });
  it('switches rooms: next and previous cycle through the stage, an id goes there, an unknown room is refused; the camera lands in the middle of the room', () => {
    const { h, s } = dead();
    h.tick = 5000;
    const go = (req: string) => { h.tick += 2; return s.room('a', req); };
    expect(go('next')).toEqual({ ok: true, message: 'Room 3 of 3.' }); // it was in r1
    expect(s.camOf('a')).toEqual({ room: 'r2', x: 960, y: 360, free: true });
    expect(go('next').ok).toBe(true); expect(s.camOf('a')!.room).toBe('r0'); // wraps
    expect(go('prev').ok).toBe(true); expect(s.camOf('a')!.room).toBe('r2');
    expect(go('r1')).toEqual({ ok: true, message: 'Room 2 of 3.' });
    expect(s.camOf('a')).toEqual({ room: 'r1', x: 1280, y: 360, free: true });
    expect(go('nowhere')).toEqual({ ok: false, error: 'There is no such room.' });
    expect(s.camOf('a')!.room).toBe('r1');
  });
  it('following a teammate again brings the camera back to them; the living can not use any of it', () => {
    const { h, s } = dead();
    h.tick = 6000;
    s.move('a', { x: 1, y: 0 }); h.tick += 3; s.step();
    expect(s.camOf('a')!.free).toBe(true);
    expect(s.request('a', 'c').ok).toBe(true);
    h.tick += 1; s.step();
    expect(s.camOf('a')).toEqual({ room: 'r2', x: 1500, y: 680, free: false });
    expect(s.move('b', { x: 1, y: 0 })).toEqual({ ok: false, error: 'You are not dead.' });
    expect(s.room('b', 'next')).toEqual({ ok: false, error: 'You are not dead.' });
  });
  it('with nobody alive to follow the camera still exists and flies; a revived player loses theirs', () => {
    const { h, s } = dead();
    h.set('b', { dead: true }); h.set('c', { dead: true }); s.step();
    expect(s.camOf('a')).not.toBeNull();
    h.tick = 7000; expect(s.move('a', { x: 1, y: 0 }).ok).toBe(true);
    h.set('a', { dead: false }); s.step();
    expect(s.camOf('a')).toBeNull();
  });
  it('is deterministic: the same messages give the same camera', () => {
    const run = (): string => { const { h, s } = dead(); h.tick = 100; const out: unknown[] = []; for (let i = 0; i < 60; i++) { h.tick += 2; s.move('a', { x: i % 3 === 0 ? 1 : 0, y: i % 5 === 0 ? -1 : 1 }); s.step(); out.push(s.camOf('a')); } return JSON.stringify(out); };
    expect(run()).toBe(run());
  });
  it('the messages the client may send are exactly an intent of -1, 0 or 1 per axis and a room; nothing else parses', () => {
    expect(SpectateMoveSchema.safeParse({ x: 1, y: -1 }).success).toBe(true);
    expect(SpectateMoveSchema.safeParse({ x: 2, y: 0 }).success).toBe(false);
    expect(SpectateMoveSchema.safeParse({ x: 0.5, y: 0 }).success).toBe(false);
    expect('speed' in SpectateMoveSchema.parse({ x: 1, y: 0, speed: 9999 })).toBe(false); // no speed or position can be smuggled in
    expect(SpectateRoomSchema.safeParse({ room: 'next' }).success).toBe(true);
    expect(SpectateRoomSchema.safeParse({ room: '' }).success).toBe(false);
  });
});
