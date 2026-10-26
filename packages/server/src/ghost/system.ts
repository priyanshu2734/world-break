import {
  CATCH_LIMITS, EYE_HEIGHT, GHOST_LIMITS, cueBand, cueDir, GHOST_TRANSITIONS, MAX_GHOSTS, NOISE_KIND_LOUDNESS, NOISE_LOUDNESS, NOISE_MUFFLE,
  angleDiff, createRng, deriveSeed, gaitOf, ghostTuning, hasLineOfSight, occluders, pointVisible,
  type Box, type Difficulty, type GhostCueSound, type GhostPublic, type GhostState, type GhostTuning, type GhostType, type RoomDef, type RoomGraph, type Rng,
} from '@wb/shared';
import { NavGrid, type Pt } from './nav';
import type { GhostCatchEvent, GhostEvent, GhostHost, GhostPlayer, HidingSpotDef } from './types';

/**
 * P3E: the ghost. Server-authoritative and deterministic in (stage, seed, tick): it never reads a clock, `Math.random` or the order of anything
 * but the players' slots, and every random choice comes from a per-ghost seeded generator.
 *
 * One `GhostSystem` runs one stage. It holds up to `MAX_GHOSTS` ghosts (one per type), each with its own state machine
 *
 *   DORMANT -> WARNING -> ROAMING <-> HUNTING -> RESPAWN -> WARNING ...        (a Pulse Gun hit: ROAMING/HUNTING -> STUNNED -> RESPAWN)
 *
 * and logs every transition and every reason ("heard Ada running", "saw Ada") as events, so any catch can be explained from the log.
 * Fairness is enforced in this file and proved by test/ghost/*: warning before every appearance, no spawn in view / near a player / in an
 * arrival area, speed under 95 percent of the sprint, doors take time, hidden players are not seen, locked doors are never passed.
 */

export interface GhostConfig {
  stage: number;
  /** The stage seed; the ghost derives its own seeds from it. */
  seed: number;
  difficulty: Difficulty;
  graph: RoomGraph;
  /** Vision reach in px of the stage (`visionRadius`): a spawn point must be outside every player's view. */
  visionRadius: number;
  /** Which ghost types run (at most `MAX_GHOSTS`). */
  types: readonly GhostType[];
  /** P3E step 3: the hiding places of the stage. A ghost that reaches the place of a noise may check one near it. Absent = none. */
  hidingSpots?: readonly HidingSpotDef[];
}

interface Noise { room: string; x: number; y: number; loud: number; player: string; name: string; label: string; gait: 'run' | 'walk' | 'sneak' | 'drop' | 'door' | 'shot'; tick: number; door?: string }
interface Goal { room: string; x: number; y: number; door?: string; inspect?: string }
interface Seen { room: string; x: number; y: number; tick: number }

interface Actor {
  id: string;
  kind: GhostType;
  rng: Rng;
  state: GhostState;
  since: number;
  /** Timer of the current state (dormant, warning, respawn, stunned): the tick it ends. */
  until: number;
  warnedAt: number;
  blockedLogged: boolean;
  present: boolean;
  room: string;
  x: number;
  y: number;
  angle: number;
  path: number[];
  pathGoal: number;
  lastPlan: number;
  goal: Goal | null;
  patrol: Pt | null;
  searchUntil: number;
  searchStart: number;
  searchBase: number;
  opening: { door: string; until: number } | null;
  activeUntil: number;
  quarry: string | null;
  lastSeen: Seen | null;
  chain: string[];
  lastHeardLog: number;
  /** Moved during the last tick (for the footsteps a listener hears). */
  moving: boolean;
  /** Standing at a hiding spot, about to open it (P3E step 3). */
  inspect: { spot: string; until: number } | null;
}

const DOOR_REACH = 80;
const ARRIVED = 40;
const TURN_PER_TICK = 0.3;
/** How high a ghost hovers above the floor it stands over (px): body centre of the "floating" spawn and door arrival. */
const HOVER = 56;
const BODY_CENTRE = 22; // a player's body centre above the feet (half of PLAYER_HEIGHT)

const r2 = (n: number) => Math.round(n * 100) / 100;
const label = (g: 'run' | 'walk' | 'sneak' | 'drop' | 'door' | 'shot') => (g === 'run' ? 'running' : g === 'walk' ? 'walking' : g === 'sneak' ? 'sneaking' : g === 'drop' ? 'dropping something' : g === 'shot' ? 'a shot' : 'a door');

export class GhostSystem {
  readonly tuning: GhostTuning;
  private readonly actors: Actor[] = [];
  private readonly grids = new Map<string, NavGrid>();
  private readonly roomsById = new Map<string, RoomDef>();
  private readonly arrivals = new Map<string, Pt[]>();
  private readonly groundCells = new Map<string, number[]>();
  private readonly log: GhostEvent[] = [];
  private pending: GhostEvent[] = [];
  private readonly lastNoise = new Map<string, Noise>();
  private readonly spotsById = new Map<string, HidingSpotDef>();
  private readonly lastInspect = new Map<string, number>();
  private readonly prevPos = new Map<string, { room: string; x: number; y: number }>();
  // per-tick caches
  private occCache = new Map<string, Box[]>();
  private edgeCache: { open: ReadonlySet<string>; edges: DoorEdge[] } | null = null;

  constructor(private readonly cfg: GhostConfig, private readonly host: GhostHost) {
    this.tuning = ghostTuning(cfg.difficulty, cfg.stage);
    for (const h of cfg.hidingSpots ?? []) this.spotsById.set(h.id, h);
    for (const r of cfg.graph.rooms) {
      this.roomsById.set(r.id, r);
      const grid = new NavGrid(r);
      this.grids.set(r.id, grid);
      const ground: number[] = [];
      for (let i = 0; i < grid.size; i++) {
        if (grid.isFree(i) && (!grid.isFree(i + grid.cols) || !grid.isFree(i + 2 * grid.cols)) && Math.floor(i / grid.cols) + 2 < grid.rows) ground.push(i);
      }
      this.groundCells.set(r.id, ground);
      this.arrivals.set(r.id, [...r.arena.spawns]);
    }
    for (const r of cfg.graph.rooms) for (const d of r.doors) this.arrivals.get(d.to)?.push({ x: d.arrive.x, y: d.arrive.y });
    const types = cfg.types.slice(0, MAX_GHOSTS);
    types.forEach((kind, index) => {
      const rng = createRng(deriveSeed(cfg.seed, 'ghost', kind, index));
      const interval = this.tuning.intervalTicks;
      // the first appearance is never immediate (a seeded 60 to 100 percent of the interval) and the second type comes half an interval later
      const first = Math.floor(interval * (GHOST_LIMITS.firstAppearanceMinShare + (1 - GHOST_LIMITS.firstAppearanceMinShare) * rng.next())) + Math.floor((index * interval) / 2);
      this.actors.push({
        id: `g${index}`, kind, rng, state: 'dormant', since: 0, until: first, warnedAt: -1, blockedLogged: false, present: false,
        room: cfg.graph.start, x: 0, y: 0, angle: 0, path: [], pathGoal: -1, lastPlan: -100, goal: null, patrol: null,
        searchUntil: 0, searchStart: 0, searchBase: 0, opening: null, activeUntil: 0, quarry: null, lastSeen: null, chain: [], lastHeardLog: -1000, moving: false, inspect: null,
      });
    });
  }

  // ------------------------------------------------------------------------------------------------------- queries
  /** The events logged so far (a ring of at most `GHOST_LIMITS.maxLogEvents`). Read-only. */
  get events(): readonly GhostEvent[] { return this.log; }
  /** Events logged since the last call (for a consumer that forwards them, e.g. the future death review). */
  drainEvents(): GhostEvent[] { const p = this.pending; this.pending = []; return p; }
  /** Ghost states, for tests and debug displays (server side only). */
  snapshotActors(): { id: string; kind: GhostType; state: GhostState; present: boolean; room: string; x: number; y: number; angle: number; until: number }[] {
    return this.actors.map((a) => ({ id: a.id, kind: a.kind, state: a.state, present: a.present, room: a.room, x: a.x, y: a.y, angle: a.angle, until: a.until }));
  }
  /** True while ANY ghost is in its WARNING (the lights flicker for everyone). */
  get warning(): boolean { return this.actors.some((a) => a.state === 'warning'); }
  /** The ghosts that are PRESENT (roaming, hunting or stunned), as public data. The view code decides who is told about which. */
  publicGhosts(): GhostPublic[] {
    const out: GhostPublic[] = [];
    for (const a of this.actors) {
      if (!a.present || (a.state !== 'roaming' && a.state !== 'hunting' && a.state !== 'stunned')) continue;
      out.push({ id: a.id, kind: a.kind, x: r2(a.x), y: r2(a.y), angle: r2(a.angle), state: a.state, room: a.room });
    }
    return out;
  }

  /**
   * What a listener at (x, y) in `roomId` can HEAR (the documented exception to the visibility invariant, see shared `GHOST_CUE`): the ghosts of that
   * room within earshot as a distance bucket and a direction, and whether any ghost is in its warning. No coordinates leave this function.
   */
  cueFor(roomId: string | null, x: number, y: number): { warning: boolean; sounds: GhostCueSound[] } {
    const sounds: GhostCueSound[] = [];
    if (roomId !== null) {
      for (const a of this.actors) {
        if (!a.present || a.room !== roomId || (a.state !== 'roaming' && a.state !== 'hunting' && a.state !== 'stunned')) continue;
        const band = cueBand(Math.hypot(a.x - x, a.y - (y - BODY_CENTRE)));
        if (band === 0) continue;
        sounds.push({ id: a.id, kind: a.kind, band, dir: cueDir(a.x - x), state: a.state, moving: a.moving, ...(a.inspect ? { inspecting: true } : {}) });
      }
    }
    return { warning: this.warning, sounds };
  }

  /**
   * Is a ghost hunting this player AND has it seen them within the last second? (Then they cannot duck into a hiding place: the ghost is watching.)
   * It is the same fact the hunt itself runs on (`lastSeen`), nothing is guessed.
   */
  watching(playerId: string): boolean {
    const t = this.host.tick;
    return this.actors.some((a) => a.present && a.state === 'hunting' && a.quarry === playerId && a.lastSeen !== null && t - a.lastSeen.tick <= 20);
  }

  // ------------------------------------------------------------------------------------------------------- inputs from the world
  /** A sound (an item dropped, a door used, a scream): every present ghost in that room that can hear it investigates. */
  makeNoise(n: { room: string; x: number; y: number; loud: number; player: string; name: string; kind: 'drop' | 'door' | 'shot'; door?: string }): void {
    this.emitNoise({ room: n.room, x: n.x, y: n.y, loud: n.loud, player: n.player, name: n.name, label: label(n.kind), gait: n.kind, tick: this.host.tick, ...(n.door ? { door: n.door } : {}) });
  }

  /**
   * P3E step 4: trace a Pulse Gun bolt over one tick, from `from` to `to` in `room`. The bolt ends at a wall or a closed door, and touches the first ghost
   * (roaming, hunting or stunned: a body in the room) whose centre lies within `radius` of the segment AND that the bolt can reach without crossing a wall.
   * A ghost that is absent (dormant, in its warning, respawning) is not in the room and is never touched.
   */
  trace(room: string, from: Pt, to: Pt, radius: number): { hit: string | null; blocked: boolean } {
    const open = this.host.openDoorIds();
    const occ = this.roomsById.has(room) ? this.occ(room, open) : [];
    let hit: string | null = null, hitD = Infinity;
    const dx = to.x - from.x, dy = to.y - from.y, len2 = dx * dx + dy * dy;
    for (const a of this.actors) {
      if (!a.present || a.room !== room || (a.state !== 'roaming' && a.state !== 'hunting' && a.state !== 'stunned')) continue;
      const u = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((a.x - from.x) * dx + (a.y - from.y) * dy) / len2));
      const px = from.x + u * dx, py = from.y + u * dy;
      if (Math.hypot(a.x - px, a.y - py) > radius) continue;
      if (!hasLineOfSight(from, { x: px, y: py }, occ)) continue;
      const d = Math.hypot(a.x - from.x, a.y - from.y);
      if (d < hitD) { hit = a.id; hitD = d; }
    }
    if (hit !== null) return { hit, blocked: false };
    return { hit: null, blocked: !hasLineOfSight(from, to, occ) };
  }

  /** P3E step 4: put a Pulse Gun event (fired, hit, stunned, absorbed, wall, miss) in the ghost log, so a shot can be explained like a catch. */
  logPulse(by: string, phase: 'fired' | 'hit' | 'stunned' | 'absorbed' | 'wall' | 'miss', room: string, text: string, ghost = ''): void {
    this.record({ tick: this.host.tick, ghost, kind: 'pulse', by, phase, room, text });
  }

  /** A Pulse Gun hit (P3E step 4 calls this). A ghost can be stunned only while ROAMING or HUNTING: never in its WARNING, never while absent. */
  stun(ghostId: string, by: string | null): boolean {
    const a = this.actors.find((x) => x.id === ghostId);
    if (!a || !a.present || (a.state !== 'roaming' && a.state !== 'hunting')) return false;
    const t = this.host.tick;
    this.go(a, 'stunned', 'hit by the Pulse Gun');
    a.until = t + this.tuning.stunTicks;
    this.record({ tick: t, ghost: a.id, kind: 'stun', by, until: a.until });
    return true;
  }

  /**
   * TEST AND DEV SEAM, never called by the game: put a ghost in a place of the test's choosing, skipping the spawn rules (the machine itself stays legal:
   * it walks dormant -> warning -> roaming, and logs it). The fairness tests use it to set up a situation; the spawn rules are tested through the real waves.
   */
  placeForTest(ghostId: string, at: { room: string; x: number; y: number; angle?: number; state?: 'roaming' | 'hunting' }): void {
    const a = this.actors.find((x) => x.id === ghostId);
    if (!a) throw new Error(`no ghost ${ghostId}`);
    if (a.state === 'dormant' || a.state === 'respawn') this.go(a, 'warning', 'placed for a test');
    if (a.state === 'warning') { a.present = true; this.go(a, 'roaming', 'placed for a test'); }
    a.present = true; a.room = at.room; a.x = at.x; a.y = at.y; a.angle = at.angle ?? 0;
    a.activeUntil = this.host.tick + GHOST_LIMITS.roamTicks; this.clearPlan(a); a.opening = null;
  }

  // ------------------------------------------------------------------------------------------------------- the tick
  /** Advance one tick. Call once per server tick, after the players have moved (the tick number is the host's). */
  step(): void {
    this.occCache = new Map();
    this.edgeCache = null;
    const t = this.host.tick;
    const players = this.host.players();
    const open = this.host.openDoorIds();
    this.observe(players, open, t);
    for (const a of this.actors) this.update(a, players, open, t);
  }

  private update(a: Actor, players: GhostPlayer[], open: ReadonlySet<string>, t: number): void {
    switch (a.state) {
      case 'dormant': if (t >= a.until) this.go(a, 'warning', 'the first interval elapsed'); break;
      case 'respawn': if (t >= a.until) this.go(a, 'warning', 'the interval elapsed'); break;
      case 'stunned': if (t >= a.until) this.go(a, 'respawn', 'the stun wore off'); break;
      case 'warning': if (t >= a.until) this.tryAppear(a, players, open, t); break;
      case 'roaming': case 'hunting': { const px = a.x, py = a.y; this.act(a, players, open, t); a.moving = Math.hypot(a.x - px, a.y - py) > 0.01 && !a.opening; break; }
    }
    if (a.state !== 'roaming' && a.state !== 'hunting') a.moving = false;
  }

  // ------------------------------------------------------------------------------------------------------- the state machine
  private go(a: Actor, to: GhostState, cause: string): void {
    if (!GHOST_TRANSITIONS[a.state].includes(to)) throw new Error(`ghost ${a.id}: illegal transition ${a.state} -> ${to}`);
    const t = this.host.tick;
    this.record({ tick: t, ghost: a.id, kind: 'state', from: a.state, to, cause });
    a.state = to; a.since = t;
    if (to === 'warning') { a.until = t + GHOST_LIMITS.warningTicks; a.warnedAt = t; a.present = false; a.blockedLogged = false; }
    if (to === 'respawn') { a.present = false; a.until = t + this.tuning.intervalTicks; this.clearPlan(a); a.quarry = null; a.lastSeen = null; a.chain = []; a.opening = null; }
    if (to === 'stunned') { this.clearPlan(a); a.opening = null; }
  }
  private clearPlan(a: Actor): void { a.path = []; a.pathGoal = -1; a.goal = null; a.patrol = null; a.searchUntil = 0; a.inspect = null; }

  private record(e: GhostEvent): void {
    this.log.push(e); this.pending.push(e);
    if (this.log.length > GHOST_LIMITS.maxLogEvents) this.log.splice(0, this.log.length - GHOST_LIMITS.maxLogEvents);
  }

  // ------------------------------------------------------------------------------------------------------- appearing (waves)
  private tryAppear(a: Actor, players: GhostPlayer[], open: ReadonlySet<string>, t: number): void {
    const spot = this.pickSpawn(a, players, open);
    if (!spot) {
      // no fair place exists right now: the warning simply goes on a little longer (it is never skipped)
      a.until = t + GHOST_LIMITS.spawnRetryTicks;
      if (!a.blockedLogged) { a.blockedLogged = true; this.record({ tick: t, ghost: a.id, kind: 'spawn_blocked', reason: 'no spawn point outside every view, distance and arrival rule' }); }
      return;
    }
    a.present = true; a.room = spot.room; a.x = spot.x; a.y = spot.y; a.angle = a.rng.next() * 2 * Math.PI - Math.PI;
    a.activeUntil = t + GHOST_LIMITS.roamTicks; a.chain = []; this.clearPlan(a);
    this.record({ tick: t, ghost: a.id, kind: 'spawn', room: spot.room, x: r2(spot.x), y: r2(spot.y), warnedAt: a.warnedAt });
    this.go(a, 'roaming', 'the warning ended');
    // "ROAMING (investigates the last noise)": a noise made in this room shortly before it appeared
    const n = this.lastNoise.get(spot.room);
    if (n && t - n.tick <= GHOST_LIMITS.freshNoiseTicks) this.hear(a, n, t, 'on appearing');
  }

  /** A fair spawn: a room that holds a player, a free floating point on that player's side, outside every view, far from every player, clear of the arrival areas. */
  private pickSpawn(a: Actor, players: GhostPlayer[], open: ReadonlySet<string>): { room: string; x: number; y: number } | null {
    const live = players.filter((p) => p.connected && !p.captured);
    const roomIds = [...new Set(live.map((p) => p.roomId))].filter((r) => this.roomsById.has(r));
    if (roomIds.length === 0) return null;
    const roomId = a.rng.pick(roomIds);
    const room = this.roomsById.get(roomId)!, grid = this.grids.get(roomId)!;
    const here = players.filter((p) => p.roomId === roomId && p.connected);
    const regions = new Set(live.filter((p) => p.roomId === roomId).map((p) => grid.label[grid.nearestFree({ x: p.x, y: p.y - BODY_CENTRE })]!));
    const arrivals = this.arrivals.get(roomId) ?? [];
    const out: { x: number; y: number }[] = [];
    for (const i of this.groundCells.get(roomId) ?? []) {
      if (!regions.has(grid.label[i]!)) continue;
      const c = grid.centre(i);
      if (arrivals.some((ap) => Math.hypot(c.x - ap.x, c.y - ap.y) < GHOST_LIMITS.arrivalSafeRadius)) continue;
      let ok = true;
      for (const p of here) {
        const eye = { x: p.x, y: p.y - EYE_HEIGHT };
        if (Math.hypot(c.x - p.x, c.y - (p.y - BODY_CENTRE)) < GHOST_LIMITS.minSpawnDistance || pointVisible(room, eye, c, open, this.cfg.visionRadius)) { ok = false; break; }
      }
      if (ok) out.push(c);
    }
    if (out.length === 0) return null;
    const c = a.rng.pick(out);
    return { room: roomId, x: c.x, y: c.y };
  }

  // ------------------------------------------------------------------------------------------------------- senses
  private occ(roomId: string, open: ReadonlySet<string>): Box[] {
    let o = this.occCache.get(roomId);
    if (!o) { o = occluders(this.roomsById.get(roomId)!, open); this.occCache.set(roomId, o); }
    return o;
  }

  /** Noise made by the players themselves this tick (the gait the server applied), and a door passage. */
  private observe(players: GhostPlayer[], open: ReadonlySet<string>, t: number): void {
    for (const p of players) {
      if (!p.connected || !this.roomsById.has(p.roomId)) continue;
      const prev = this.prevPos.get(p.id);
      if (prev && (prev.room !== p.roomId || Math.hypot(prev.x - p.x, prev.y - p.y) > 150)) this.doorPassage(p, prev, t);
      this.prevPos.set(p.id, { room: p.roomId, x: p.x, y: p.y });
      if (p.hidden || p.captured) continue;
      const gait = p.crouch ? 'still' : gaitOf(p.moveX);
      const loud = NOISE_LOUDNESS[gait];
      if (loud <= 0 || gait === 'still') continue;
      this.emitNoise({ room: p.roomId, x: p.x, y: p.y - BODY_CENTRE, loud, player: p.id, name: p.name, label: label(gait as 'run' | 'walk' | 'sneak'), gait: gait as 'run' | 'walk' | 'sneak', tick: t });
    }
    void open;
  }
  private doorPassage(p: GhostPlayer, prev: { room: string; x: number; y: number }, t: number): void {
    const from = this.roomsById.get(prev.room);
    if (!from) return;
    let best: RoomDef['doors'][number] | null = null, bestD = Infinity;
    for (const d of from.doors) {
      if (d.to !== p.roomId) continue;
      const dd = Math.hypot(d.x + d.w / 2 - prev.x, d.y + d.h - prev.y);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    if (!best || bestD > 200) return;
    this.emitNoise({ room: prev.room, x: best.x + best.w / 2, y: best.y + best.h - BODY_CENTRE, loud: NOISE_KIND_LOUDNESS.door, player: p.id, name: p.name, label: 'a door', gait: 'door', tick: t, door: best.id });
  }

  private emitNoise(n: Noise): void {
    if (n.loud >= NOISE_LOUDNESS.walk) this.lastNoise.set(n.room, n);
    const room = this.roomsById.get(n.room);
    if (!room) return;
    for (const a of this.actors) {
      if (!a.present || a.room !== n.room || a.state !== 'roaming') continue;
      const open = this.host.openDoorIds();
      const clear = hasLineOfSight({ x: a.x, y: a.y }, { x: n.x, y: n.y }, this.occ(n.room, open));
      const range = this.tuning.hearingPx * n.loud * (clear ? 1 : NOISE_MUFFLE);
      if (Math.hypot(a.x - n.x, a.y - n.y) <= range) this.hear(a, n, this.host.tick, '');
    }
  }

  private hear(a: Actor, n: Noise, t: number, when: string): void {
    a.goal = { room: n.room, x: n.x, y: n.y, ...(n.door ? { door: n.door } : {}) };
    a.searchUntil = 0; a.patrol = null; a.path = []; a.pathGoal = -1;
    const text = `Heard ${n.name} ${n.gait === 'door' ? 'use a door' : n.label}${when ? ' ' + when : ''} at tick ${n.tick}`;
    a.chain = [...a.chain.filter((c) => !c.startsWith('Heard ')), text].slice(-4);
    if (t - a.lastHeardLog >= 30) {
      a.lastHeardLog = t;
      this.record({ tick: t, ghost: a.id, kind: 'heard', player: n.player, room: n.room, x: r2(n.x), y: r2(n.y), loudness: n.loud, gait: n.gait === 'door' || n.gait === 'drop' ? n.gait : n.gait, text });
    }
  }

  /** Sight: a cone in front of the ghost, blocked by solids and closed doors; hidden and captured players are never seen. The nearest seen player, or null. */
  private sees(a: Actor, players: GhostPlayer[], open: ReadonlySet<string>): { p: GhostPlayer; d: number } | null {
    const half = a.state === 'hunting' ? GHOST_LIMITS.huntHalfAngle : GHOST_LIMITS.sightHalfAngle;
    let best: { p: GhostPlayer; d: number } | null = null;
    for (const p of players) {
      if (!p.connected || p.hidden || p.captured || p.roomId !== a.room) continue;
      const tx = p.x, ty = p.y - EYE_HEIGHT;
      const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (d > GHOST_LIMITS.sightRange) continue;
      if (d > 1 && Math.abs(angleDiff(Math.atan2(dy, dx), a.angle)) > half) continue;
      if (!hasLineOfSight({ x: a.x, y: a.y }, { x: tx, y: ty }, this.occ(a.room, open))) continue;
      if (!best || d < best.d) best = { p, d };
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------------------- acting
  private act(a: Actor, players: GhostPlayer[], open: ReadonlySet<string>, t: number): void {
    // a door being opened is finished (or cancelled) first
    if (a.opening) this.progressDoor(a, open, t);

    const seen = this.sees(a, players, open);
    if (a.state === 'roaming') {
      if (seen) this.startHunt(a, seen.p, seen.d, t);
      else if (t >= a.activeUntil && !a.goal && !a.opening && !a.inspect) { this.go(a, 'respawn', 'it faded after roaming without a hunt'); return; }
    } else if (seen) {
      // hunting: keep the quarry in sight (or switch to the nearest visible player)
      a.quarry = seen.p.id;
      a.lastSeen = { room: seen.p.roomId, x: seen.p.x, y: seen.p.y - BODY_CENTRE, tick: t };
    } else {
      const q = players.find((p) => p.id === a.quarry);
      if (!q || !q.connected || q.captured) { this.go(a, 'roaming', 'its quarry is gone'); a.activeUntil = t + GHOST_LIMITS.roamTicks / 2; a.quarry = null; return; }
      if (a.lastSeen && t - a.lastSeen.tick > GHOST_LIMITS.loseSightTicks) {
        this.record({ tick: t, ghost: a.id, kind: 'lost', player: q.id, text: `Lost ${q.name} at tick ${t}` });
        a.goal = { room: a.lastSeen.room, x: a.lastSeen.x, y: a.lastSeen.y };
        a.quarry = null; a.activeUntil = t + GHOST_LIMITS.roamTicks / 2;
        this.go(a, 'roaming', 'it lost sight of its quarry');
        this.clearPathOnly(a);
        return;
      }
    }

    if (a.state === 'hunting' && this.catchCheck(a, players, t)) return;
    if (a.inspect && a.state === 'roaming' && !a.opening) { this.inspecting(a, players, t); return; }
    if (!a.opening) this.move(a, open, t);
  }
  private clearPathOnly(a: Actor): void { a.path = []; a.pathGoal = -1; }

  private startHunt(a: Actor, p: GhostPlayer, d: number, t: number): void {
    a.quarry = p.id;
    a.lastSeen = { room: p.roomId, x: p.x, y: p.y - BODY_CENTRE, tick: t };
    a.goal = null; a.patrol = null; a.inspect = null; this.clearPathOnly(a);
    const text = `Saw ${p.name} at tick ${t}`;
    a.chain = [...a.chain.filter((c) => !c.startsWith('Saw ')), text].slice(-4);
    this.record({ tick: t, ghost: a.id, kind: 'sighted', player: p.id, distance: r2(d), text });
    this.go(a, 'hunting', `saw ${p.name}`);
  }

  private catchCheck(a: Actor, players: GhostPlayer[], t: number): boolean {
    for (const p of players) {
      if (!p.connected || p.captured || p.hidden || p.roomId !== a.room) continue;
      if (Math.hypot(a.x - p.x, a.y - (p.y - BODY_CENTRE)) > GHOST_LIMITS.catchRadius) continue;
      this.catchPlayer(a, p, t, `Caught ${p.name} at tick ${t}`);
      return true;
    }
    return false;
  }

  /** Record a catch with the reasons that led to it, send the ghost away (RESPAWN) and tell the host. */
  private catchPlayer(a: Actor, p: GhostPlayer, t: number, last: string): void {
    const ev: GhostCatchEvent = { tick: t, ghost: a.id, kind: 'catch', player: p.id, room: a.room, x: r2(p.x), y: r2(p.y), because: [...a.chain, last] };
    this.record(ev);
    this.go(a, 'respawn', `it caught ${p.name}`);
    this.host.onCatch?.(p.id, ev);
  }

  // ------------------------------------------------------------------------------------------------------- hiding places
  /** A hiding spot of this room within reach of a noise that this ghost has not checked lately (the nearest one), or null. */
  private spotNear(room: string, at: Pt, t: number): HidingSpotDef | null {
    let best: HidingSpotDef | null = null, bestD: number = CATCH_LIMITS.inspectRadius;
    for (const h of this.spotsById.values()) {
      if (h.room !== room) continue;
      const seenAt = this.lastInspect.get(h.id);
      if (seenAt !== undefined && t - seenAt < CATCH_LIMITS.reinspectTicks) continue;
      const d = Math.hypot(h.x - at.x, h.y - BODY_CENTRE - at.y);
      if (d < bestD) { best = h; bestD = d; }
    }
    return best;
  }
  /** The ghost stands at the spot for `inspectTicks` (the telegraph, heard through the cue), then opens it: whoever is inside is caught. It never knows if anyone is there before it opens. */
  private inspecting(a: Actor, players: GhostPlayer[], t: number): void {
    const ins = a.inspect!;
    const spot = this.spotsById.get(ins.spot);
    if (!spot) { a.inspect = null; return; }
    this.turnTo(a, spot.x >= a.x ? 0 : Math.PI);
    if (t < ins.until) return;
    a.inspect = null;
    const who = this.host.occupantOf?.(spot.id) ?? null;
    const p = who ? players.find((x) => x.id === who && x.connected && !x.captured) : undefined;
    const base = { tick: t, ghost: a.id, kind: 'inspect' as const, spot: spot.id, room: spot.room };
    if (p) {
      this.record({ ...base, phase: 'found', player: p.id, text: `Opened the ${spot.kind} and found ${p.name}` });
      this.catchPlayer(a, p, t, `Opened the ${spot.kind} and found ${p.name} at tick ${t}`);
      return;
    }
    this.record({ ...base, phase: 'empty', text: `Opened the ${spot.kind}: nobody there` });
    a.goal = null;
    this.startSearch(a, t);
  }

  // ------------------------------------------------------------------------------------------------------- moving
  private target(a: Actor): Goal | null {
    if (a.state === 'hunting') return a.lastSeen ? { room: a.lastSeen.room, x: a.lastSeen.x, y: a.lastSeen.y } : null;
    return a.goal;
  }

  private move(a: Actor, open: ReadonlySet<string>, t: number): void {
    const grid = this.grids.get(a.room)!;
    let tgt = this.target(a);

    // searching on arrival: stand and look around
    if (a.searchUntil > t) { this.look(a, t); return; }
    if (a.searchUntil !== 0 && a.searchUntil <= t) { a.searchUntil = 0; if (a.state === 'roaming') { a.goal = null; a.patrol = null; } tgt = this.target(a); }

    if (!tgt) {
      // nothing heard and nothing seen: patrol the free air of this region
      if (!a.patrol || Math.hypot(a.patrol.x - a.x, a.patrol.y - a.y) <= ARRIVED) a.patrol = this.pickPatrol(a);
      if (!a.patrol) return;
      this.walk(a, grid, a.patrol, t);
      if (Math.hypot(a.patrol.x - a.x, a.patrol.y - a.y) <= ARRIVED) { this.startSearch(a, t); a.patrol = null; }
      return;
    }

    const here = grid.label[grid.nearestFree({ x: a.x, y: a.y })]!;
    const sameRoom = tgt.room === a.room;
    const tgtCell = sameRoom ? grid.nearestFree(tgt) : -1;
    if (sameRoom && grid.label[tgtCell] === here) {
      this.walk(a, grid, tgt, t);
      if (Math.hypot(tgt.x - a.x, tgt.y - a.y) <= ARRIVED) this.arrive(a, tgt, open, t);
      return;
    }
    // the target is in another room, or on the other side of a wall: the way there is an open door
    const doorId = this.planDoor(a, here, tgt, open);
    if (!doorId) {
      // no open door leads there (a locked door is never passed): give up on this target, or look around if hunting
      if (a.state === 'roaming') { a.goal = null; }
      else if (a.lastSeen) a.lastSeen = { ...a.lastSeen, tick: Math.min(a.lastSeen.tick, t - GHOST_LIMITS.loseSightTicks - 1) };
      return;
    }
    const d = this.roomsById.get(a.room)!.doors.find((x) => x.id === doorId)!;
    const dp = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
    this.walk(a, grid, dp, t);
    if (Math.hypot(dp.x - a.x, dp.y - a.y) <= DOOR_REACH) this.beginDoor(a, d.id, t);
  }

  private arrive(a: Actor, tgt: Goal, open: ReadonlySet<string>, t: number): void {
    // arrived at a hiding spot it chose to check: stand and open it after the telegraph
    if (tgt.inspect && a.state === 'roaming') {
      a.goal = null;
      a.inspect = { spot: tgt.inspect, until: t + CATCH_LIMITS.inspectTicks };
      this.lastInspect.set(tgt.inspect, t);
      const h = this.spotsById.get(tgt.inspect);
      if (h) this.record({ tick: t, ghost: a.id, kind: 'inspect', spot: h.id, room: h.room, phase: 'start', text: `Stopped at the ${h.kind} near where it heard a noise` });
      return;
    }
    // arrived at the place of a noise: it may check a hiding spot near it (seeded chance), instead of only looking around
    if (a.state === 'roaming' && !tgt.door && this.spotsById.size > 0) {
      const h = this.spotNear(a.room, tgt, t);
      if (h && a.rng.next() < CATCH_LIMITS.inspectShare) { a.goal = { room: h.room, x: h.x, y: h.y - BODY_CENTRE, inspect: h.id }; a.searchUntil = 0; return; }
    }
    // a trail that ends at an open door: the ghost follows it through
    if (tgt.door && open.has(tgt.door) && a.state === 'roaming') {
      const d = this.roomsById.get(a.room)!.doors.find((x) => x.id === tgt.door);
      if (d) { a.goal = null; this.beginDoor(a, d.id, t); return; }
    }
    this.startSearch(a, t);
  }
  private startSearch(a: Actor, t: number): void { a.searchStart = t; a.searchUntil = t + GHOST_LIMITS.searchTicks; a.searchBase = a.angle; }
  /** While searching the ghost sweeps its cone left and right (a triangle wave of the tick: no trigonometry, fully deterministic). */
  private look(a: Actor, t: number): void {
    const phase = (t - a.searchStart) % 40;
    const tri = phase < 20 ? phase / 20 : (40 - phase) / 20; // 0..1..0
    this.turnTo(a, a.searchBase + (tri - 0.5) * 2.4);
  }
  private turnTo(a: Actor, desired: number): void {
    const d = angleDiff(desired, a.angle);
    a.angle += Math.max(-TURN_PER_TICK, Math.min(TURN_PER_TICK, d));
    if (a.angle > Math.PI) a.angle -= 2 * Math.PI; else if (a.angle < -Math.PI) a.angle += 2 * Math.PI;
  }

  private pickPatrol(a: Actor): Pt | null {
    const grid = this.grids.get(a.room)!;
    const here = grid.label[grid.nearestFree({ x: a.x, y: a.y })]!;
    const cells = (this.groundCells.get(a.room) ?? []).filter((i) => grid.label[i] === here);
    const far = cells.filter((i) => { const c = grid.centre(i); return Math.hypot(c.x - a.x, c.y - a.y) >= 240; });
    const pool = far.length > 0 ? far : cells;
    if (pool.length === 0) return null;
    return grid.centre(a.rng.pick(pool));
  }

  /** Walk toward a point of the ghost's own room by A*, at most `speedPxPerTick` per tick. */
  private walk(a: Actor, grid: NavGrid, to: Pt, t: number): void {
    const from = grid.nearestFree({ x: a.x, y: a.y }), goal = grid.nearestFree(to);
    if (a.path.length === 0 || (a.pathGoal !== goal && t - a.lastPlan >= 5)) {
      a.path = grid.path(from, goal) ?? [];
      a.pathGoal = goal; a.lastPlan = t;
    }
    let budget = this.tuning.speedPxPerTick;
    const finalFree = grid.isFree(grid.cellOf(to));
    for (let guard = 0; guard < 8 && budget > 1e-9; guard++) {
      let tgt: Pt;
      if (a.path.length > 0) tgt = grid.centre(a.path[0]!);
      else if (finalFree) tgt = to;
      else break;
      const dx = tgt.x - a.x, dy = tgt.y - a.y, d = Math.hypot(dx, dy);
      if (d > 1e-6) this.turnTo(a, Math.atan2(dy, dx));
      if (d <= budget) { a.x = tgt.x; a.y = tgt.y; budget -= d; if (a.path.length > 0) a.path.shift(); else break; }
      else { a.x += (dx / d) * budget; a.y += (dy / d) * budget; budget = 0; }
    }
  }

  // ------------------------------------------------------------------------------------------------------- doors
  private beginDoor(a: Actor, doorId: string, t: number): void {
    a.opening = { door: doorId, until: t + GHOST_LIMITS.doorTicks };
    a.path = []; a.pathGoal = -1;
    this.record({ tick: t, ghost: a.id, kind: 'door', door: doorId, phase: 'start' });
  }
  private progressDoor(a: Actor, open: ReadonlySet<string>, t: number): void {
    const op = a.opening!;
    if (!open.has(op.door)) { a.opening = null; this.record({ tick: t, ghost: a.id, kind: 'door', door: op.door, phase: 'cancelled' }); return; }
    if (t < op.until) return;
    a.opening = null;
    const d = this.roomsById.get(a.room)!.doors.find((x) => x.id === op.door);
    if (!d) return;
    a.room = d.to; a.x = d.arrive.x; a.y = d.arrive.y - HOVER; a.path = []; a.pathGoal = -1;
    this.record({ tick: t, ghost: a.id, kind: 'door', door: op.door, phase: 'done' });
  }

  /**
   * Which open door of its own room should a ghost take to get toward `tgt`? A breadth-first search over (room, free region) nodes joined by OPEN doors.
   * Null when no chain of open doors leads there.
   */
  private planDoor(a: Actor, here: number, tgt: Goal, open: ReadonlySet<string>): string | null {
    const gridHere = this.grids.get(a.room)!;
    const tg = this.grids.get(tgt.room);
    if (!tg) return null;
    const start = `${a.room}#${gridHere.label[here]}`;
    const goal = `${tgt.room}#${tg.label[tg.nearestFree(tgt)]}`;
    if (start === goal) return null;
    const edges = this.doorEdges(open);
    const first = new Map<string, string>(); // node -> the door (of the START region) that leads toward it
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.from !== cur || seen.has(e.to)) continue;
        seen.add(e.to);
        first.set(e.to, cur === start ? e.door : first.get(cur)!);
        if (e.to === goal) return first.get(e.to)!;
        queue.push(e.to);
      }
    }
    return null;
  }
  private doorEdges(open: ReadonlySet<string>): DoorEdge[] {
    if (this.edgeCache && this.edgeCache.open === open) return this.edgeCache.edges;
    const edges: DoorEdge[] = [];
    for (const r of this.cfg.graph.rooms) {
      const g = this.grids.get(r.id)!;
      for (const d of r.doors) {
        if (!open.has(d.id)) continue;
        const to = this.grids.get(d.to);
        if (!to) continue;
        const a = g.label[g.nearestFree({ x: d.x + d.w / 2, y: d.y + d.h / 2 })]!;
        const b = to.label[to.nearestFree({ x: d.arrive.x, y: d.arrive.y - HOVER })]!;
        edges.push({ from: `${r.id}#${a}`, to: `${d.to}#${b}`, door: d.id });
      }
    }
    this.edgeCache = { open, edges };
    return edges;
  }
}

interface DoorEdge { from: string; to: string; door: string }
