import { PLAYER_HEIGHT, PLAYER_WIDTH } from '../sim';
import { ROOM_LIMITS } from './limits';
import type { DoorDef, RoomDef, RoomGraph, RoomLayout } from './schemas';

const HALF_W = PLAYER_WIDTH / 2;
type Box = { x: number; y: number; w: number; h: number };
const EPS = 1e-6;

/** Does a body (feet-centre x, y) overlap the door rectangle? Strict overlap, like the solids in `stepBody`. */
export function bodyInDoor(b: { x: number; y: number }, d: Box): boolean {
  return b.x + HALF_W > d.x && b.x - HALF_W < d.x + d.w && b.y > d.y && b.y - PLAYER_HEIGHT < d.y + d.h;
}

/** The first door of `room` the body stands in, or null. Doors are tested in authored order (deterministic). */
export function doorAt(room: RoomDef, b: { x: number; y: number }): DoorDef | null {
  for (const d of room.doors) if (bodyInDoor(b, d)) return d;
  return null;
}

export function roomById(g: RoomGraph, id: string): RoomDef | undefined { return g.rooms.find((r) => r.id === id); }

/** The public layout of one room (walls and doorways only). */
export function layoutOf(room: RoomDef): RoomLayout {
  return {
    roomId: room.id,
    arena: structuredClone(room.arena),
    doors: room.doors.map((d) => ({ id: d.id, x: d.x, y: d.y, w: d.w, h: d.h })),
  };
}

const stands = (solids: readonly Box[], x: number, y: number): boolean => solids.some((s) => Math.abs(s.y - y) < EPS && x >= s.x && x <= s.x + s.w);

/**
 * Structural validation of a room graph (pure; the server runs it from `validateStageDef`). Returns human-readable errors.
 * Physical reachability (can a body actually walk or jump to each door) is proven separately by the real-physics tests.
 */
export function validateRoomGraph(g: RoomGraph): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const L = ROOM_LIMITS;
  if (g.rooms.length < 1 || g.rooms.length > L.maxRooms) err(`room count ${g.rooms.length} is outside 1..${L.maxRooms}`);
  const ids = new Set<string>();
  for (const r of g.rooms) { if (ids.has(r.id)) err(`duplicate room id ${r.id}`); ids.add(r.id); }
  if (!ids.has(g.start)) err(`start room ${g.start} does not exist`);
  const byId = new Map(g.rooms.map((r) => [r.id, r]));

  for (const r of g.rooms) {
    const a = r.arena;
    if (a.id !== r.id) err(`room ${r.id}: its arena id must equal the room id (got ${a.id})`);
    if (a.width < L.minWidth || a.width > L.maxWidth || a.height < L.minHeight || a.height > L.maxHeight) err(`room ${r.id}: size ${a.width}x${a.height} is outside the limits`);
    if (a.solids.length < 1 || a.solids.length > L.maxSolidsPerRoom) err(`room ${r.id}: ${a.solids.length} solids is outside 1..${L.maxSolidsPerRoom}`);
    for (const [i, s] of a.solids.entries()) {
      if (s.x < 0 || s.y < 0 || s.x + s.w > a.width + EPS || s.y + s.h > a.height + EPS) err(`room ${r.id}: solid ${i} leaves the room`);
    }
    if (a.spawns.length !== L.spawnsPerRoom) err(`room ${r.id}: needs ${L.spawnsPerRoom} spawns`);
    for (const [i, p] of a.spawns.entries()) if (!stands(a.solids, p.x, p.y) || p.x < HALF_W || p.x > a.width - HALF_W) err(`room ${r.id}: spawn ${i} does not stand on a solid inside the room`);
    if (r.doors.length > L.maxDoorsPerRoom) err(`room ${r.id}: ${r.doors.length} doors exceeds ${L.maxDoorsPerRoom}`);
    const doorIds = new Set<string>();
    for (const d of r.doors) {
      if (doorIds.has(d.id)) err(`room ${r.id}: duplicate door id ${d.id}`);
      doorIds.add(d.id);
      if (d.w < L.doorMinW || d.w > L.doorMaxW || d.h < L.doorMinH || d.h > L.doorMaxH) err(`door ${d.id}: size ${d.w}x${d.h} is outside the limits`);
      if (d.x < 0 || d.x + d.w > a.width || d.y < 0) err(`door ${d.id} leaves room ${r.id}`);
      if (!stands(a.solids, d.x + d.w / 2, d.y + d.h)) err(`door ${d.id} does not stand on a solid`);
      const target = byId.get(d.to);
      if (!target) { err(`door ${d.id} leads to unknown room ${d.to}`); continue; }
      if (target.id === r.id) err(`door ${d.id} leads back into its own room`);
      if (!target.doors.some((back) => back.to === r.id)) err(`door ${d.id}: room ${target.id} has no door back to ${r.id}`);
      const t = target.arena;
      if (!stands(t.solids, d.arrive.x, d.arrive.y) || d.arrive.x < HALF_W || d.arrive.x > t.width - HALF_W) err(`door ${d.id}: the arrival point does not stand on a solid in ${target.id}`);
      for (const td of target.doors) {
        const near = bodyInDoor(d.arrive, { x: td.x - L.doorClearance, y: td.y, w: td.w + 2 * L.doorClearance, h: td.h });
        if (near) err(`door ${d.id}: the arrival point is within ${L.doorClearance}px of door ${td.id} (it would bounce straight back)`);
      }
    }
  }

  // every room must be reachable from the start through doors
  if (byId.has(g.start)) {
    const seen = new Set<string>([g.start]);
    const queue = [g.start];
    while (queue.length) {
      const room = byId.get(queue.shift()!)!;
      for (const d of room.doors) if (byId.has(d.to) && !seen.has(d.to)) { seen.add(d.to); queue.push(d.to); }
    }
    for (const r of g.rooms) if (!seen.has(r.id)) err(`room ${r.id} cannot be reached from the start room`);
  }
  return errs;
}
