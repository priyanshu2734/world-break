import { ESCAPE_LIMITS, EVIDENCE_PER_TYPE, ITEM_KIND_SPECS, evidenceOwner, ghostLineupForStage, ghostPickFor, ghostSeedFor, ITEM_LIMITS, MOVE_SPEED, TICK_DT, type RoomGraph } from '@wb/shared';
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
  // A GATE is a door whose two sides are in the same room (a wall between them): there, near side also means "left of the gate".
  const gateLimit = spec.links.map((l) => {
    const a = doors.get(l.doors[0]), b = doors.get(l.doors[1]);
    if (!a || !b || a.room !== b.room) return null;
    const room = rooms.get(a.room)!;
    const xs = l.doors.map((id) => room.doors.find((d) => d.id === id)!.x);
    return { room: a.room, x: Math.min(...xs) };
  });

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
  const free = (kind: string, side: Set<string>, gate: { room: string; x: number } | null = null) =>
    items.filter((i) => i.kind === kind && genuine(i) && !safeKeys.has(i.id) && side.has(itemRoom(i)) && !(gate && itemRoom(i) === gate.room && i.x >= gate.x));
  const needsKind = (l: Lock): 'access_key' | 'battery' | null => (l.type === 'key_item' ? 'access_key' : l.type === 'power' ? 'battery' : null);

  spec.links.forEach((l, n) => {
    const side = sides[n]!, lock = l.lock, tag = `link ${n} (${lock.type})`;
    const gate = gateLimit[n];
    const inSide = (room: string, x?: number) => side.has(room) && !(gate && room === gate.room && x !== undefined && x >= gate.x);
    const needClues = (ids: readonly string[], code: string) => {
      for (const id of ids) {
        const c = clueById.get(id);
        if (!c) err(`${tag}: unknown clue ${id}`);
        else if (!inSide(c.room, c.x)) err(`${tag}: clue ${id} is beyond the door it is meant to open`);
      }
      if (digitsOf(ids) !== code) err(`${tag}: the digits in its clues (${digitsOf(ids)}) do not spell the code ${code}`);
    };
    if (lock.type === 'key_item' || lock.type === 'power') {
      const kind = needsKind(lock)!;
      const needed = spec.links.filter((m, k) => needsKind(m.lock) === kind && [...sides[k]!].every((r) => side.has(r))).length;
      if (free(kind, side, gate ?? null).length < needed) err(`${tag}: only ${free(kind, side, gate ?? null).length} ${kind} on its near side for ${needed} lock(s) that need one`);
    } else if (lock.type === 'code') {
      const k = spec.keypads.find((x) => x.id === lock.keypadId);
      if (!k) err(`${tag}: unknown keypad ${lock.keypadId}`);
      else if (!inSide(k.room, k.x)) err(`${tag}: its keypad is beyond the door`);
      needClues(lock.clueIds, lock.code);
    } else if (lock.type === 'two_person') {
      const a = spec.switches.find((x) => x.id === lock.switchA), b = spec.switches.find((x) => x.id === lock.switchB);
      if (!a || !b || a.id === b.id) { err(`${tag}: needs two different known switches`); return; }
      if (!inSide(a.room, a.x) || !inSide(b.room, b.x)) err(`${tag}: a switch is beyond the door`);
      if (a.room !== b.room) err(`${tag}: both switches must be in one room (a lone player runs between them)`);
      // one person must reach the second switch before the first one goes dark: a conservative walking-time bound
      const ticks = Math.abs(a.x - b.x) / (MOVE_SPEED * TICK_DT) + (Math.abs(a.y - b.y) / 100) * 20;
      if (ticks > ESCAPE_LIMITS.switchHoldTicks * 0.7) err(`${tag}: the switches are too far apart for one player (${Math.ceil(ticks)} ticks > ${Math.floor(ESCAPE_LIMITS.switchHoldTicks * 0.7)})`);
    } else {
      const s = spec.safes.find((x) => x.id === lock.safeId);
      if (!s) { err(`${tag}: unknown safe ${lock.safeId}`); return; }
      if (!inSide(s.room, s.x)) err(`${tag}: its safe is beyond the door`);
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
    const holdsGun = items.find((i) => i.id === s.contains)?.kind === 'pulse_gun'; // P3E step 4: the gun's own safe belongs to no door
    if (s.contains !== undefined && !holdsGun && !spec.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id)) err(`safe ${s.id} holds a part but no door uses it`);
  }
  for (const k of spec.keypads) if (!spec.links.some((l) => l.lock.type === 'code' && l.lock.keypadId === k.id)) err(`keypad ${k.id} opens nothing`);
  // a hidden part with no way to reveal it can never be found
  for (const i of items) {
    if (i.hidden && !i.hidden.stashId && !safeKeys.has(i.id)) err(`item ${i.id} is hidden but nothing reveals it`);
  }
  // P3E step 4: the Pulse Gun is optional (no lock needs it) but must be REACHABLE and CARRYABLE: in the start room (no door to open), locked in a locker or
  // a safe whose combination is spelled by notes in that same room, one genuine part of one hand (so it fits next to any other part within two slots).
  const guns = items.filter((i) => i.kind === 'pulse_gun');
  if (guns.length > 1) err('a stage holds at most one Pulse Gun');
  for (const g of guns) {
    if (g.decoy === true) err(`gun ${g.id} cannot be a decoy`);
    if (itemRoom(g) !== graph.start) err(`gun ${g.id} must be in the start room (it must not need a door opened)`);
    if ((g.slots ?? ITEM_KIND_SPECS.pulse_gun.defaultSlots) * 2 > ITEM_LIMITS.carrySlots) err(`gun ${g.id} must fit in one hand, so it can be carried next to another part`);
    const safe = spec.safes.find((s) => s.contains === g.id);
    const stash = g.hidden?.stashId ? stashes.find((s) => s.id === g.hidden!.stashId) : undefined;
    if (!g.hidden || g.hidden.reveal !== 'interact') err(`gun ${g.id} must be locked away (a locker or a safe, revealed by opening it)`);
    else if (safe) {
      if (safe.room !== graph.start) err(`gun safe ${safe.id} must be in the start room`);
      if (g.hidden.stashId) err(`gun ${g.id} is in a safe, so it names no stash`);
      for (const id of safe.clueIds) { const c = clueById.get(id); if (!c || c.room !== graph.start) err(`gun safe ${safe.id}: clue ${id} must be a note in the start room`); }
      if (digitsOf(safe.clueIds) !== safe.code) err(`gun safe ${safe.id}: its clues do not spell its combination`);
    } else if (!stash || stashRoom(stash) !== graph.start) err(`gun ${g.id} must lie in a locker of the start room`);
  }
  for (const h of spec.hidingSpots ?? []) { claim(h.id, 'hiding spot'); standing(h.id, 'hiding spot', h.room, h.x, h.y); }
  for (const v of spec.ghostEvidence ?? []) {
    claim(v.id, 'evidence'); standing(v.id, 'evidence', v.room, v.x, v.y);
    if (evidenceOwner(v.kind) !== v.ghost) err(`evidence ${v.id}: kind ${v.kind} does not belong to a ${v.ghost}`);
  }
  if (!rooms.has(spec.exit.room)) err(`exit room ${spec.exit.room} does not exist`);
  return errs;
}

/** P3E step 4: every ghost stage must hold exactly one Pulse Gun (the generator calls this when the run has a ghost). */
export function requireGun(def: Pick<StageDef, 'items'>): string[] {
  const n = (def.items ?? []).filter((i) => i.kind === 'pulse_gun').length;
  return n === 1 ? [] : [`a ghost stage must hold exactly one Pulse Gun (it holds ${n})`];
}

/**
 * P3E step 5: what a ghost stage must hold beyond the gun. Every room keeps at least one hiding spot, standing on its floor (a floor is always reachable by
 * walking and jumping, which the stage's own solvability proof covers), no room holds more than the cap, and every ghost type that runs on the stage left
 * its pieces of evidence (and only its own kind).
 */
export function requireGhostLevel(def: Pick<StageDef, 'rooms' | 'escape'>, stage: number, stageSeed: number): string[] {
  const errs: string[] = [];
  const graph = def.rooms, spec = def.escape;
  if (!graph || !spec) return ['a ghost stage needs rooms and an escape spec'];
  const spots = spec.hidingSpots ?? [];
  for (const r of graph.rooms) {
    const mine = spots.filter((h) => h.room === r.id);
    if (mine.length === 0) errs.push(`room ${r.id} has no hiding spot`);
    for (const h of mine) {
      const floor = r.arena.solids.some((s) => Math.abs(s.y - h.y) < 1 && h.x >= s.x && h.x <= s.x + s.w);
      if (!floor) errs.push(`hiding spot ${h.id} is not on a floor of ${r.id}`);
    }
  }
  const lineup = ghostLineupForStage(stage, ghostPickFor(ghostSeedFor(stageSeed, stage)));
  for (const type of lineup) {
    const n = (spec.ghostEvidence ?? []).filter((e) => e.ghost === type).length;
    if (n < EVIDENCE_PER_TYPE) errs.push(`the ${type} left ${n} pieces of evidence (needs ${EVIDENCE_PER_TYPE})`);
  }
  for (const e of spec.ghostEvidence ?? []) if (!lineup.includes(e.ghost)) errs.push(`evidence ${e.id} belongs to a ${e.ghost}, which does not run on this stage`);
  return errs;
}
