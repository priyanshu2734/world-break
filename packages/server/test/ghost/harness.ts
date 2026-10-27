import { EYE_HEIGHT, pointVisible, roomById, visionRadius, type Difficulty, type GhostType, type RoomGraph } from '@wb/shared';
import { GhostSystem, type GhostCatchEvent, type GhostHost, type GhostPlayer } from '../../src/ghost';
import { generateEscapeStage } from '../../src/rooms/generate';

/** A scripted player: where it is and how it moves. The harness integrates `x` by the move axis at the real speed (13 px per tick). */
export interface Puppet extends GhostPlayer { script?: (tick: number, p: Puppet) => void }

export class FakeHost implements GhostHost {
  tick = 0;
  open = new Set<string>();
  catches: { tick: number; player: string; ev: GhostCatchEvent }[] = [];
  /** players at each tick, as they were when the ghost stepped (to audit a spawn after the fact) */
  history = new Map<number, { id: string; roomId: string; x: number; y: number }[]>();
  constructor(public puppets: Puppet[]) {}
  players(): GhostPlayer[] { return this.puppets; }
  openDoorIds(): ReadonlySet<string> { return this.open; }
  onCatch(playerId: string, ev: GhostCatchEvent): void { this.catches.push({ tick: this.tick, player: playerId, ev }); }
}

export function puppet(id: string, roomId: string, x: number, y = 680, extra: Partial<Puppet> = {}): Puppet {
  return { id, name: id.toUpperCase(), roomId, x, y, connected: true, moveX: 0, crouch: false, aim: null, facing: 1, hidden: false, captured: false, ...extra };
}

export interface Rig { sys: GhostSystem; host: FakeHost; graph: RoomGraph; stage: number; seed: number; radius: number }

export function rig(opts: { stage: number; seed: number; difficulty?: Difficulty; types?: readonly GhostType[]; players?: (graph: RoomGraph) => Puppet[]; graph?: RoomGraph }): Rig {
  const def = opts.graph ? null : generateEscapeStage(opts.stage, opts.seed);
  const graph = opts.graph ?? def!.rooms!;
  const difficulty = opts.difficulty ?? 'easy';
  const players = opts.players ? opts.players(graph) : [puppet('p0', graph.start, 300), puppet('p1', graph.start, 350)];
  const host = new FakeHost(players);
  const radius = visionRadius(difficulty, opts.stage);
  const sys = new GhostSystem({ stage: opts.stage, seed: opts.seed, difficulty, graph, visionRadius: radius, types: opts.types ?? ['wisp'] }, host);
  return { sys, host, graph, stage: opts.stage, seed: opts.seed, radius };
}

/** One tick: the puppets move (by their script, then by their move axis), the host clock advances, the ghost steps. */
export function tick(r: Rig): void {
  const h = r.host;
  for (const p of h.puppets) {
    (p as Puppet).script?.(h.tick, p as Puppet);
    const room = roomById(r.graph, p.roomId)!;
    p.x = Math.max(14, Math.min(room.arena.width - 14, p.x + Math.sign(p.moveX) * Math.min(1, Math.abs(p.moveX)) * 13));
  }
  h.tick++;
  h.history.set(h.tick, h.puppets.map((p) => ({ id: p.id, roomId: p.roomId, x: p.x, y: p.y })));
  r.sys.step();
}
export function run(r: Rig, ticks: number, each?: (t: number) => void): void { for (let i = 0; i < ticks; i++) { tick(r); each?.(r.host.tick); } }

/** Is `pt` (a point of `roomId`) in view of any puppet standing in that room at the recorded tick? */
export function inAnyView(r: Rig, tickNo: number, roomId: string, pt: { x: number; y: number }): boolean {
  const room = roomById(r.graph, roomId)!;
  for (const p of r.host.history.get(tickNo) ?? []) {
    if (p.roomId !== roomId) continue;
    if (pointVisible(room, { x: p.x, y: p.y - EYE_HEIGHT }, pt, r.host.open, r.radius)) return true;
  }
  return false;
}
