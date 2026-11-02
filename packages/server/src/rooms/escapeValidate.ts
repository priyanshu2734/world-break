import { ESCAPE_LIMITS, EVIDENCE_PER_TYPE, ITEM_KIND_SPECS, PLAYER_HEIGHT, evidenceOwner, ghostLineupForStage, ghostPickFor, ghostSeedFor, ITEM_LIMITS, MOVE_SPEED, TICK_DT, parseBreaker, parseGlyphs, parseLegend, parseLever, parseWiring, symbolCode, type RoomGraph } from '@wb/shared';
import { platformIndex } from '../salvage/reach';
import { strictReachableFrom as reachableFrom } from './reachStrict';
import { canonicalArena } from './arenaKey';
import { surfaceBelow } from '../salvage/rest';
import type { StageDef } from '../systems/stageDef';
import type { EscapeSpec, Lock } from './escapeSpec';

/** Authored within `maxAuthoredFall` px above a platform it rests on (the same rule as the P3C salvage validator). */
const restsNear = (arena: Parameters<typeof surfaceBelow>[0], x: number, y: number): boolean => {
  const s = surfaceBelow(arena, x, y);
  return s !== null && s.y - y <= ITEM_LIMITS.maxAuthoredFall;
};

type Item = NonNullable<StageDef['items']>[number];
type SwitchSpec = EscapeSpec['switches'][number];

/** Is the walk along the top of a platform at height `y` between two x positions free of walls and crates (nothing to hop over)? */
export const clearRun = (solids: readonly { x: number; y: number; w: number; h: number }[], y: number, x0: number, x1: number): boolean => {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  return !solids.some((w) => w.x < hi && w.x + w.w > lo && w.y < y - 1 && w.y + w.h > y - PLAYER_HEIGHT);
};

/** The ids of the switches a lock is made of (none for the locks that have no switch). */
export function switchIdsOf(lock: Lock): readonly string[] {
  switch (lock.type) {
    case 'two_person': return [lock.switchA, lock.switchB];
    case 'lever_sequence': return lock.levers;
    case 'breaker_panel': return lock.breakers;
    case 'wiring': return lock.terminals;
    case 'pressure_plates': return lock.plates;
    case 'timed_switch': return [lock.switchId];
    case 'flashlight_sensor': return lock.sensors;
    default: return [];
  }
}

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
  const needsKind = (l: Lock): 'access_key' | 'battery' | null => (l.type === 'key_item' || l.type === 'tool_key' ? 'access_key' : l.type === 'power' ? 'battery' : null);

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
    if (lock.type === 'key_item' || lock.type === 'power' || lock.type === 'tool_key') {
      const kind = needsKind(lock)!;
      const needed = spec.links.filter((m, k) => needsKind(m.lock) === kind && [...sides[k]!].every((r) => side.has(r))).length;
      if (free(kind, side, gate ?? null).length < needed) err(`${tag}: only ${free(kind, side, gate ?? null).length} ${kind} on its near side for ${needed} lock(s) that need one`);
      if (lock.type === 'tool_key') {
        // the key lies in a jammed locker that only a carried valve wheel opens; the wheel is a genuine, loose part of the near side; key and wheel together fit in the two slots
        const st = stashes.find((x) => x.id === lock.stashId);
        if (!st) err(`${tag}: unknown locker ${lock.stashId}`);
        else {
          if (st.needs !== lock.tool) err(`${tag}: its locker must need a ${lock.tool}`);
          if (!inSide(stashRoom(st), st.x)) err(`${tag}: its locker is beyond the door`);
          if (!items.some((i) => i.kind === 'access_key' && genuine(i) && i.hidden?.stashId === st.id)) err(`${tag}: its locker must hold a genuine access_key`);
        }
        const wheels = items.filter((i) => i.kind === lock.tool && genuine(i) && !i.hidden && inSide(itemRoom(i), i.x));
        if (wheels.length === 0) err(`${tag}: no genuine ${lock.tool} lies on its near side`);
        if (2 * 1 > ITEM_LIMITS.carrySlots) err(`${tag}: key and tool do not fit in the slots`);
      }
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
    } else if (lock.type === 'safe') {
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
    } else {
      // ---- P3F step 2: the puzzle pool. Every rule proves the lock is solvable by ONE player with what lies on its near side, and that its words say the truth.
      const switchGroup = (ids: readonly string[], what: string): SwitchSpec[] => {
        const g: SwitchSpec[] = [];
        for (const id of ids) {
          const x = spec.switches.find((q) => q.id === id);
          if (!x) err(`${tag}: unknown ${what} ${id}`); else g.push(x);
        }
        if (new Set(ids).size !== ids.length) err(`${tag}: a ${what} is named twice`);
        if (g.length !== ids.length) return [];
        if (g.some((x) => !inSide(x.room, x.x))) err(`${tag}: a ${what} is beyond the door`);
        if (new Set(g.map((x) => x.room)).size !== 1) err(`${tag}: its ${what}s must all be in one room`);
        return g;
      };
      /** a row: one height, listed west to east, at least 110 px apart (so "counted from the left" is unambiguous and one press reaches one of them). */
      const needRow = (g: readonly SwitchSpec[], what: string) => {
        for (let k = 0; k < g.length; k++) {
          const a = g[k]!, b = g[k + 1];
          if (b === undefined) continue;
          if (b.x - a.x < 110) err(`${tag}: its ${what}s must be listed west to east and at least 110 px apart`);
          if (a.y !== b.y) err(`${tag}: its ${what}s must stand at one height`);
        }
      };
      const clueIn = (id: string, what: string) => {
        const c = clueById.get(id);
        if (!c) { err(`${tag}: unknown ${what} ${id}`); return undefined; }
        if (!inSide(c.room, c.x)) err(`${tag}: its ${what} is beyond the door`);
        return c;
      };
      const solids = (room: string) => rooms.get(room)?.arena.solids ?? [];
      switch (lock.type) {
        case 'lever_sequence': {
          const g = switchGroup(lock.levers, 'lever');
          needRow(g, 'lever');
          if (lock.order.length !== lock.levers.length || [...lock.order].sort((a, b) => a - b).some((v, k) => v !== k)) err(`${tag}: its order must use every lever once`);
          const c = clueIn(lock.clueId, 'log');
          if (c && JSON.stringify(parseLever(c.text)) !== JSON.stringify(lock.order)) err(`${tag}: its log does not spell the order of the levers`);
          break;
        }
        case 'breaker_panel': {
          const g = switchGroup(lock.breakers, 'breaker');
          needRow(g, 'breaker');
          if (lock.start.length !== lock.breakers.length || lock.target.length !== lock.breakers.length) err(`${tag}: its start and target must name every breaker`);
          if (lock.start.every((v, k) => v === lock.target[k])) err(`${tag}: the panel starts already solved`);
          const c = clueIn(lock.clueId, 'chart');
          if (c && JSON.stringify(parseBreaker(c.text)) !== JSON.stringify(lock.target)) err(`${tag}: its chart does not spell the right circuits`);
          break;
        }
        case 'wiring': {
          const g = switchGroup(lock.terminals, 'terminal');
          needRow(g, 'terminal');
          if (lock.right >= lock.terminals.length) err(`${tag}: the live wire is not one of the terminals`);
          const c = clueIn(lock.clueId, 'plan');
          if (c && parseWiring(c.text) !== lock.right) err(`${tag}: its plan does not name the live wire`);
          break;
        }
        case 'pressure_plates': {
          const g = switchGroup(lock.plates, 'plate');
          const a = g[0], b = g[1];
          if (a === undefined || b === undefined || a.id === b.id) { err(`${tag}: needs two different plates`); break; }
          const dx = Math.abs(a.x - b.x);
          if (a.y !== b.y) err(`${tag}: both plates must stand at one height`);
          if (dx < 200 || dx > 520) err(`${tag}: its plates must be 200 to 520 px apart (they are ${Math.round(dx)})`);
          if (!clearRun(solids(a.room), a.y, a.x, b.x)) err(`${tag}: a wall or crate stands between its plates`);
          // a lone player leaves the first plate and must reach the second before the first goes dark
          const ticks = Math.max(0, dx - 2 * ESCAPE_LIMITS.plateRadius) / (MOVE_SPEED * TICK_DT);
          if (ticks > ESCAPE_LIMITS.plateHoldTicks * 0.7) err(`${tag}: its plates are too far apart for one player`);
          break;
        }
        case 'timed_switch': {
          const g = switchGroup([lock.switchId], 'switch');
          const a = g[0];
          if (a === undefined) break;
          // the near door is the one of this link that stands in a room of the near side
          const near = graph.rooms.flatMap((r) => r.doors.filter((d) => linkOf.get(d.id) === n && side.has(r.id) && r.id === a.room));
          const d = near[0];
          if (d === undefined) { err(`${tag}: its switch must be in the room of the door it opens`); break; }
          const dx = Math.abs(a.x - (d.x + d.w / 2));
          if (a.y !== d.y + d.h) err(`${tag}: its switch must stand at the height of the door`);
          if (dx < 200 || dx > 700) err(`${tag}: its switch must be 200 to 700 px from the door (it is ${Math.round(dx)})`);
          if (!clearRun(solids(a.room), a.y, a.x, d.x + d.w / 2)) err(`${tag}: a wall or crate stands between its switch and the door`);
          if (dx / (MOVE_SPEED * TICK_DT) + ESCAPE_LIMITS.doorDelayTicks > ESCAPE_LIMITS.timedDoorTicks * 0.6) err(`${tag}: its switch is too far from the door for the time it gives`);
          break;
        }
        case 'flashlight_sensor': {
          const g = switchGroup(lock.sensors, 'sensor');
          if (!lock.sensors.includes(lock.genuine)) err(`${tag}: the working sensor is not one of its sensors`);
          for (const a of g) for (const b of g) if (a.id < b.id && Math.abs(a.x - b.x) < 110 && a.y === b.y) err(`${tag}: two sensors stand too close together`);
          break;
        }
        case 'symbol_match': {
          const k = spec.keypads.find((x) => x.id === lock.keypadId);
          if (!k) err(`${tag}: unknown keypad ${lock.keypadId}`); else if (!inSide(k.room, k.x)) err(`${tag}: its keypad is beyond the door`);
          const pic = clueIn(lock.pictureId, 'picture'), leg = clueIn(lock.legendId, 'legend');
          if (pic && leg) {
            if (pic.room === leg.room) err(`${tag}: its picture and its legend must be in two different rooms`);
            if (k && k.room !== pic.room && k.room !== leg.room) err(`${tag}: its keypad must be in the room of one of its two halves`);
            const glyphs = parseGlyphs(pic.text), legend = parseLegend(leg.text);
            const spelled = glyphs && legend ? symbolCode(glyphs, legend) : null;
            if (spelled !== lock.code) err(`${tag}: its picture and legend spell ${String(spelled)}, not the code ${lock.code}`);
          }
          break;
        }
        default: break;
      }
    }
  });
  // P4 step 6: EVERY safe (the one a door needs, and the optional one that holds the gun) is solvable from INSIDE ITS OWN ROOM, by one player, within two slots:
  // all its pages lie in the safe's room (so nobody finds the digits and then has to leave to open it), they spell the combination, and what it holds is one genuine
  // part of at most one hand. A safe a door depends on (a MANDATORY safe) must hold the part that opens that door and nothing else may be needed to open it.
  for (const s of spec.safes) {
    if (s.clueIds.length === 0) err(`safe ${s.id} has no pages`);
    for (const id of s.clueIds) {
      const c = clueById.get(id);
      if (!c) err(`safe ${s.id}: unknown page ${id}`);
      else if (c.room !== s.room) err(`safe ${s.id}: its page ${id} lies in ${c.room}, not in the safe's own room ${s.room}`);
    }
    if (digitsOf(s.clueIds) !== s.code) err(`safe ${s.id}: its pages do not spell its combination`);
    const held = items.find((i) => i.id === s.contains);
    if (held) {
      if (itemRoom(held) !== s.room) err(`safe ${s.id}: what it holds must be in the same room`);
      if ((held.slots ?? ITEM_KIND_SPECS[held.kind].defaultSlots) > ITEM_LIMITS.carrySlots) err(`safe ${s.id}: what it holds does not fit in two slots`);
      if (held.decoy === true) err(`safe ${s.id}: what it holds cannot be a decoy`);
    }
    const needed = spec.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id);
    if (needed && (!held || (held.kind !== 'access_key' && held.kind !== 'battery'))) err(`mandatory safe ${s.id} must hold the key or part that opens its door`);
  }
  // every safe is used by a safe lock or is a decoy that holds nothing useful; a safe that holds a key must belong to a lock
  for (const s of spec.safes) {
    if (s.contains !== undefined && !items.some((i) => i.id === s.contains)) err(`safe ${s.id} contains unknown item ${s.contains}`);
    const holdsGun = items.find((i) => i.id === s.contains)?.kind === 'pulse_gun'; // P3E step 4: the gun's own safe belongs to no door
    if (s.contains !== undefined && !holdsGun && !spec.links.some((l) => l.lock.type === 'safe' && l.lock.safeId === s.id)) err(`safe ${s.id} holds a part but no door uses it`);
  }
  for (const k of spec.keypads) if (!spec.links.some((l) => (l.lock.type === 'code' || l.lock.type === 'symbol_match') && l.lock.keypadId === k.id)) err(`keypad ${k.id} opens nothing`);
  // P3F step 2: every switch belongs to exactly one lock
  const switchOwner = new Map<string, number>();
  spec.links.forEach((l, n) => { for (const id of switchIdsOf(l.lock)) { if (switchOwner.has(id) && switchOwner.get(id) !== n) err(`switch ${id} belongs to two locks`); switchOwner.set(id, n); } });
  for (const x of spec.switches) if (!switchOwner.has(x.id)) err(`switch ${x.id} opens nothing`);
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
  // P4 step 3: the Revive Cell. Optional for the stage's own solution (no lock needs it) but, when there, it must be REACHABLE (lying in the open on a floor of
  // a room, never locked away: a body has only a short window), CARRYABLE next to another part (one hand) and genuine, and a stage holds at most one.
  const openFromStart = new Set<string>([graph.start]);
  for (const q = [graph.start]; q.length;) for (const d of rooms.get(q.shift()!)?.doors ?? []) if (!linkOf.has(d.id) && !openFromStart.has(d.to) && rooms.has(d.to)) { openFromStart.add(d.to); q.push(d.to); }
  const cells = items.filter((i) => i.kind === 'revive_cell');
  if (cells.length > 1) err('a stage holds at most one Revive Cell');
  for (const c of cells) {
    if (c.decoy === true) err(`revive cell ${c.id} cannot be a decoy`);
    if (c.hidden) err(`revive cell ${c.id} must lie in the open (a body has only a short window)`);
    if ((c.slots ?? ITEM_KIND_SPECS.revive_cell.defaultSlots) * 2 > ITEM_LIMITS.carrySlots) err(`revive cell ${c.id} must fit in one hand, so it can be carried next to another part`);
    standing(c.id, 'revive cell', itemRoom(c), c.x, c.y);
    // a body has only a short window: the cell must lie where a team can get it WITHOUT SOLVING ANY LOCK (the start room, plus rooms joined to it by doors that have no lock)
    if (!openFromStart.has(itemRoom(c))) err(`revive cell ${c.id} lies behind a lock: a team could not get it within the revive window`);
  }
  for (const h of spec.hidingSpots ?? []) { claim(h.id, 'hiding spot'); standing(h.id, 'hiding spot', h.room, h.x, h.y); }
  for (const v of spec.ghostEvidence ?? []) {
    claim(v.id, 'evidence'); standing(v.id, 'evidence', v.room, v.x, v.y);
    if (evidenceOwner(v.kind) !== v.ghost) err(`evidence ${v.id}: kind ${v.kind} does not belong to a ${v.ghost}`);
  }
  if (!rooms.has(spec.exit.room)) err(`exit room ${spec.exit.room} does not exist`);
  return errs;
}

/**
 * P4 step 3: a ghost stage holds exactly one Revive Cell on Easy and Intermediate (a rare chance to bring a teammate back) and none on Hardcore
 * (a Hardcore death is final). The generator calls this when the run has a ghost.
 */
export function requireRevive(def: Pick<StageDef, 'items'>, difficulty: 'easy' | 'intermediate' | 'hardcore'): string[] {
  const n = (def.items ?? []).filter((i) => i.kind === 'revive_cell').length;
  if (difficulty === 'hardcore') return n === 0 ? [] : [`a Hardcore stage holds no Revive Cell (it holds ${n})`];
  return n === 1 ? [] : [`a ghost stage on ${difficulty} must hold exactly one Revive Cell (it holds ${n})`];
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

/**
 * P3F step 1: EVERYTHING a player must reach is reachable on foot. For every room this runs the real movement function (`stepBody`, through the salvage reach graph)
 * from where players start (the four spawn slots) and arrive (the arrival point of every door that leads into the room), and demands that
 *   1. every start stands on a platform;
 *   2. (a room without a gate) every start can reach every other start, so a team can walk from the west door to the east door and back;
 *   3. everything a player has to find or use (items, lockers, clues, keypads, safes, switches, hiding spots, evidence, the exit) and every door stands on a platform
 *      that a lone player reaches from one of those starts, with no ability, crate or help.
 * A room with a gate (one whose doors lead back into the same room) is cut by a wall: there the starts on each side are separate by design and only (1) and (3) hold.
 * A thing that fails this is the generator's fault, and the attempt is thrown away.
 */
export function requireReachable(def: Pick<StageDef, 'rooms' | 'escape' | 'items' | 'stashes'>): string[] {
  const errs: string[] = [];
  const graph = def.rooms;
  if (!graph) return errs;
  const spec = def.escape;
  const arrivals = new Map<string, { x: number; y: number }[]>();
  for (const r of graph.rooms) for (const d of r.doors) { const list = arrivals.get(d.to) ?? []; list.push(d.arrive); arrivals.set(d.to, list); }
  for (const r of graph.rooms) {
    const a = canonicalArena(r.arena), gated = r.doors.some((d) => d.to === r.id);
    const starts = [...a.spawns, ...(arrivals.get(r.id) ?? [])].map((p) => ({ p, i: platformIndex(a, p.x, p.y) }));
    let ok = true;
    for (const s of starts) if (s.i < 0 || Math.abs(a.solids[s.i]!.y - s.p.y) > 1.5) { errs.push(`room ${r.id}: a start at (${s.p.x}, ${s.p.y}) stands on nothing`); ok = false; }
    if (!ok) continue;
    const reach = new Set<number>();
    for (const s of starts) for (const i of reachableFrom(a, s.i)) reach.add(i);
    if (!gated) for (const s of starts) { const own = reachableFrom(a, s.i); for (const o of starts) if (!own.has(o.i)) errs.push(`room ${r.id}: a player starting at (${s.p.x}, ${s.p.y}) cannot reach (${o.p.x}, ${o.p.y})`); }
    const check = (what: string, id: string, x: number, y: number) => {
      const i = platformIndex(a, x, y);
      if (i < 0 || !reach.has(i)) errs.push(`room ${r.id}: ${what} ${id} at (${x}, ${y}) cannot be reached on foot`);
    };
    for (const d of r.doors) check('door', d.id, d.x + d.w / 2, d.y + d.h);
    const here = (room: string | undefined) => (room ?? graph.start) === r.id;
    for (const i of def.items ?? []) if (here(i.room)) check('item', i.id, i.x, i.y);
    for (const s of def.stashes ?? []) if (here(s.room)) check('stash', s.id, s.x, s.y);
    if (spec) {
      for (const c of spec.clues) if (c.room === r.id) check('clue', c.id, c.x, c.y);
      for (const k of spec.keypads) if (k.room === r.id) check('keypad', k.id, k.x, k.y);
      for (const s of spec.safes) if (s.room === r.id) check('safe', s.id, s.x, s.y);
      for (const s of spec.switches) if (s.room === r.id) check('switch', s.id, s.x, s.y);
      for (const h of spec.hidingSpots ?? []) if (h.room === r.id) check('hiding spot', h.id, h.x, h.y);
      for (const v of spec.ghostEvidence ?? []) if (v.room === r.id) check('evidence', v.id, v.x, v.y);
      if (spec.exit.room === r.id) check('exit', 'exit', spec.exit.x, spec.exit.y);
    }
  }
  return errs;
}
