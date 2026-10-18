import {
  ABILITY_LAB_ARENA, ABILITY_MIN_GAP_TICKS, MOVE_SPEED, PLAYER_WIDTH, TICK_DT, spawnBody, stepBody, type AbilityAction, type Arena,
} from '@wb/shared';
import { Room } from '../../src/room';
import { Lockstep, wait, waitUntil, type Body, type Script } from './bot';

/**
 * Real-physics solver for the Ability Lab (P3B). Like the P2 bot it plays through the REAL server path
 * (Room -> GameSim -> PhysicsWorld -> StageEngine), one input per tick per player, and navigates with edges discovered by
 * probing the shared movement function on the Lab's own arena. The only hand-written physics knowledge is the station
 * scripts below (where to stand, which ability to cast at what point).
 */
const HW = PLAYER_WIDTH / 2;
const STEP_PX = MOVE_SPEED * TICK_DT;

export interface Edge { from: number; to: number; takeoffX: number; dir: 1 | -1; jump: boolean; ticks: number }

export function makeNav(arena: Arena) {
  const platformUnder = (b: Body): number =>
    b.grounded ? arena.solids.findIndex((s) => Math.abs(b.y - s.y) < 1e-6 && b.x + HW > s.x && b.x - HW < s.x + s.w) : -1;

  const edges: Edge[] = [];
  arena.solids.forEach((r, from) => {
    for (let sx = r.x + 4; sx <= r.x + r.w - 4; sx += 6) for (const dir of [-1, 1] as const) for (const jump of [true, false]) {
      const b = spawnBody(sx, r.y);
      for (let t = 0; t < 60; t++) {
        stepBody(b, { moveX: dir, jump: jump && t === 0 }, arena);
        const to = platformUnder(b);
        if (to >= 0 && to !== from) { edges.push({ from, to, takeoffX: sx, dir, jump, ticks: t + 1 }); break; }
      }
    }
  });

  const hopsTo = (target: number): number[] => {
    const d = arena.solids.map(() => Infinity);
    d[target] = 0;
    for (let changed = true; changed;) {
      changed = false;
      for (const e of edges) if (d[e.to]! + 1 < d[e.from]!) { d[e.from] = d[e.to]! + 1; changed = true; }
    }
    return d;
  };

  /** Platforms a player can reach from `from` by walking and jumping alone (no abilities). */
  const reachableFrom = (from: number): Set<number> => {
    const seen = new Set<number>([from]);
    for (let changed = true; changed;) {
      changed = false;
      for (const e of edges) if (seen.has(e.from) && !seen.has(e.to)) { seen.add(e.to); changed = true; }
    }
    return seen;
  };

  function* walkTo(get: () => Body, x: number): Script {
    for (let i = 0; i < 400; i++) {
      const dx = x - get().x;
      if (Math.abs(dx) < 0.02) return;
      yield { moveX: Math.max(-1, Math.min(1, dx / STEP_PX)), jump: false };
    }
    throw new Error(`walkTo(${x}) did not converge`);
  }

  function* goTo(get: () => Body, x: number, y: number): Script {
    const target = arena.solids.findIndex((s) => s.y === y && x >= s.x && x <= s.x + s.w);
    if (target < 0) throw new Error(`no platform at (${x},${y})`);
    const hops = hopsTo(target);
    for (let guard = 0; guard < 14; guard++) {
      for (let w = 0; w < 60 && !get().grounded; w++) yield null;
      const b = get();
      const cur = platformUnder(b);
      if (cur === target) { yield* walkTo(get, x); return; }
      const options = edges.filter((e) => e.from === cur && hops[e.to]! === hops[cur]! - 1);
      if (!options.length) throw new Error(`no route from platform ${cur} to ${target}`);
      const e = options.reduce((best, o) => (Math.abs(o.takeoffX - b.x) < Math.abs(best.takeoffX - b.x) ? o : best));
      yield* walkTo(get, e.takeoffX);
      for (let t = 0; t < e.ticks; t++) yield { moveX: e.dir, jump: e.jump && t === 0 };
      yield null;
    }
    throw new Error('goTo did not arrive');
  }

  return { edges, hopsTo, reachableFrom, platformUnder, walkTo, goTo };
}
export type Nav = ReturnType<typeof makeNav>;

// ------------------------------------------------------------------------------------------------ stations
export type Station = 'charge' | 'anchor' | 'freeze' | 'well' | 'momentum' | 'dup';
/** Order matters for ONE player: repairs must come after the spends, because the meter is capped at 100. */
export const STATION_ORDER: readonly Station[] = ['well', 'momentum', 'dup', 'charge', 'anchor', 'freeze'];
export const STATION_OBJECTIVE: Record<Station, string> = {
  charge: 'o_charge', anchor: 'o_anchor', freeze: 'o_freeze', well: 'o_well', momentum: 'o_momentum', dup: 'o_dup',
};

export function* useAbility(sim: Lockstep, id: string, a: AbilityAction): Script {
  yield* wait(ABILITY_MIN_GAP_TICKS);
  const r = sim.room.abilityAction(id, a);
  if (!r.ok) throw new Error(`ability ${a.ability} refused for ${id}: ${r.error}`);
}

const done = (sim: Lockstep, oid: string) => () => sim.state().objectives.find((o) => o.id === oid)?.status === 'complete';

export function* station(name: Station, sim: Lockstep, id: string, nav: Nav): Script {
  const get = () => sim.body(id);
  switch (name) {
    case 'charge':
      yield* nav.goTo(get, 350, 590);
      yield* wait(4); sim.do(id, { kind: 'use_tool', tool: 'phase_scanner' });
      yield* wait(4); sim.do(id, { kind: 'use_tool', tool: 'flux_welder', targetId: 'bp_cap_a' });
      yield* waitUntil(sim, done(sim, 'o_charge'), 300);
      return;
    case 'anchor':
      yield* nav.goTo(get, 420, 590);
      yield* wait(4); sim.do(id, { kind: 'use_tool', tool: 'gravity_anchor' });
      yield* wait(4); sim.do(id, { kind: 'interact', targetId: 'core_anchor' });
      yield* waitUntil(sim, done(sim, 'o_anchor'), 300);
      return;
    case 'freeze':
      yield* nav.goTo(get, 720, 680);
      yield* useAbility(sim, id, { ability: 'freeze', targetId: 'hz_arc' });
      yield* wait(3); sim.do(id, { kind: 'interact', targetId: 'core_freeze' });
      yield* waitUntil(sim, done(sim, 'o_freeze'), 120);
      return;
    case 'well': {
      yield* nav.goTo(get, 1200, 500);
      yield* useAbility(sim, id, { ability: 'gravity_well', x: 1130, y: 340, mode: 'flip' });
      // Float up beside the ledge, then steer left over it and land.
      for (let t = 0; t < 200; t++) {
        const b = get();
        if (b.grounded && Math.abs(b.y - 140) < 0.01) break;
        yield { moveX: b.y > 120 && t < 90 ? 0 : -1, jump: false };
      }
      yield* nav.walkTo(get, 1080);
      yield* waitUntil(sim, done(sim, 'o_well'), 60);
      return;
    }
    case 'momentum':
      yield* nav.goTo(get, 420, 400);
      yield* useAbility(sim, id, { ability: 'momentum', targetId: 'crate_m', dir: 'left' });
      yield* waitUntil(sim, done(sim, 'o_momentum'), 240);
      return;
    case 'dup':
      yield* nav.goTo(get, 950, 590);
      yield* useAbility(sim, id, { ability: 'duplicate', targetId: 'crate_d', x: 1060, y: 570 });
      yield* waitUntil(sim, done(sim, 'o_dup'), 120);
      return;
  }
}

/** Which stations each player takes. One player takes all in STATION_ORDER; more players deal them out in turn. */
export function assign(players: number, skip: readonly Station[] = []): Station[][] {
  const out: Station[][] = Array.from({ length: players }, () => []);
  STATION_ORDER.filter((s) => !skip.includes(s)).forEach((s, i) => out[i % players]!.push(s));
  return out;
}

export function labRoom(players: number, seed = 4242): { room: Room; ids: string[] } {
  const room = new Room('LABX', 2, seed, { lab: true });
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => room.join(id, `P${i}`));
  ids.slice(1).forEach((id) => room.setReady(id, true));
  if (!room.start('p0').ok) throw new Error('lab start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  return { room, ids };
}

export interface LabRun { ticks: number; room: Room; sim: Lockstep; ids: string[] }

/** Plays the Lab with `players` bots, optionally skipping stations. Throws if any script is refused by the server. */
export function playLab(players: number, opts: { skip?: readonly Station[]; maxTicks?: number; extraTicks?: number } = {}): LabRun {
  const { room, ids } = labRoom(players);
  const sim = new Lockstep(room);
  const nav = makeNav(ABILITY_LAB_ARENA);
  const plan = assign(players, opts.skip);
  const scripts: Record<string, Script> = {};
  ids.forEach((id, i) => {
    scripts[id] = (function* (): Script { for (const s of plan[i]!) yield* station(s, sim, id, nav); })();
  });
  const ticks = sim.run(scripts, opts.maxTicks ?? 9000);
  for (let i = 0; i < (opts.extraTicks ?? 3); i++) sim.tick(new Map());
  return { ticks, room, sim, ids };
}
