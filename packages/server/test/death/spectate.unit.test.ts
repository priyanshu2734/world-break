import { describe, expect, it } from 'vitest';
import { SPECTATE, GhostPingSchema, DeathStateSchema, SpectateFollowSchema, type GhostPublic } from '@wb/shared';
import { SpectateSystem, type SpectateHost } from '../../src/death';

class FakeHost implements SpectateHost {
  tick = 1000;
  players: { id: string; name: string; connected: boolean; dead: boolean }[] = [];
  roster() { return this.players.map(({ id, name, connected }) => ({ id, name, connected })); }
  isDead(id: string): boolean { return this.players.find((p) => p.id === id)?.dead === true; }
  isAlive(id: string): boolean { const p = this.players.find((q) => q.id === id); return !!p && !p.dead; }
  set(id: string, o: Partial<{ connected: boolean; dead: boolean }>): void { Object.assign(this.players.find((p) => p.id === id)!, o); }
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
  it('refused: the living, no ghost in view, nobody to watch', () => {
    const h = team(['a', 'b']); const s = new SpectateSystem(h);
    expect(s.ping('b', [ghost()])).toEqual({ ok: false, error: 'You are not dead.' });
    h.set('a', { dead: true }); s.step();
    expect(s.ping('a', [])).toEqual({ ok: false, error: 'No ghost in view.' });
    h.set('b', { dead: true }); s.step();
    expect(s.ping('a', [ghost()])).toEqual({ ok: false, error: 'Nobody is left to watch.' });
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
