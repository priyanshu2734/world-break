import { ESCAPE_LIMITS, ITEM_LIMITS, MOVE_SPEED, TICK_DT, type RoomGraph } from '@wb/shared';
import { surfaceBelow } from '../salvage/rest';
import type { StageDef } from '../systems/stageDef';
import type { EscapeSpec, Lock } from './escapeSpec';

/** Authored within `maxAuthoredFall` px above a platform it rests on (the same rule as the P3C salvage validator). */
const restsNear = (arena: Parameters<typeof surfaceBelow>[0], x: number, y: number): boolean => {
  const s = surfaceBelow(arena, x, y);
  return s !== null && s.y - y <= ITEM_LIMITS.maxAuthoredFall;
};

type Item = NonNullable<StageDef['items']>[number];

/**
 * P3D: structural validation of an escape stage. Returns human-readable errors; a stage with any error must not launch.
 * It proves, without simulating, that every lock can be opened by ONE player using what lies on the near side of that lock,
 * and that nothing is secretly impossible. The real-physics solver (step 5) proves the same by walking.
 */
export function validateEscape(spec: EscapeSpec, graph: RoomGraph, def: Pick<StageDef, 'items' | 'stashes'>): string[] {
  const errs: string[] = [];
  const err = (m: string) => errs.push(m);
  const rooms = new Map(graph.rooms.map((r) => [r.id, r]));
  const doors = new Map<string, { room: string; to: string }>();
  for (const r of graph.rooms) for (const d of r.doors) doors.set(d.id, { room: r.id, to: d.to });
  const items = def.items ?? [];
  const stashes = def.stashes ?? [];
  const itemRoom = (i: Item) => i.room ?? graph.start;
  const stashRoom = (s: NonNullable<StageDef['stashes']>[number]) => s.room ?? graph.start;

  // ---- ids are unique across every kind of object
  const seen = new Map<string, string>();
  const claim = (id: string, what: string) => { if (seen.has(id)) err(`duplicate id ${id} (${seen.get(id)} and ${what})`); else seen.set(id, what); };
  for (const c of spec.clues) claim(c.id, 'clue');
  for (const k of spec.keypads) claim(k.id, 'keypad');
  for (const s of spec.safes) claim(s.id, 'safe');
  for (const s of spec.switches) claim(s.id, 'switch');
  for (const i of items) claim(i.id, 'item');
  for (const s of stashes) claim(s.id, 'stash');

  // ---- every placed object stands on a solid inside an existing room
  const standing = (id: string, what: string, room: string, x: number, y: number) => {
    const r = rooms.get(room);
    if (!r) { err(`${what} ${id} is in unknown room ${room}`); return; }
    const a = r.arena;
    if (x < 0 || x > a.width) err(`${what} ${id} is outside room ${room}`);
    if (!a.solids.some((s) => Math.abs(s.y - y) < 1e-6 && x >= s.x && x <= s.x + s.w)) err(`${what} ${id} does not stand on a solid in room ${room}`);
  };
  for (const c of spec.clues) standing(c.id, 'clue', c.room, c.x, c.y);
  for (const k of spec.keypads) standing(k.id, 'keypad', k.room, k.x, k.y);
  for (const s of spec.safes) standing(s.id, 'safe', s.room, s.x, s.y);
  for (const s of spec.switches) standing(s.id, 'switch', s.room, s.x, s.y);
  standing('exit', 'exit', spec.exit.room, spec.exit.x, spec.exit.y);
  for (const s of stashes) {
    const r = rooms.get(stashRoom(s));
    if (!r) err(`stash ${s.id} is in unknown room ${stashRoom(s)}`);
    else if (!restsNear(r.arena, s.x, s.y)) err(`stash ${s.id} does not rest on a platform`);
  }
  if (items.length > ITEM_LIMITS.maxItemsPerStage) err(`${items.length} items exceeds ${ITEM_LIMITS.maxItemsPerStage}`);
  for (const i of items) {
    const r = rooms.get(itemRoom(i));
    if (!r) { err(`item ${i.id} is in unknown room ${itemRoom(i)}`); continue; }
    if (!restsNear(r.arena, i.x, i.y)) err(`item ${i.id} does not rest on a platform`);
    if (i.gate) err(`item ${i.id}: reality abilities are not part of escape stages`);
    if (i.hidden?.reveal === 'scan') err(`item ${i.id}: the Phase Scanner is not part of escape stages`);
    if (i.hidden?.reveal === 'interact' && i.hidden.stashId) {
      const st = stashes.find((s) => s.id === i.hidden!.stashId);
      if (!st) err(`item ${i.id} is hidden in unknown stash ${i.hidden.stashId}`);
      else if (stashRoom(st) !== itemRoom(i)) err(`item ${i.id} is hidden in a stash in another room`);
    }
  }

  // ---- links: every physical door has exactly one lock, both sides agree
  const linkOf = new Map<string, number>();
  spec.links.forEach((l, n) => {
    const [a, b] = l.doors;
    const da = doors.get(a), db = doors.get(b);
    if (!da || !db) { err(`link ${n}: unknown door ${!da ? a : b}`); return; }
    if (da.to !== db.room || db.to !== da.room) err(`link ${n}: ${a} and ${b} are not the two sides of one door`);
    for (const id of l.doors) { if (linkOf.has(id)) err(`door ${id} has more than one lock`); linkOf.set(id, n); }
  });
  for (const id of doors.keys()) if (!linkOf.has(id)) err(`door ${id} has no lock`);

  // ---- the near side of each lock: rooms reachable from the start without passing that link
  const neighbours = (room: string, skip: number): string[] => {
    const out: string[] = [];
    for (const d of rooms.get(room)!.doors) if (linkOf.get(d.id) !== skip) out.push(d.to);
    return out;
  };
  const nearSide = (skip: number): Set<string> => {
    const side = new Set<string>([graph.start]);
    const queue = [graph.start];
    while (queue.length) for (const n of neighbours(queue.shift()!, skip)) if (!side.has(n) && rooms.has(n)) { side.add(n); queue.push(n); }
    return side;
  };
  const sides = spec.links.map((_, n) => nearSide(n));

  // ---- never the same lock type twice in a row (two links that meet in a room)
  for (const r of graph.rooms) {
    const types = new Map<string, number>();
    for (const d of r.doors) {
      const n = linkOf.get(d.id);
      if (n === undefined) continue;
      const t = spec.links[n]!.lock.type;
      if (types.get(t) !== undefined && types.get(t) !== n) err(`room ${r.id}: two neighbouring doors both use the ${t} lock`);
      types.set(t, n);
    }
  }

  // ---- each lock is solvable by one player from its near side
  const clueById = new Map(spec.clues.map((c) => [c.id, c]));
  const digitsOf = (ids: readonly string[]): string => ids.map((id) => (clueById.get(id)?.text.match(/[0-9]/g) ?? []).join('')).join('');
  const genuine = (i: Item) => i.decoy !== true;
  const safeKeys = new Set(spec.safes.map((s) => s.contains).filter((x): x is string => x !== undefined));
  const free = (kind: string, side: Set<string>) => items.filter((i) => i.kind === kind && genuine(i) && !safeKeys.has(i.id) && side.has(itemRoom(i)));
  const needsKind = (l: Lock): 'access_key' | 'battery' | null => (l.type === 'key_item' ? 'access_key' : l.type === 'power' ? 'battery' : null);

  spec.links.forEach((l, n) => {
    const side = sides[n]!, lock = l.lock, tag = `link ${n} (${lock.type})`;
    const inSide = (room: string) => side.has(room);
    const needClues = (ids: readonly string[], code: string) => {
      for (const id of ids) {
        const c = clueById.get(id);
        if (!c) err(`${tag}: unknown clue ${id}`);
        else if (!inSide(c.room)) err(`${tag}: clue ${id} is beyond the door it is meant to open`);
      }
      if (digitsOf(ids) !== code) err(`${tag}: the digits in its clues (${digitsOf(ids)}) do not spell the code ${code}`);
    };
    if (lock.type === 'key_item' || lock.type === 'power') {
      const kind = needsKind(lock)!;
      const needed = spec.links.filter((m, k) => needsKind(m.lock) === kind && [...sides[k]!].every((r) => side.has(r))).length;
      if (free(kind, side).length < needed) err(`${tag}: only ${free(kind, side).length} ${kind} on its near side for ${needed} lock(s) that need one`);
    } else if (lock.type === 'code') {
      const k = spec.keypads.find((x) => x.id === lock.keypadId);
      if (!k) err(`${tag}: unknown keypad ${lock.keypadId}`);
      else if (!inSide(k.room)) err(`${tag}: its keypad is beyond the door`);
      needClues(lock.clueIds, lock.code);
    } else if (lock.type === 'two_person') {
      const a = spec.switches.find((x) => x.id === lock.switchA), b = spec.switches.find((x) => x.id === lock.switchB);
      if (!a || !b || a.id === b.id) { err(`${tag}: needs two different known switches`); return; }
      if (!inSide(a.room) || !inSide(b.room)) err(`${tag}: a switch is beyond the door`);
      if (a.room !== b.room) err(`${tag}: both switches must be in one room (a lone player runs between them)`);
      // one person must reach the second switch before the first one goes dark: a conservative walking-time bound
      const ticks = Math.abs(a.x - b.x) / (MOVE_SPEED * TICK_DT) + (Math.abs(a.y - b.y) / 100) * 20;
      if (ticks > ESCAPE_LIMITS.switchHoldTicks * 0.7) err(`${tag}: the switches are too far apart for one player (${Math.ceil(ticks)} ticks > ${Math.floor(ESCAPE_LIMITS.switchHoldTicks * 0.7)})`);
    } else {
      const s = spec.safes.find((x) => x.id === lock.safeId);
      if (!s) { err(`${tag}: unknown safe ${lock.safeId}`); return; }
      if (!inSide(s.room)) err(`${tag}: its safe is beyond the door`);
      needClues(s.clueIds, s.code);
      const key = items.find((i) => i.id === s.contains);
      if (!key || key.kind !== 'access_key' || !genuine(key)) err(`${tag}: its safe must hold a genuine access_key`);
      else {
        if (itemRoom(key) !== s.room) err(`${tag}: the key must be in the safe's room`);
        if (key.hidden?.reveal !== 'interact' || key.hidden.stashId) err(`${tag}: the key must be hidden for the safe (interact, no stash)`);
      }
    }
  });
  // every safe is used by a safe lock or is a decoy that holds nothing useful; a safe that holds a key must belong to a lock
  for (const s of spec.safes) {
    if (s.contains !== undefined && !items.some((i) => i.id === s.contains)) err(`safe ${s.id} contains unknown item ${s.contains}`);
    if (s.contains !== undefined && !spec.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id)) err(`safe ${s.id} holds a part but no door uses it`);
  }
  for (const k of spec.keypads) if (!spec.links.some((l) => l.lock.type === 'code' && l.lock.keypadId === k.id)) err(`keypad ${k.id} opens nothing`);
  // a hidden part with no way to reveal it can never be found
  for (const i of items) {
    if (i.hidden && !i.hidden.stashId && !safeKeys.has(i.id)) err(`item ${i.id} is hidden but nothing reveals it`);
  }
  if (!rooms.has(spec.exit.room)) err(`exit room ${spec.exit.room} does not exist`);
  return errs;
}
