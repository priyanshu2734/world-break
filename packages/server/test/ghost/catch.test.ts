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
  it('a spot holds one player: the second finds it taken (and another spot in reach is used)', () => {
    const { sys } = setup([who('a', 500), who('b', 510)]);
    expect(sys.hide('a').ok).toBe(true);
    const r = sys.hide('b');
    expect(r.ok).toBe(false);
    expect(sys.isHidden('b')).toBe(false);
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
  it('a disconnected or unknown player cannot hide; a caught one cannot', () => {
    const { sys } = setup([who('a', 500, { connected: false }), who('b', 500)]);
    expect(sys.hide('a').ok).toBe(false);
    expect(sys.hide('zzz').ok).toBe(false);
    sys.capture('b');
    expect(sys.hide('b')).toEqual({ ok: false, error: 'You are caught. Wait for a teammate.' });
  });
});

describe('P3E the catch', () => {
  it('a caught player is frozen where they are, and a caught hider is taken out of the spot', () => {
    const { host, sys } = setup([who('a', 500), who('b', 800)]);
    sys.hide('a');
    sys.capture('a');
    expect(sys.isCaptured('a')).toBe(true);
    expect(sys.isHidden('a')).toBe(false);
    expect(sys.occupantOf('r0_h0')).toBeNull();
    expect(host.frozen.has('a')).toBe(true);
    expect(host.said.at(-1)?.tone).toBe('bad');
    expect(sys.releaseIn('a')).toBe(CATCH_LIMITS.captureTicks);
  });
  it('carried parts fall one at a time until none are left', () => {
    const { host, sys, run } = setup([who('a', 300)]);
    host.carrying.set('a', 2);
    sys.capture('a');
    run(1);
    expect(host.carrying.get('a')).toBe(1);
    run(1);
    expect(host.carrying.get('a')).toBe(0);
    run(5);
    expect(host.dropped).toEqual(['a', 'a']);
  });
  it('a drop that never works does not loop forever', () => {
    const { host, sys, run } = setup([who('a', 300)]);
    let calls = 0;
    host.dropOne = () => { calls++; return 1; };
    sys.capture('a');
    run(200);
    expect(calls).toBeLessThanOrEqual(81);
  });
  it('capturing twice is one capture', () => {
    const { host, sys } = setup([who('a', 300)]);
    sys.capture('a');
    const said = host.said.length;
    sys.capture('a');
    expect(host.said.length).toBe(said);
  });
});

describe('P3E rescue', () => {
  const holding = (id: string, x: number, o: Partial<CatchWho> = {}) => who(id, x, { use: true, ...o });
  it('a teammate holding E in reach frees them after rescueTicks, at no cost, where they stand', () => {
    const { host, sys, run } = setup([who('a', 300), holding('b', 340)]);
    sys.capture('a');
    run(CATCH_LIMITS.rescueTicks - 1);
    expect(sys.isCaptured('a')).toBe(true);
    expect(sys.rescueProgress('a')!).toBeGreaterThan(0.9);
    run(1);
    expect(sys.isCaptured('a')).toBe(false);
    expect(host.frozen.has('a')).toBe(false);
    expect(host.penalties).toEqual([]);
    expect(host.entries).toEqual([]);
    expect(host.said.at(-1)?.text).toBe('B freed A.');
  });
  it('letting go loses progress; a brief slip does not undo everything', () => {
    const { host, sys, run } = setup([who('a', 300), holding('b', 340)]);
    sys.capture('a');
    run(40);
    host.players[1] = who('b', 340); // let go
    run(5);
    const p = sys.rescueProgress('a')!;
    expect(p).toBeCloseTo((40 - 5 * CATCH_LIMITS.rescueDecayPerTick) / CATCH_LIMITS.rescueTicks, 5);
    run(100);
    expect(sys.rescueProgress('a')).toBe(0);
    expect(sys.isCaptured('a')).toBe(true);
  });
  it('out of reach, in another room, hiding, caught, or disconnected rescuers do nothing', () => {
    for (const rescuer of [holding('b', 300 + CATCH_LIMITS.rescueRange + 1), holding('b', 320, { room: 'r1' }), holding('b', 320, { y: 400 }), holding('b', 320, { connected: false })]) {
      const { sys, run } = setup([who('a', 300), rescuer]);
      sys.capture('a');
      run(CATCH_LIMITS.rescueTicks + 5);
      expect(sys.isCaptured('a')).toBe(true);
    }
    const hiding = setup([who('a', 300), holding('b', 500)]);
    hiding.sys.hide('b');
    hiding.host.players[0] = who('a', 520);
    hiding.sys.capture('a');
    hiding.run(CATCH_LIMITS.rescueTicks + 5);
    expect(hiding.sys.isCaptured('a')).toBe(true);
    const both = setup([who('a', 300), holding('b', 320)]);
    both.sys.capture('a'); both.sys.capture('b');
    both.run(CATCH_LIMITS.rescueTicks + 5);
    expect(both.sys.isCaptured('a')).toBe(true);
  });
  it('two rescuers do not make it faster (one counts)', () => {
    const { sys, run } = setup([who('a', 300), holding('b', 320), holding('c', 330)]);
    sys.capture('a');
    run(CATCH_LIMITS.rescueTicks - 1);
    expect(sys.isCaptured('a')).toBe(true);
  });
  it('the caught player cannot free themselves by holding E', () => {
    const { sys, run } = setup([who('a', 300, { use: true })]);
    sys.capture('a');
    run(CATCH_LIMITS.rescueTicks + 5);
    expect(sys.isCaptured('a')).toBe(true);
  });
});

describe('P3E release', () => {
  it('after captureTicks with nobody helping: placed at the entry, a score penalty, unfrozen, nobody eliminated', () => {
    const { host, sys, run } = setup([who('a', 300), who('b', 900)]);
    sys.capture('a');
    run(CATCH_LIMITS.captureTicks - 1);
    expect(sys.isCaptured('a')).toBe(true);
    expect(host.penalties).toEqual([]);
    run(1);
    expect(sys.isCaptured('a')).toBe(false);
    expect(host.entries).toEqual(['a']);
    expect(host.penalties).toEqual([CATCH_LIMITS.releasePenalty]);
    expect(host.frozen.has('a')).toBe(false);
    expect(host.said.at(-1)?.tone).toBe('warn');
    run(CATCH_LIMITS.captureTicks * 2);
    expect(host.penalties.length).toBe(1); // charged once
  });
  it('the capture is about 45 seconds and a rescue takes a few seconds (the brief)', () => {
    expect(CATCH_LIMITS.captureTicks / 20).toBe(45);
    expect(CATCH_LIMITS.rescueTicks / 20).toBeGreaterThanOrEqual(3);
    expect(CATCH_LIMITS.rescueTicks / 20).toBeLessThanOrEqual(5);
  });
  it('a player who leaves the run is forgotten, and does not break the others', () => {
    const { sys, run } = setup([who('a', 300), who('b', 900)]);
    sys.capture('a'); sys.capture('b');
    sys.remove('a');
    run(CATCH_LIMITS.captureTicks);
    expect(sys.isCaptured('a')).toBe(false);
    expect(sys.isCaptured('b')).toBe(false);
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
  it('your own timer, and the caught teammates you can see with the rescue progress', () => {
    const { host, sys, run } = setup([who('a', 300), who('b', 340, { use: true }), who('c', 900, { room: 'r1' })]);
    sys.capture('a');
    run(40);
    expect(sys.statusFor('a').caught?.secondsLeft).toBe(Math.ceil((CATCH_LIMITS.captureTicks - 40) / 20));
    expect(sys.statusFor('a').captives).toEqual([]);
    expect(sys.statusFor('b').captives).toEqual([{ id: 'a', progress: 0.5 }]);
    expect(sys.statusFor('b').caught).toBeNull();
    expect(sys.statusFor('c').captives).toEqual([]); // another room
    host.blind.add('b');
    expect(sys.statusFor('b').captives).toEqual([]);   // out of view
  });
  it('an unknown viewer is told nothing', () => {
    const { sys } = setup([who('a', 300)]);
    expect(sys.statusFor('zzz')).toEqual({ spots: [], hiddenIn: null, caught: null, captives: [] });
  });
});
