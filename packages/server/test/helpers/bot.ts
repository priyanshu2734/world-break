import { ARENA, MOVE_SPEED, PLAYER_WIDTH, TICK_DT, spawnBody, stepBody, type StageAction } from '@wb/shared';
import type { Room } from '../../src/room';

/**
 * A lockstep bot that plays through the REAL server code path (Room -> GameSim -> StageEngine).
 * Navigation edges are discovered by probing the shared movement function, so reachability is a
 * property of the actual physics, not of hand-written waypoints.
 */
export type Intent = { moveX: number; jump: boolean };
export type Script = Generator<Intent | null, void, void>;
export interface Body { x: number; y: number; grounded: boolean }

const HW = PLAYER_WIDTH / 2;
const STEP_PX = MOVE_SPEED * TICK_DT;

function platformUnder(b: Body): number {
  if (!b.grounded) return -1;
  return ARENA.solids.findIndex((s) => Math.abs(b.y - s.y) < 1e-6 && b.x + HW > s.x && b.x - HW < s.x + s.w);
}

interface Edge { from: number; to: number; takeoffX: number; dir: 1 | -1; jump: boolean; ticks: number }
const EDGES: Edge[] = (() => {
  const out: Edge[] = [];
  ARENA.solids.forEach((r, from) => {
    for (let sx = r.x + 4; sx <= r.x + r.w - 4; sx += 6) for (const dir of [-1, 1] as const) for (const jump of [true, false]) {
      const b = spawnBody(sx, r.y);
      for (let t = 0; t < 60; t++) {
        stepBody(b, { moveX: dir, jump: jump && t === 0 });
        const to = platformUnder(b);
        if (to >= 0 && to !== from) { out.push({ from, to, takeoffX: sx, dir, jump, ticks: t + 1 }); break; }
      }
    }
  });
  return out;
})();

/** Hop distance from every platform to `target` over the discovered edges. */
function hopsTo(target: number): number[] {
  const d = ARENA.solids.map(() => Infinity);
  d[target] = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const e of EDGES) if (d[e.to]! + 1 < d[e.from]!) { d[e.from] = d[e.to]! + 1; changed = true; }
  }
  return d;
}

export function* walkTo(get: () => Body, x: number): Script {
  for (let i = 0; i < 400; i++) {
    const dx = x - get().x;
    if (Math.abs(dx) < 0.02) return;
    yield { moveX: Math.max(-1, Math.min(1, dx / STEP_PX)), jump: false };
  }
  throw new Error(`walkTo(${x}) did not converge`);
}

export function* goTo(get: () => Body, x: number, y: number): Script {
  const target = ARENA.solids.findIndex((s) => s.y === y && x >= s.x && x <= s.x + s.w);
  if (target < 0) throw new Error(`no platform at (${x},${y})`);
  const hops = hopsTo(target);
  for (let guard = 0; guard < 12; guard++) {
    for (let w = 0; w < 60 && !get().grounded; w++) yield null; // let a fall finish
    const b = get();
    const cur = platformUnder(b);
    if (cur === target) { yield* walkTo(get, x); return; }
    const options = EDGES.filter((e) => e.from === cur && hops[e.to]! === hops[cur]! - 1);
    if (!options.length) throw new Error(`no route from platform ${cur} to ${target}`);
    const e = options.reduce((best, o) => (Math.abs(o.takeoffX - b.x) < Math.abs(best.takeoffX - b.x) ? o : best));
    yield* walkTo(get, e.takeoffX);
    for (let t = 0; t < e.ticks; t++) yield { moveX: e.dir, jump: e.jump && t === 0 };
    yield null;
  }
  throw new Error('goTo did not arrive');
}

export function* wait(n: number): Script { for (let i = 0; i < n; i++) yield null; }

/** Drives a room one tick at a time; every scripted player submits exactly one input per tick. */
export class Lockstep {
  private seq = new Map<string, number>();
  ticks = 0;
  constructor(readonly room: Room) {}

  body = (id: string): Body => {
    const p = this.room.gameSnapshot()!.players.find((x) => x.id === id)!;
    return { x: p.x, y: p.y, grounded: p.grounded };
  };
  state = () => this.room.peekStageState()!;

  tick(inputs: Map<string, Intent | null> = new Map()) {
    for (const [id, i] of inputs) {
      const n = this.seq.get(id) ?? 0;
      this.seq.set(id, n + 1);
      this.room.submitInput(id, n, i ?? { moveX: 0, jump: false });
    }
    this.room.tick();
    this.ticks++;
  }

  /** Runs scripts in parallel until all finish. Returns ticks elapsed. */
  run(scripts: Record<string, Script>, maxTicks = 6000): number {
    const start = this.ticks;
    const live = new Map(Object.entries(scripts));
    while (live.size) {
      if (this.ticks - start > maxTicks) throw new Error('script timeout');
      const inputs = new Map<string, Intent | null>();
      for (const [id, s] of [...live]) {
        const n = s.next();
        if (n.done) { live.delete(id); continue; }
        inputs.set(id, n.value);
      }
      this.tick(inputs);
    }
    return this.ticks - start;
  }

  /** Performs a stage action now and fails loudly if the server refuses it. */
  do(id: string, a: StageAction) {
    const r = this.room.stageAction(id, a);
    if (!r.ok) throw new Error(`${a.kind} ${JSON.stringify(a)} refused: ${r.error}`);
    return r;
  }
}

export function* waitUntil(sim: Lockstep, pred: () => boolean, max = 600): Script {
  for (let i = 0; i < max && !pred(); i++) yield null;
  if (!pred()) throw new Error('waitUntil timed out');
}
