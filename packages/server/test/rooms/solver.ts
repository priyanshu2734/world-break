import type { Arena, RoomGraph } from '@wb/shared';
import { Room } from '../../src/room';
import { generateEscapeStage } from '../../src/rooms/generate';
import type { StageDef } from '../../src/systems/stageDef';
import { Bot, Team } from './bot';
import { digits, esc, expectOk, fetchItem, itemAct, seen, type Play } from './flows';

/**
 * The real-physics solvability bot (P3D step 5). It reads a generated stage's PRIVATE definition and plays it through the public Room API
 * with real input and the real movement function: walking, falling, jumping from platform to platform, opening lockers, reading notes,
 * typing codes, lighting switches, using doors with E. It fails loudly if anything in the stage cannot actually be done.
 * `coop` makes every other player follow through each opened door, and a two-person lock is lit by two different players at once.
 */
export interface SolveStats {
  maxSlots: number; doors: number; ticks: number;
  /** P4 step 5: parts the solver went and picked up again from where they came to rest (after a death dropped them). */
  recovered: number;
  /** P4 step 5: how many times the lead player died and the next living player took over. */
  leadChanges: number;
}

/** P4 step 5: what the solver tells a drill each time a player has just fetched a part that is needed later (the drill may kill them here). */
export interface FetchedEvent { who: string; itemId: string; kind: string; index: number }

export function newRun(players: number, runSeed = 7): { room: Room; ids: string[] } {
  const room = new Room('ABCD', 4, runSeed, { escape: true });
  const ids = Array.from({ length: players }, (_, i) => `p${i}`);
  ids.forEach((id, i) => { room.join(id, `P${i}`); if (i > 0) room.setReady(id, true); });
  if (!room.start('p0').ok) throw new Error('start refused');
  for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  return { room, ids };
}

/** The definition the room is playing (the generator is deterministic in (stage, seed), so this is the very same stage). */
export function currentDef(room: Room): StageDef {
  const rec = room.stageRecord!;
  const def = generateEscapeStage(rec.stage, rec.seed);
  if (def.id !== rec.defId) throw new Error(`room plays ${rec.defId}, generator says ${def.id}`);
  return def;
}

/** Clear the current stage with the solver, then jump the counter so the NEXT stage is `stage` (the same trick as the endless-loop test). */
export function advanceTo(room: Room, ids: string[], stage: number): StageDef {
  if (stage > room.stage) {
    solveStage(room, ids, currentDef(room));
    room.stage = stage - 1;
    if (!room.nextStage('p0').ok) throw new Error('nextStage refused');
    for (let i = 0; i < 20 && room.phase !== 'playing'; i++) room.tick();
  }
  return currentDef(room);
}

const graphOf = (def: StageDef): RoomGraph => def.rooms!;

export function solveStage(room: Room, ids: string[], def: StageDef, opts: { coop?: boolean; /** P3E step 5: build the Team yourself (the ghost tests pass one that hides when warned). */ team?: (room: Room, arenaOf: (roomId: string) => Arena) => Team; /** P4 step 5: called right after a needed part was fetched (a drill kills the carrier here to prove the part can be recovered). */ onFetched?: (e: FetchedEvent) => void } = {}): SolveStats {
  const graph = graphOf(def), spec = def.escape!;
  const arenas = new Map(graph.rooms.map((r) => [r.id, r.arena]));
  const team = opts.team ? opts.team(room, (id) => arenas.get(id)!) : new Team(room, (id) => arenas.get(id)!);
  const bots = ids.map((id) => new Bot(team, id));
  const play: Play = { room, team, bots, ids, arenas };
  const stats: SolveStats = { maxSlots: 0, doors: 0, ticks: 0, recovered: 0, leadChanges: 0 };
  let lead = bots[0]!, leadId = ids[0]!;
  // P4 step 5: a player may die while the stage is being solved. The dead can do nothing; the next living player takes over as lead, and any part the dead
  // one was carrying (dropped where they fell, moved to a floor a player can reach) is gone back for. Nothing here changes a run in which nobody dies.
  const dead = (id: string): boolean => room.deathSystem?.isDead(id) ?? false;
  const ensureLead = (): void => {
    if (!dead(leadId)) return;
    const i = ids.findIndex((id) => !dead(id));
    if (i < 0) throw new Error('everyone is dead');
    lead = bots[i]!; leadId = ids[i]!; stats.leadChanges++;
  };
  let fetches = 0;
  team.tick();

  const roomDef = (id: string) => graph.rooms.find((r) => r.id === id)!;
  const doorBox = (doorId: string) => { for (const r of graph.rooms) { const d = r.doors.find((x) => x.id === doorId); if (d) return { room: r.id, x: d.x + d.w / 2, y: d.y + d.h, to: d.to }; } throw new Error(`no door ${doorId}`); };
  const isOpen = (doorId: string) => team.state().escape!.doors.find((d) => d.id === doorId)?.open === true;
  const slots = (who: string) => { const n = team.state().items?.players.find((x) => x.id === who)?.slotsUsed ?? 0; stats.maxSlots = Math.max(stats.maxSlots, n); if (n > 2) throw new Error(`${who} holds ${n} parts (limit 2)`); };

  /**
   * P4 step 5: make sure the lead holds part `itemId` (fetched earlier, perhaps by somebody who has died since). Waits for a dying player's drops to finish, then
   * walks to where the part RESTS (the item system moved it to a reachable floor) and picks it up again, within the 2 slots.
   */
  const ensureHeld = (itemId: string): void => {
    ensureLead();
    const get = () => team.state().items!.items.find((i) => i.id === itemId);
    for (let guard = 0; guard < 120; guard++) {
      const c = get();
      if (c && c.state === 'carried' && c.carrierId && dead(c.carrierId)) team.idle(5); else break; // still being put down
    }
    const it = get();
    if (!it) throw new Error(`${itemId} is gone`);
    if (it.state === 'carried' && it.carrierId === leadId) return;
    if (it.state !== 'in_world') throw new Error(`${itemId} is ${it.state} (carried by ${it.carrierId ?? 'nobody'}) and cannot be recovered`);
    travel(lead, leadId, it.roomId ?? graph.start);
    lead.goTo(it.x, it.y);
    expectOk(fetchItem(play, lead, itemId, leadId));
    slots(leadId);
    stats.recovered++;
  };
  /** A part has just been fetched for later: tell a drill (it may kill the carrier), then make sure somebody alive holds it. */
  const fetched = (who: string, itemId: string, kind: string): void => {
    opts.onFetched?.({ who, itemId, kind, index: fetches++ });
    ensureLead();
    ensureHeld(itemId);
  };

  /** Use a door (E) and wait to arrive. */
  const through = (b: Bot, who: string, doorId: string) => {
    const d = doorBox(doorId);
    // P4 step 5: up to three tries. A survival reflex (the hiding bot) can pull a player away from the door while the crossing is still under way, which a
    // person would simply retry; the first try is the only one in a run with no interruption, so those runs are unchanged.
    for (let attempt = 0; attempt < 3 && (attempt === 0 || team.roomOf(who) !== d.to); attempt++) { // the first try always runs (a gate leads to the room you are already in)
      b.goTo(d.x, d.y);
      expectOk(esc(play, { action: 'use_door', doorId }, who));
      team.waitForRoom(who, d.to, 40);
    }
    if (team.roomOf(who) !== d.to) throw new Error(`${who} did not reach ${d.to}`);
    stats.doors++;
  };
  /** Walk a player to a room along OPEN doors (a shortest path over the room graph). */
  const travel = (b: Bot, who: string, target: string) => {
    for (let guard = 0; guard < 12 && team.roomOf(who) !== target; guard++) {
      const here = team.roomOf(who)!;
      const prev = new Map<string, { from: string; door: string }>();
      const queue = [here];
      while (queue.length && !prev.has(target)) {
        const r = queue.shift()!;
        for (const d of roomDef(r).doors) if (d.to !== r && isOpen(d.id) && !prev.has(d.to) && d.to !== here) { prev.set(d.to, { from: r, door: d.id }); queue.push(d.to); }
      }
      if (!prev.has(target)) throw new Error(`no open route from ${here} to ${target}`);
      let step = target;
      while (prev.get(step)!.from !== here) step = prev.get(step)!.from;
      through(b, who, prev.get(step)!.door);
    }
  };
  const note = new Map<string, string>(); // clue id -> text read
  const readClue = (b: Bot, who: string, clueId: string) => {
    const c = spec.clues.find((x) => x.id === clueId)!;
    travel(b, who, c.room); b.goTo(c.x, c.y);
    expectOk(esc(play, { action: 'read', clueId }, who));
    note.set(clueId, team.notes.at(-1)!.text);
  };
  const used = new Set<string>();
  /** Fetch a genuine part of `kind` from the near side (opening its locker first when it is hidden in one). */
  const fetchPart = (b: Bot, who: string, kind: 'access_key' | 'battery', nearRooms: ReadonlySet<string>, beforeX: { room: string; x: number } | null): string => {
    const safeKeys = new Set(spec.safes.map((s) => s.contains));
    const it = (def.items ?? []).find((i) => i.kind === kind && i.decoy !== true && !safeKeys.has(i.id) && !used.has(i.id)
      && nearRooms.has(i.room ?? graph.start) && !(beforeX && (i.room ?? graph.start) === beforeX.room && i.x >= beforeX.x));
    if (!it) throw new Error(`no genuine ${kind} available`);
    used.add(it.id);
    const room = it.room ?? graph.start;
    travel(b, who, room);
    if (it.hidden?.stashId) {
      const st = (def.stashes ?? []).find((s) => s.id === it.hidden!.stashId)!;
      b.goTo(st.x, st.y);
      expectOk(itemAct(play, { action: 'open', stashId: st.id }, who));
    }
    expectOk(fetchItem(play, b, it.id, who));
    slots(who);
    return it.id;
  };

  // links in the order a player meets them: by distance of their near door from the start room
  const dist = new Map<string, number>([[graph.start, 0]]);
  for (const q = [graph.start]; q.length;) { const r = q.shift()!; for (const d of roomDef(r).doors) if (!dist.has(d.to)) { dist.set(d.to, dist.get(r)! + 1); q.push(d.to); } }
  const ordered = spec.links.map((l) => {
    const [a, b] = l.doors.map(doorBox) as [ReturnType<typeof doorBox>, ReturnType<typeof doorBox>];
    const gate = a.room === b.room;
    const nearDoor = gate ? (a.x < b.x ? l.doors[0] : l.doors[1]) : (dist.get(a.room)! < dist.get(b.room)! ? l.doors[0] : l.doors[1]);
    return { l, gate, nearDoor, near: doorBox(nearDoor).room, far: doorBox(nearDoor === l.doors[0] ? l.doors[1] : l.doors[0]) };
  }).sort((p, q) => dist.get(p.near)! - dist.get(q.near)!);

  const reached = new Set<string>([graph.start]);
  for (const { l, gate, nearDoor, near, far } of ordered) {
    ensureLead();
    const lock = l.lock;
    // everything on the near side: the rooms reachable from the start without this door, and (for a gate) only left of it
    const nearRooms = new Set(reached);
    const gateX = gate ? doorBox(nearDoor).x : null;
    const before = gate ? { room: near, x: gateX! } : null;
    travel(lead, leadId, near);
    if (lock.type === 'key_item') fetched(leadId, fetchPart(lead, leadId, 'access_key', nearRooms, before), 'access_key');
    else if (lock.type === 'power') fetched(leadId, fetchPart(lead, leadId, 'battery', nearRooms, before), 'battery');
    else if (lock.type === 'code') {
      lock.clueIds.forEach((id) => readClue(lead, leadId, id));
      const code = lock.clueIds.map((id) => digits(note.get(id)!)).join('');
      const k = spec.keypads.find((x) => x.id === lock.keypadId)!;
      travel(lead, leadId, k.room); lead.goTo(k.x, k.y);
      expectOk(esc(play, { action: 'enter_code', targetId: k.id, code }, leadId));
    } else if (lock.type === 'two_person') {
      const a = spec.switches.find((x) => x.id === lock.switchA)!, b = spec.switches.find((x) => x.id === lock.switchB)!;
      const mateIdx = ids.findIndex((id) => id !== leadId && !dead(id));
      if (opts.coop && mateIdx >= 0) {
        const other = bots[mateIdx]!, otherId = ids[mateIdx]!;
        travel(other, otherId, a.room);
        lead.goTo(a.x, a.y); other.goTo(b.x, b.y);
        expectOk(esc(play, { action: 'press', switchId: a.id }, leadId));
        expectOk(esc(play, { action: 'press', switchId: b.id }, otherId));
      } else {
        travel(lead, leadId, a.room); lead.goTo(a.x, a.y);
        expectOk(esc(play, { action: 'press', switchId: a.id }, leadId));
        lead.goTo(b.x, b.y); // a lone player runs to the second switch inside the hold time
        expectOk(esc(play, { action: 'press', switchId: b.id }, leadId));
      }
    } else {
      const s = spec.safes.find((x) => x.id === lock.safeId)!;
      s.clueIds.forEach((id) => readClue(lead, leadId, id));
      const combo = s.clueIds.map((id) => digits(note.get(id)!)).join('');
      travel(lead, leadId, s.room); lead.goTo(s.x, s.y);
      expectOk(esc(play, { action: 'enter_code', targetId: s.id, code: combo }, leadId));
      expectOk(fetchItem(play, lead, s.contains!, leadId));
      slots(leadId);
      fetched(leadId, s.contains!, 'safe_item');
    }
    travel(lead, leadId, near);
    through(lead, leadId, nearDoor);
    reached.add(far.room);
    for (const id of l.doors) if (!isOpen(id)) throw new Error(`door ${id} is not open after its lock was solved`);
    if (opts.coop) {
      for (let i = 0; i < bots.length; i++) {
        if (ids[i] === leadId || dead(ids[i]!)) continue; // the dead stay where they fell
        if (gate) through(bots[i]!, ids[i]!, nearDoor); // a gate is crossed by every player, within the one room
        else travel(bots[i]!, ids[i]!, team.roomOf(leadId)!);
        slots(ids[i]!);
      }
    }
  }
  // the exit
  ensureLead();
  travel(lead, leadId, spec.exit.room);
  lead.goTo(spec.exit.x, spec.exit.y);
  team.idle(3);
  stats.ticks = room.gameSnapshot()?.tick ?? 0;
  if (room.phase !== 'stage_complete') throw new Error(`the stage is not cleared (phase ${room.phase})`);
  void seen;
  return stats;
}
