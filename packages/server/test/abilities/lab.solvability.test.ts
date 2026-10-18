import { describe, expect, it } from 'vitest';
import {
  ABILITY_LAB_ARENA, ABILITY_SPECS, ARENA, MAX_PROPS_TOTAL, PLAYER_HEIGHT, PLAYER_WIDTH,
  spawnBody, stepBody, stepProp, worldForTick, type AbilityId, type Prop,
} from '@wb/shared';
import { ABILITY_LAB_STAGE } from '../../src/systems/stages/abilityLab';
import { validateStageDef } from '../../src/systems/validate';
import { Lockstep, wait, type Script } from '../helpers/bot';
import { assign, labRoom, makeNav, playLab, STATION_OBJECTIVE, type Station } from '../helpers/labBot';

const nav = makeNav(ABILITY_LAB_ARENA);
const FLOOR = 0, LEDGE = 7, W1 = 6, M_A = 3, D1 = 5, A1 = 1, S = 2;

const statusOf = (r: { room: { peekStageState(): { objectives: { id: string; status: string }[] } | null } }) =>
  Object.fromEntries(r.room.peekStageState()!.objectives.map((o) => [o.id, o.status]));

describe('Ability Lab: real-physics solvability (Room -> GameSim -> PhysicsWorld -> StageEngine)', () => {
  it.each([1, 2, 3, 4])('%i player(s) finish every station and stabilise the stage', (n) => {
    const r = playLab(n);
    expect(statusOf(r)).toEqual({ o_charge: 'complete', o_anchor: 'complete', o_freeze: 'complete', o_well: 'complete', o_momentum: 'complete', o_dup: 'complete' });
    expect(r.room.peekStageState()!.status).toBe('stabilized');
    expect(r.room.phase).toBe('stage_complete');
    expect(r.ticks).toBeLessThan(ABILITY_LAB_STAGE.deadlineTicks / 2); // well inside the soft deadline
    for (const p of r.room.peekStageState()!.abilities!.players) { expect(p.energy).toBeGreaterThanOrEqual(0); expect(p.energy).toBeLessThanOrEqual(100); }
  });
  it('more players are not slower than one (the stations really are shared out)', () => {
    expect(playLab(4).ticks).toBeLessThanOrEqual(playLab(1).ticks);
  });
  it('is deterministic: the same play gives the same tick count and the same final state', () => {
    const a = playLab(2), b = playLab(2);
    expect(a.ticks).toBe(b.ticks);
    expect(a.room.peekStageState()!.score.total).toBe(b.room.peekStageState()!.score.total);
  });
  it('the energy economy is real: one player cannot afford every station without a repair', () => {
    const total = (['gravity_well', 'momentum', 'duplicate', 'freeze'] as const).reduce((s, a) => s + ABILITY_SPECS[a].energyCost, 0);
    expect(total).toBeGreaterThan(100);
    expect(() => playLab(1, { skip: ['charge'] })).toThrow(/Not enough Reality Energy/);
  });
  it('stays inside every physical bound while it is played', () => {
    const r = playLab(4, { extraTicks: 0 });
    const g = r.room.gameSnapshot()!;
    for (const p of g.players) { expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1280); }
    expect(g.world!.props.length).toBeLessThanOrEqual(MAX_PROPS_TOTAL);
  });
});

describe('Ability Lab: each ability is REQUIRED (the other stations get done, this one cannot)', () => {
  /** Every station except `skipped` is played with real bots, then we wait a long time: the skipped objective must not complete on its own. */
  function without(skipped: Station): Record<string, string> {
    const r = playLab(2, { skip: [skipped], extraTicks: 1500 });
    return statusOf(r);
  }
  const expectOnlyOpen = (st: Record<string, string>, open: string) => {
    for (const [id, status] of Object.entries(st)) expect([id, status]).toEqual([id, id === open ? 'active' : 'complete']);
  };
  it('Gravity Well: without it the ledge plate stays open', () => expectOnlyOpen(without('well'), 'o_well'));
  it('Momentum: without it the island plate stays open', () => expectOnlyOpen(without('momentum'), 'o_momentum'));
  it('Duplicate: without it the two heavy plates are never held together', () => expectOnlyOpen(without('dup'), 'o_dup'));
  it('Freeze: without it the console is never calibrated (and the anchor/others are fine)', () => expectOnlyOpen(without('freeze'), 'o_freeze'));
  it('Anchor: the flux console refuses until an anchor is planted', () => {
    const { room, ids } = labRoom(1);
    const sim = new Lockstep(room);
    const get = () => sim.body(ids[0]!);
    const script = (function* (): Script {
      yield* nav.goTo(get, 420, 590);
      yield* wait(4);
      const r = room.stageAction(ids[0]!, { kind: 'interact', targetId: 'core_anchor' });
      expect(r).toEqual({ ok: false, error: 'Gravity is too unstable to hold the console.' });
      yield* wait(300);
    })();
    sim.run({ [ids[0]!]: script });
    expect(statusOf({ room }).o_anchor).toBe('active');
  });

  it('Freeze: a determined channel with no freeze is interrupted by the arc every time', () => {
    const { room, ids } = labRoom(1);
    const sim = new Lockstep(room);
    const id = ids[0]!, get = () => sim.body(id);
    const script = (function* (): Script {
      yield* nav.goTo(get, 720, 680);
      for (let i = 0; i < 12; i++) {
        yield* wait(4);
        room.stageAction(id, { kind: 'interact', targetId: 'core_freeze' });
        yield* wait(40);
      }
    })();
    sim.run({ [id]: script });
    expect(statusOf({ room }).o_freeze).toBe('active');
  });

  it('Gravity Well: no jump, even boosted by a Momentum shove at any moment, reaches the ledge', () => {
    // From every standing point of the platforms next to the ledge: a jump, plus ONE impulse in any direction at any of 9 moments,
    // plus any of 3 steering choices, simulated with the shared physics step. (A single impulse because of its 160-tick cooldown.)
    // The target is read from the arena, so moving the ledge in the arena changes what is checked (no hard-coded numbers).
    const ledge = ABILITY_LAB_ARENA.solids[LEDGE]!;
    const takeoffs = [W1, D1].map((i) => ABILITY_LAB_ARENA.solids[i]!);
    let tried = 0, reached = 0;
    for (const t0 of takeoffs) {
      for (let sx = t0.x + 6; sx <= t0.x + t0.w - 6; sx += 4) for (const at of [0, 2, 4, 6, 8, 10, 12, 16, 20]) for (const dir of ['up', 'left', 'right', 'down', 'cancel'] as const) for (const mv of [-1, 0, 1]) {
        const b = spawnBody(sx, t0.y); tried++;
        const imp = { id: 'i', tick: at, playerId: 'p', dvx: dir === 'left' ? -600 : dir === 'right' ? 600 : 0, dvy: dir === 'up' ? -600 : dir === 'down' ? 600 : 0, cancel: dir === 'cancel', driftTicks: 8 };
        for (let t = 0; t < 140; t++) {
          stepBody(b, { moveX: mv, jump: t === 0 }, ABILITY_LAB_ARENA, worldForTick({ impulses: [imp] }, t, 'p'));
          if (b.grounded && Math.abs(b.y - ledge.y) < 0.01 && b.x > ledge.x && b.x < ledge.x + ledge.w) { reached++; break; }
        }
      }
    }
    expect(tried).toBeGreaterThan(10000);
    expect(reached).toBe(0);
  });
  it('Gravity Well (control): the same probe DOES find the ledge when a well is present, so it is not vacuous', () => {
    const ledge = ABILITY_LAB_ARENA.solids[LEDGE]!;
    const zone = { x: 960, y: 180, w: 320, h: 320, gx: 0, gy: -1800 };
    const b = spawnBody(1200, 500);
    let reached = false;
    for (let t = 0; t < 200 && !reached; t++) {
      stepBody(b, { moveX: b.y > 120 && t < 90 ? 0 : -1, jump: false }, ABILITY_LAB_ARENA, { zones: [zone] });
      reached = b.grounded && Math.abs(b.y - ledge.y) < 0.01 && b.x > ledge.x && b.x < ledge.x + ledge.w;
    }
    expect(reached).toBe(true);
  });
  it('Gravity Well: the ledge is not in the walking-and-jumping graph, but its take-off platform is', () => {
    const reach = nav.reachableFrom(FLOOR);
    expect(reach.has(LEDGE)).toBe(false);
    for (const p of [A1, S, M_A, D1, W1]) expect(reach.has(p)).toBe(true);
  });
  it('Momentum: a crate pushed any other way, or only lifted by a well, never reaches the island plate', () => {
    const mk = (): Prop => ({ id: 'c', kind: 'crate', x: 360, y: 400, vx: 0, vy: 0, w: 32, h: 32, grounded: true, frozenUntilTick: 0, ownerId: null, cloneOf: null, expiresTick: null, light: true });
    for (const [vx, vy] of [[600, 0], [0, -600], [0, 600], [-300, 0], [-450, 0], [0, 0]] as const) {
      const p = mk(); p.vx = vx; p.vy = vy; p.grounded = false;
      for (let t = 0; t < 400; t++) stepProp(p, t, ABILITY_LAB_ARENA);
      expect(p.y === 600 && p.x < 56).toBe(false);
    }
    const flip = mk();
    for (let t = 0; t < 400; t++) stepProp(flip, t, ABILITY_LAB_ARENA, [{ x: 200, y: 200, w: 320, h: 320, gx: 0, gy: -1800 }]);
    expect(flip.y === 600 && flip.x < 56).toBe(false);
  });
  it('Momentum: no copy can be placed on the island from anywhere a player can stand next to the crate', () => {
    // Placement needs the SOURCE crate and the placement point both within range of the player. Search every reachable standing
    // point for one that has crate_m AND the island plate in range at once.
    const range = ABILITY_SPECS.duplicate.range;
    const crate = { x: 360, y: 384 }, plate = { x: 32, y: 584 };
    let found = 0;
    for (const s of ABILITY_LAB_ARENA.solids) for (let x = s.x; x <= s.x + s.w; x += 4) {
      const body = { x, y: s.y - PLAYER_HEIGHT / 2 };
      if (Math.hypot(body.x - crate.x, body.y - crate.y) <= range && Math.hypot(body.x - plate.x, body.y - plate.y) <= range) found++;
    }
    expect(found).toBe(0);
  });
});

describe('Ability Lab: arena sanity', () => {
  it('every solid is inside the arena, spawns stand on the floor with full headroom, and the stage validates', () => {
    for (const s of ABILITY_LAB_ARENA.solids) { expect(s.x).toBeGreaterThanOrEqual(0); expect(s.x + s.w).toBeLessThanOrEqual(ABILITY_LAB_ARENA.width); expect(s.y + s.h).toBeLessThanOrEqual(ABILITY_LAB_ARENA.height); }
    for (const sp of ABILITY_LAB_ARENA.spawns) {
      expect(sp.y).toBe(680);
      const above = ABILITY_LAB_ARENA.solids.filter((s) => s.y + s.h <= sp.y && sp.x + PLAYER_WIDTH / 2 > s.x && sp.x - PLAYER_WIDTH / 2 < s.x + s.w);
      expect(above).toEqual([]);
    }
    expect(ABILITY_LAB_ARENA.spawns).toHaveLength(4);
    expect(validateStageDef(ABILITY_LAB_STAGE, ABILITY_LAB_ARENA)).toEqual([]);
  });
  it('it validates only against ITS arena, never the rotation arena', () => {
    expect(validateStageDef(ABILITY_LAB_STAGE, ARENA).some((e) => e.includes('arena mismatch'))).toBe(true);
  });
  it('every ability is enabled in the Lab, and each requirement test above targets a distinct station', () => {
    const enabled: AbilityId[] = ABILITY_LAB_STAGE.abilities!.enabled;
    for (const a of ['gravity_well', 'freeze', 'duplicate', 'momentum', 'anchor'] as const) expect(enabled).toContain(a);
    expect(new Set(Object.values(STATION_OBJECTIVE)).size).toBe(6);
    expect(assign(1)[0]).toHaveLength(6);
    expect(assign(4).flat().sort()).toEqual([...assign(1)[0]!].sort());
  });
});
