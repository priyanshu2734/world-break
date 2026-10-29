import { describe, expect, it } from 'vitest';
import { CATCH_LIMITS, GhostStatusSchema } from '@wb/shared';
import { CatchSystem, type CatchHost, type CatchWho, type HidingSpotDef } from '../../src/ghost';

/** A scripted host: players stand where the test puts them, and every effect is recorded. */
class FakeCatchHost implements CatchHost {
  tick = 0;
  players: CatchWho[] = [];
  frozen = new Set<string>();
  carrying = new Map<string, number>();
  dropped: string[] = [];
  entries: string[] = [];
  penalties: number[] = [];
  said: { text: string; tone: string }[] = [];
  watchedIds = new Set<string>();
  seeAll = true;
  blind = new Set<string>();
  /** P4: who the ghost killed (the host's death system is faked as a set). */
  killed: string[] = [];
  dead(id: string): boolean { return this.killed.includes(id); }
  kill(id: string): void { if (!this.killed.includes(id)) this.killed.push(id); }
  who(): CatchWho[] { return this.players; }
  freeze(id: string, on: boolean): void { if (on) this.frozen.add(id); else this.frozen.delete(id); }
  dropOne(id: string): number { const n = this.carrying.get(id) ?? 0; if (n === 0) return 0; this.carrying.set(id, n - 1); this.dropped.push(id); return n - 1; }
  placeAtEntry(id: string): void { this.entries.push(id); }
  penalty(points: number): void { this.penalties.push(points); }
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad'): void { this.said.push({ text, tone }); }
  watched(id: string): boolean { return this.watchedIds.has(id); }
  canSee(viewerId: string, x: number, y: number): boolean { void x; void y; return this.seeAll && !this.blind.has(viewerId); }
}

const SPOTS: HidingSpotDef[] = [
  { id: 'r0_h0', room: 'r0', x: 500, y: 680, kind: 'closet' },
  { id: 'r0_h1', room: 'r0', x: 900, y: 680, kind: 'vent' },
  { id: 'r1_h0', room: 'r1', x: 500, y: 680, kind: 'closet' },
];
const who = (id: string, x: number, o: Partial<CatchWho> = {}): CatchWho => ({ id, name: id.toUpperCase(), room: 'r0', x, y: 680, connected: true, use: false, ...o });

function setup(players: CatchWho[]) {
  const host = new FakeCatchHost();
  host.players = players;
  const sys = new CatchSystem(SPOTS, host);
  const run = (n: number) => { for (let i = 0; i < n; i++) { host.tick++; sys.step(); } };
  return { host, sys, run };
}

describe('P3E hiding', () => {
  it('E in reach of a spot hides the player: frozen, hidden, and the ghost can ask who is inside', () => {
    const { host, sys } = setup([who('a', 520)]);
    const r = sys.hide('a');
    expect(r.ok).toBe(true);
    expect(sys.isHidden('a')).toBe(true);
    expect(host.frozen.has('a')).toBe(true);
    expect(sys.occupantOf('r0_h0')).toBe('a');
    expect(sys.occupantOf('r0_h1')).toBeNull();
    expect([...sys.hiddenIds()]).toEqual(['a']);
  });
  it('out of reach, in another room, or no spot at all: the same refusal', () => {
    const msgs = new Set<string>();
    for (const w of [who('a', 700), who('a', 520, { y: 400 }), who('a', 520, { room: 'r9' })]) {
      const { sys } = setup([w]);
      const r = sys.hide('a');
      expect(r.ok).toBe(false);
      if (!r.ok) msgs.add(r.error);
    }
    expect([...msgs]).toEqual(['There is nowhere to hide here.']);
  });
  it('a spot holds TWO players (P3E step 5, was one): the third finds it taken', () => {
    const { sys } = setup([who('a', 500), who('b', 510), who('c', 505)]);
    expect(sys.hide('a').ok).toBe(true);
    expect(sys.hide('b').ok).toBe(true);
    expect(sys.occupantsOf('r0_h0')).toEqual(['a', 'b']);
    const r = sys.hide('c');
    expect(r.ok).toBe(false);
    expect(sys.isHidden('c')).toBe(false);
  });
  it('is refused while a ghost is watching, and the refusal still costs the cooldown (no spamming)', () => {
    const { host, sys, run } = setup([who('a', 500)]);
    host.watchedIds.add('a');
    const r = sys.hide('a');
    expect(r).toEqual({ ok: false, error: 'It is watching you. There is no time to hide.' });
    host.watchedIds.clear();
    expect(sys.hide('a').ok).toBe(false); // too fast
    run(CATCH_LIMITS.hideCooldownTicks);
    expect(sys.hide('a').ok).toBe(true);
  });
  it('leave: only when hiding, after the cooldown, and it frees the player', () => {
    const { host, sys, run } = setup([who('a', 500)]);
    expect(sys.leave('a').ok).toBe(false);
    sys.hide('a');
    expect(sys.leave('a').ok).toBe(false); // too fast
    run(CATCH_LIMITS.hideCooldownTicks);
    expect(sys.leave('a').ok).toBe(true);
    expect(sys.isHidden('a')).toBe(false);
    expect(host.frozen.has('a')).toBe(false);
    expect(sys.occupantOf('r0_h0')).toBeNull();
  });
  it('a disconnected or unknown player cannot hide; a dead one cannot (P4: was "caught")', () => {
    const { host, sys } = setup([who('a', 500, { connected: false }), who('b', 500)]);
    expect(sys.hide('a').ok).toBe(false);
    expect(sys.hide('zzz').ok).toBe(false);
    sys.capture('b');
    expect(host.dead('b')).toBe(true);
    expect(sys.hide('b')).toEqual({ ok: false, error: 'You are dead. You can only watch.' });
  });
});

describe('P4 the kill seam (was the P3E capture)', () => {
  it('a kill takes a hider out of the spot, freezes nothing itself and tells the host once', () => {
    const { host, sys } = setup([who('a', 500), who('b', 800)]);
    sys.hide('a');
    sys.capture('a');
    expect(host.killed).toEqual(['a']);
    expect(sys.isHidden('a')).toBe(false);
    expect(sys.occupantOf('r0_h0')).toBeNull();
    expect(sys.isCaptured('a')).toBe(true); // name kept: "not a target any more"
    expect(sys.capturedCount).toBe(1);
  });
  it('killing twice (two ghosts on one tick) is one death', () => {
    const { host, sys } = setup([who('a', 300)]);
    sys.capture('a');
    sys.capture('a');
    expect(host.killed).toEqual(['a']);
  });
  it('an unknown player is never killed', () => {
    const { host, sys } = setup([who('a', 300)]);
    sys.capture('zzz');
    expect(host.killed).toEqual([]);
  });
  it('a player who leaves the run is forgotten, and does not break the others', () => {
    const { sys } = setup([who('a', 300), who('b', 500)]);
    sys.hide('b');
    sys.remove('b');
    expect(sys.isHidden('b')).toBe(false);
  });
});

describe('P3E what a player is told', () => {
  it('spots in view, the spot you hide in, and nothing about who hides where', () => {
    const { host, sys } = setup([who('a', 500), who('b', 900)]);
    sys.hide('a');
    const a = sys.statusFor('a'), b = sys.statusFor('b');
    expect(GhostStatusSchema.safeParse(a).success).toBe(true);
    expect(a.hiddenIn).toBe('r0_h0');
    expect(b.hiddenIn).toBeNull();
    expect(b.spots.map((s) => s.id)).toEqual(['r0_h0', 'r0_h1']); // the same furniture whether or not somebody is inside
    expect(JSON.stringify(b)).not.toContain('"a"');
    host.blind.add('b');
    expect(sys.statusFor('b').spots).toEqual([]); // not in view: not told
  });
  it('the interim caught/captives fields are always empty now (the schema keeps them; the death messages tell who is dead)', () => {
    const { sys } = setup([who('a', 300), who('b', 340, { use: true })]);
    sys.capture('a');
    expect(sys.statusFor('a').caught).toBeNull();
    expect(sys.statusFor('b').captives).toEqual([]);
  });
  it('an unknown viewer is told nothing', () => {
    const { sys } = setup([who('a', 300)]);
    expect(sys.statusFor('zzz')).toEqual({ spots: [], hiddenIn: null, caught: null, captives: [] });
  });
});
