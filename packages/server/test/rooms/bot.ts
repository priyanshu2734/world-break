import {
  cloneBody, stepBody, type Arena, type GamePlayer, type InputIntent, type PlayerBody, type StageState,
} from '@wb/shared';
import type { Room } from '../../src/room';
import { strictGraph as platformGraph } from '../../src/rooms/reachStrict';
import { piecesOf } from '../../src/salvage/dropRest';
import type { EscapeResult } from '../../src/rooms/escape';

const NEUTRAL: InputIntent = { moveX: 0, jump: false };
type Rect = Arena['solids'][number];

/** The whole team of a Room under test. One call to `tick` advances the real room by one server tick. */
export class Team {
  /** The number of the last input this Team sent. (P3F step 1: public, so the solver can start a later stage's Team after the numbers the room has already seen, which it drops.) */
  seq = 0;
  /** P3F step 1: ticks played by this Team (the solver uses it to time a lone player's run between two switches). */
  ticks = 0;
  latest: StageState | null = null;
  readonly notes: { id: string; text: string }[] = [];
  constructor(readonly room: Room, readonly arenaOf: (roomId: string) => Arena) {}

  /** Everybody sends their input for this tick (neutral when absent), then the room ticks. */
  tick(inputs: Readonly<Record<string, InputIntent>> = {}): void {
    for (const p of this.room.gameSnapshot()?.players ?? []) this.room.submitInput(p.id, ++this.seq, inputs[p.id] ?? NEUTRAL);
    this.room.tick();
    this.ticks++;
    this.latest = this.room.consumeStageState() ?? this.latest;
  }
  idle(ticks: number): void { for (let i = 0; i < ticks; i++) this.tick(); }
  player(id: string): GamePlayer { return this.room.gameSnapshot()!.players.find((p) => p.id === id)!; }
  roomOf(id: string): string | undefined { return this.player(id).roomId; }
  body(id: string): PlayerBody {
    const p = this.player(id);
    return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded, facing: p.facing };
  }
  /** A fresh public stage state (the room only hands one out when something changed, so keep the last). */
  state(): StageState { this.latest = this.room.consumeStageState() ?? this.latest; return this.latest!; }
  /** Escape intent, keeping any note a clue gave back. */
  escape(id: string, a: Parameters<Room['escapeAction']>[1]): EscapeResult {
    const r = this.room.escapeAction(id, a);
    if (r.ok && r.note) this.notes.push(r.note);
    return r;
  }
  /** Tick until the player is in `roomId` (or give up). */
  waitForRoom(id: string, roomId: string, maxTicks = 60): void {
    for (let i = 0; i < maxTicks && this.roomOf(id) !== roomId; i++) this.tick();
  }
}

/** The surface the body stands on. The body is 28 px wide and is supported while ANY part of it overlaps the surface, like the sim. */
const surfaceUnder = (a: Arena, b: PlayerBody): Rect | undefined => a.solids.find((s) => Math.abs(s.y - b.y) < 1.5 && b.x + 14 > s.x && b.x - 14 < s.x + s.w);

/**
 * Looks ahead with the REAL movement function (`stepBody`) for a jump from this exact body state that lands on `target`.
 * Returns the inputs to feed, or null. Because the simulation is deterministic and exact, what it finds is what will happen.
 */
export function planHop(start: PlayerBody, arena: Arena, target: Rect): InputIntent[] | null {
  for (const d of [1, -1] as const) {
    for (let run = 0; run <= 70; run++) {
      for (const air of [d, 0] as const) {
        for (const hold of [8, 16, 24, 36, 60]) {
          const inputs: InputIntent[] = [];
          for (let i = 0; i < run; i++) inputs.push({ moveX: d, jump: false });
          inputs.push({ moveX: d, jump: true });
          for (let i = 0; i < hold; i++) inputs.push({ moveX: air, jump: false });
          for (let i = 0; i < 80; i++) inputs.push(NEUTRAL);
          const b = cloneBody(start);
          let left = false;
          for (let i = 0; i < inputs.length; i++) {
            stepBody(b, inputs[i]!, arena);
            if (!b.grounded) left = true;
            if (left && b.grounded) {
              const on = arena.solids.find((s) => Math.abs(s.y - b.y) < 1.5 && b.x >= s.x && b.x <= s.x + s.w);
              if (on === target) return inputs.slice(0, i + 1);
              break;
            }
          }
        }
      }
    }
  }
  return null;
}

/** One player of a Team, driven by real input one tick at a time. */
export class Bot {
  constructor(private readonly team: Team, readonly id: string) {}
  private arena(): Arena { return this.team.arenaOf(this.team.roomOf(this.id)!); }
  private act(input: InputIntent): void { this.team.tick({ [this.id]: input }); }

  /** Walk, fall and jump (real physics) until standing on the surface at height `y` within `tol` px of `x`. */
  goTo(x: number, y: number, tol = 20, maxTicks = 3000): void {
    const tried = new Set<Rect>();
    let plan: InputIntent[] = [];
    // P3F step 1: rooms have walls, crates, pits and ledges at many heights, so the way to a goal on another platform is PLANNED over the real platform graph (the
    // physics-built one the validators use): the route is a list of platforms, each step a hop found by `planHop` with the real movement function. The old greedy rules
    // below remain the fallback when the graph knows no route.
    let routeKey = '', spotTry = 0, walkTo: number | null = null;
    for (let n = 0; n < maxTicks; n++) {
      if (this.team.room.phase !== 'playing') return; // the stage ended (cleared) while walking
      const b = this.team.body(this.id), arena = this.arena();
      if (plan.length > 0) { this.act(plan.shift()!); continue; }
      const here = b.grounded ? surfaceUnder(arena, b) : undefined;
      // P4 step 5: a body can stand up to 14 px beyond a platform's edge (the landing slack), so a goal that close to the edge IS on it; aim at the nearest point of the platform
      const goal = arena.solids.find((s) => Math.abs(s.y - y) < 1.5 && x >= s.x - 14 && x <= s.x + s.w + 14);
      if (!goal) throw new Error(`no surface at (${x}, ${y}) in ${this.team.roomOf(this.id)}`);
      x = Math.min(Math.max(x, goal.x), goal.x + goal.w);
      if (b.grounded && here === goal && Math.abs(b.x - x) <= tol) { this.act(NEUTRAL); return; }
      // (the arena is cut into pieces where a crate or wall stands on a platform: a floor with a crate on it is two floors and the crate, so crossing it is a hop)
      const pa = piecesOf(arena).arena;
      const hereP = b.grounded ? surfaceUnder(pa, b) : undefined;
      const goalP = pa.solids.find((s) => Math.abs(s.y - y) < 1.5 && x >= s.x - 14 && x <= s.x + s.w + 14);
      if (b.grounded && hereP && goalP && hereP !== goalP) {
        const route = routeOver(pa, hereP, goalP);
        if (route && route.length > 1) {
          const next = route[1]!;
          const key = `${pa.solids.indexOf(hereP)}>${pa.solids.indexOf(next)}`;
          if (key !== routeKey) { routeKey = key; spotTry = 0; walkTo = null; }
          // walking to a run-up spot: no planning on the way (a plan is a search of thousands of simulated jumps), only on arrival
          if (walkTo !== null) {
            if (Math.abs(b.x - walkTo) > 2) { this.act({ moveX: Math.max(-1, Math.min(1, (walkTo - b.x) / 13)), jump: false }); continue; }
            walkTo = null;
            this.act(NEUTRAL);
            continue;
          }
          const hop = planHop(b, pa, next);
          if (hop) { plan = hop; continue; }
          // no hop from where we stand: walk to the far end of this platform (a run-up), then to its near edge, and look again from each
          // run-up spots: a little way back from where the next platform lies (the plan may itself run up to about 900 px), kept clear of the platform's ends
          const toward = Math.sign(next.x + next.w / 2 - (hereP.x + hereP.w / 2)) || 1;
          const anchor = Math.min(Math.max(next.x + next.w / 2, hereP.x), hereP.x + hereP.w);
          const lo = Math.min(hereP.x + 18, hereP.x + hereP.w / 2), hi = Math.max(hereP.x + hereP.w - 18, hereP.x + hereP.w / 2);
          const spots = [...new Set([250, 400, 120, 520, 0, 650, -150].map((off) => Math.round(Math.min(Math.max(anchor - toward * off, lo), hi))))];
          if (spotTry < spots.length) { walkTo = spots[spotTry++]!; continue; }
        }
      }
      if (!b.grounded || !here || here === goal || goal.y >= here.y) {
        // same surface, or the goal is level or below: walk toward it (walking off an edge is a fall)
        let aimX = x;
        // the goal is right under the platform we stand on: walk off its nearer edge first
        if (b.grounded && here && here !== goal && goal.y > here.y && x >= here.x - 20 && x <= here.x + here.w + 20) { // P4: +-20 = the body overhangs an edge, so a goal just outside it is still "under" the platform
          aimX = Math.abs(b.x - (here.x - 20)) <= Math.abs(b.x - (here.x + here.w + 20)) ? here.x - 20 : here.x + here.w + 20;
        }
        // in the air keep going the way we were going (turning back in mid-fall can land us right back where we left)
        const dir = !b.grounded && b.vx !== 0 ? Math.sign(b.vx) : Math.abs(b.x - aimX) <= 4 ? 0 : Math.sign(aimX - b.x);
        this.act({ moveX: dir, jump: false });
        continue;
      }
      // the goal is higher: hop to the surface that gets closest to it
      const near = (s: Rect) => Math.hypot(Math.max(s.x - x, 0, x - (s.x + s.w)), s.y - y);
      const options = arena.solids.filter((s) => s !== here && s.y < here.y && here.y - s.y <= 130 && !tried.has(s)).sort((p, q) => near(p) - near(q));
      let found: InputIntent[] | null = null;
      for (const s of options) { found = planHop(b, arena, s); if (found) { tried.clear(); break; } tried.add(s); }
      if (!found) {
        // no hop from here (typically: standing right under the platform). Step out to the nearer side of the nearest option and try again.
        const aim = options[0] ?? goal;
        const left = aim.x - 30, right = aim.x + aim.w + 30;
        const aimX = Math.abs(b.x - left) <= Math.abs(b.x - right) ? left : right;
        tried.clear();
        this.act({ moveX: Math.abs(aimX - b.x) < 4 ? 0 : Math.sign(aimX - b.x), jump: false });
        if (n > maxTicks - 5) throw new Error(`cannot reach (${x}, ${y})`);
        continue;
      }
      plan = found;
    }
    { const b = this.team.body(this.id); throw new Error(`goTo (${x}, ${y}) timed out for ${this.id} at (${Math.round(b.x)}, ${Math.round(b.y)}) in ${this.team.roomOf(this.id)} grounded=${b.grounded} route=${routeKey}`); }
  }
}

/** The platforms from `from` to `to` over the real platform graph (breadth first, ties by index), or null. Element 0 is `from`. */
function routeOver(arena: Arena, from: Rect, to: Rect): Rect[] | null {
  const g = platformGraph(arena), a = arena.solids.indexOf(from), z = arena.solids.indexOf(to);
  if (a < 0 || z < 0) return null;
  const prev = new Map<number, number>([[a, -1]]);
  const queue = [a];
  for (let q = 0; q < queue.length && !prev.has(z); q++) for (const n of [...(g.edges[queue[q]!] ?? [])].sort((p, r) => p - r)) if (!prev.has(n)) { prev.set(n, queue[q]!); queue.push(n); }
  if (!prev.has(z)) return null;
  const out: Rect[] = [];
  for (let c = z; c !== -1; c = prev.get(c)!) out.push(arena.solids[c]!);
  return out.reverse();
}
