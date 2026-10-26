import {
  ESCAPE_LIMITS, ITEM_LIMITS, TUTORIAL_AMBIENT_MIN, createRng, decoysForStage, deriveSeed, ghostPresentOnStage, hidingSpotsForStage, locksForStage, roomCountForStage,
  type LockType, type RoomDef, type RoomGraph, type Rng,
} from '@wb/shared';
import { StageDefSchema, type StageDef } from '../systems/stageDef';
import { validateStageDef } from '../systems/validate';
import type { EscapeSpec, Lock } from './escapeSpec';
import { bareEscapeStage } from './stageBase';
import { requireGun } from './escapeValidate';

/** P3E step 4: from this stage the Pulse Gun is in a SAFE (a 3-digit combination found on notes in the start room); before it, in a plain locker. */
export const GUN_SAFE_FROM_STAGE = 5;
/** Options of the generator. `ghost: true` = the run has a ghost: every ghost stage then holds one Pulse Gun. Default (off) = exactly the earlier stages. */
export interface GenerateOptions { ghost?: boolean }

/**
 * P3D step 5: the seeded escape-stage generator. It builds EVERY stage of an escape run (stage 1 included) from `(stage, seed)` alone, so a
 * stage is reproducible and the loop is endless: the room count is capped at 6 and nothing else grows with the stage number.
 *
 *   stage 1  one room, one gate in a wall, one hidden key in a visible locker, the exit behind the gate. Lit more than any other stage. No decoys.
 *   stage 2+ 1 to 6 rooms (table in shared `roomCountForStage`), one door between each pair of rooms, a different lock on every door, never the
 *            same lock type on two neighbouring doors, clues, decoys, and placeholder hiding spots for the ghost (P3E).
 *
 * Solvability is by construction (every resource of a lock lies on the near side of it, clue digits spell the codes, switches are one run apart)
 * and is then proved twice: `validateStageDef` runs before a stage is returned, and the test suite plays every generated stage with the real physics.
 */

interface Pt { x: number; y: number }
interface Solid { x: number; y: number; w: number; h: number }
interface Plan {
  index: number; id: string; width: number; floorY: number; limitX: number;
  solids: Solid[]; platforms: Solid[]; taken: Pt[];
}

const FLOOR_Y = 680;
const HEIGHT = 720;
const SPOT_GAP = 120;     // two things on one surface are at least this far apart
const FIRST_SPOT_X = 560; // clear of the spawn row (300 to 450) and the arrival point (200)
/** Spawns are at x 300 to 450; 700 is within the smallest vision radius (300 px) of the nearest spawn and within 400 of the farthest. */
const TUTORIAL_LOCKER_MAX_X = 700;
const GATE = { wallX: 1380, wallW: 40, doorW: 40, intoAlcove: 1560, backOut: 1240, exitX: 1760, limitX: 1240 } as const;

const DIGITS = '0123456789';
const digitsOf = (rng: Rng, n: number): string => Array.from({ length: n }, () => DIGITS[rng.int(0, 9)]).join('');

/** Free spots of a room: along the floor and on top of each platform. */
function spots(plan: Plan, surface: 'floor' | 'platform' | 'any'): Pt[] {
  const out: Pt[] = [];
  if (surface !== 'platform') for (let x = FIRST_SPOT_X; x <= plan.limitX; x += 130) out.push({ x, y: plan.floorY });
  if (surface !== 'floor') for (const p of plan.platforms) out.push({ x: Math.round(p.x + p.w / 2), y: p.y });
  return out.filter((s) => !plan.taken.some((t) => t.y === s.y && Math.abs(t.x - s.x) < SPOT_GAP));
}
function take(plan: Plan, rng: Rng, surface: 'floor' | 'platform' | 'any', keep?: (s: Pt) => boolean): Pt {
  const c = spots(plan, surface).filter((s) => keep?.(s) ?? true);
  if (c.length === 0) throw new Error(`room ${plan.id}: no free ${surface} spot`);
  const s = rng.pick(c);
  plan.taken.push(s);
  return s;
}

function planRoom(rng: Rng, stage: number, prefix: string, index: number, single: boolean): Plan {
  const id = `${prefix}.r${index}`;
  const width = single ? 1920 : rng.pick([1920, 2240, 2560]);
  const limitX = single ? GATE.limitX : width - 460;
  const solids: Solid[] = [{ x: 0, y: FLOOR_Y, w: width, h: 40 }];
  const platforms: Solid[] = [];
  // an ascending staircase (each step 90 px higher, a short gap between steps): every platform is a jump from the one before it
  const want = stage <= 1 ? 0 : stage <= 6 ? rng.int(1, 2) : rng.int(1, 3);
  let x = rng.int(FIRST_SPOT_X, FIRST_SPOT_X + 120);
  for (let k = 0; k < want; k++) {
    const w = rng.int(240, 280);
    if (x + w > limitX) break;
    platforms.push({ x, y: FLOOR_Y - 90 * (k + 1), w, h: 20 });
    x += w + rng.int(60, 95);
  }
  solids.push(...platforms);
  if (single) solids.push({ x: GATE.wallX, y: 0, w: GATE.wallW, h: FLOOR_Y }); // the wall the gate is set into: floor to ceiling
  return { index, id, width, floorY: FLOOR_Y, limitX, solids, platforms, taken: [] };
}

const NOISE_NOTES = [
  'Coffee rings and a doodle of a door. Nothing useful.',
  'A shopping list: filters, tape, more tape.',
  'Somebody wrote "not it" on this page and underlined it twice.',
  'A torn timetable. The last shuttle left long ago.',
];
const CODE_NOTE = (d: string) => `A scorched log. Only these survive: ${d.split('').join(' ')}.`;
const HALF_NOTE = (d: string, i: number) => `Scorched log, page ${i === 0 ? 'one' : 'two'}: ${d.split('').join(' ')}.`;
const COMBO_NOTE = (n: number, d: string) => `Torn page: the ${['first', 'second', 'third'][n]} number of the safe is ${d}.`;

/** The result of one attempt. */
/** One attempt (exported for the tests, which prove the first attempt of every tested stage and seed is valid). */
export function attemptEscapeStage(stage: number, seed: number, tryNo: number, opts: GenerateOptions = {}): StageDef {
  const rng = createRng(deriveSeed(seed, 'escape', stage, tryNo));
  const count = roomCountForStage(stage);
  const single = count === 1;
  const prefix = `e${stage}_${(deriveSeed(seed, 'id', stage) >>> 0).toString(36).slice(0, 5)}`;
  const plans = Array.from({ length: count }, (_, i) => planRoom(rng, stage, prefix, i, single));

  // ---- doors and links
  const doors: Record<string, RoomDef['doors']> = {};
  const links: EscapeSpec['links'] = [];
  const linkDoors: [string, string][] = [];
  for (const p of plans) doors[p.id] = [];
  if (single) {
    const p = plans[0]!;
    doors[p.id]!.push(
      { id: `${p.id}_gi`, x: GATE.wallX - GATE.doorW, y: FLOOR_Y - 100, w: GATE.doorW, h: 100, to: p.id, arrive: { x: GATE.intoAlcove, y: FLOOR_Y } },
      { id: `${p.id}_go`, x: GATE.wallX + GATE.wallW, y: FLOOR_Y - 100, w: GATE.doorW, h: 100, to: p.id, arrive: { x: GATE.backOut, y: FLOOR_Y } },
    );
    linkDoors.push([`${p.id}_gi`, `${p.id}_go`]);
  } else {
    for (let i = 0; i + 1 < count; i++) {
      const a = plans[i]!, b = plans[i + 1]!;
      doors[a.id]!.push({ id: `${a.id}_e`, x: a.width - 80, y: FLOOR_Y - 100, w: 40, h: 100, to: b.id, arrive: { x: 200, y: FLOOR_Y } });
      doors[b.id]!.push({ id: `${b.id}_w`, x: 60, y: FLOOR_Y - 100, w: 40, h: 100, to: a.id, arrive: { x: a.width - 180, y: FLOOR_Y } });
      linkDoors.push([`${a.id}_e`, `${b.id}_w`]);
    }
  }

  // ---- one lock per link: a different type from the previous door, from the types this stage may use
  const allowed = locksForStage(stage);
  const types: LockType[] = [];
  for (let i = 0; i < linkDoors.length; i++) {
    const pool = allowed.filter((t) => t !== types[i - 1]);
    types.push(rng.pick(pool.length > 0 ? pool : allowed));
  }

  // ---- resources of each lock, on the near side of it
  const items: NonNullable<StageDef['items']> = [];
  const stashes: NonNullable<StageDef['stashes']> = [];
  const clues: EscapeSpec['clues'] = [];
  const keypads: EscapeSpec['keypads'] = [];
  const safes: EscapeSpec['safes'] = [];
  const switches: EscapeSpec['switches'] = [];
  const decoys = decoysForStage(stage);
  const gunOn = opts.ghost === true && ghostPresentOnStage(stage);
  // the Pulse Gun is one more part of the stage: it is counted before the decoys are, so the 12-part cap always leaves room for it
  let decoyBudget = ITEM_LIMITS.maxItemsPerStage - types.filter((t) => t === 'key_item' || t === 'power' || t === 'safe').length - (gunOn ? 1 : 0);

  types.forEach((type, i) => {
    const room = plans[i]!;                       // the room of the door's near side
    const back = i > 0 ? plans[i - 1]! : null;    // a note may lie in the room before (a short walk back)
    const tag = `${prefix}_l${i}`;
    let lock: Lock;
    const addKey = (kind: 'access_key' | 'battery', where: Plan, hide: boolean) => {
      const genuine = `${tag}_${kind === 'battery' ? 'bat' : 'key'}`;
      if (hide) {
        // the tutorial's locker is always in view from every spawn slot: containers are the first thing it teaches
        const s = take(where, rng, 'floor', stage <= 1 ? (c) => c.x <= TUTORIAL_LOCKER_MAX_X : undefined);
        stashes.push({ id: `${tag}_locker`, kind: 'locker', label: 'Locker', x: s.x, y: s.y, room: where.id });
        items.push({ id: genuine, kind, x: s.x, y: s.y, room: where.id, hidden: { container: 'locker', reveal: 'interact', stashId: `${tag}_locker` } });
      } else {
        const s = take(where, rng, 'any');
        items.push({ id: genuine, kind, x: s.x, y: s.y, room: where.id });
      }
      const n = Math.min(decoys, decoyBudget); // cracked look-alikes, within what the 12-part stage cap leaves after every genuine part
      decoyBudget -= n;
      for (let d = 0; d < n; d++) {
        const s = take(where, rng, 'any');
        items.push({ id: `${tag}_${kind === 'battery' ? 'bat' : 'key'}_cracked${d}`, kind, x: s.x, y: s.y, room: where.id, decoy: true, tell: true });
      }
    };
    const noise = () => {
      for (let d = 0; d < Math.min(decoys, 1); d++) { // at most one decoy note per lock: a 6-room stage can already hold 13 real notes
        const s = take(room, rng, 'any');
        clues.push({ id: `${tag}_noise${d}`, room: room.id, x: s.x, y: s.y, label: 'Old note', text: rng.pick(NOISE_NOTES) });
      }
    };
    const noteRoom = (): Plan => (back !== null && rng.chance(0.3) ? back : room);

    if (type === 'key_item') {
      // the tutorial always hides the key in a locker you can see; later stages sometimes leave it lying about
      addKey('access_key', room, stage <= 1 || rng.chance(0.6));
      lock = { type };
    } else if (type === 'power') {
      addKey('battery', room, rng.chance(0.5));
      lock = { type };
    } else if (type === 'code') {
      const code = digitsOf(rng, 4);
      const k = take(room, rng, 'floor');
      keypads.push({ id: `${tag}_pad`, room: room.id, x: k.x, y: k.y });
      const split = rng.chance(0.5);
      const parts = split ? [code.slice(0, 2), code.slice(2)] : [code];
      const clueIds = parts.map((d, n) => {
        const where = noteRoom(), s = take(where, rng, 'any'), id = `${tag}_note${n}`;
        clues.push({ id, room: where.id, x: s.x, y: s.y, label: 'Scorched log', text: split ? HALF_NOTE(d, n) : CODE_NOTE(d) });
        return id;
      });
      noise();
      lock = { type, keypadId: `${tag}_pad`, code, clueIds };
    } else if (type === 'two_person') {
      const a = take(room, rng, 'floor');
      const b = take(room, rng, 'floor', (s) => Math.abs(s.x - a.x) >= 260 && Math.abs(s.x - a.x) <= 800);
      switches.push({ id: `${tag}_swa`, room: room.id, x: a.x, y: a.y }, { id: `${tag}_swb`, room: room.id, x: b.x, y: b.y });
      lock = { type, switchA: `${tag}_swa`, switchB: `${tag}_swb` };
    } else {
      const combo = digitsOf(rng, 3);
      const s = take(room, rng, 'floor');
      const keyId = `${tag}_key_safe`;
      const clueIds = combo.split('').map((d, n) => {
        const where = noteRoom(), c = take(where, rng, 'any'), id = `${tag}_s${n}`;
        clues.push({ id, room: where.id, x: c.x, y: c.y, label: `Torn page ${n + 1}`, text: COMBO_NOTE(n, d) });
        return id;
      });
      safes.push({ id: `${tag}_safe`, room: room.id, x: s.x, y: s.y, code: combo, clueIds, contains: keyId });
      items.push({ id: keyId, kind: 'access_key', x: s.x, y: s.y, room: room.id, hidden: { container: 'locker', reveal: 'interact' } });
      noise();
      lock = { type, safeId: `${tag}_safe` };
    }
    links.push({ doors: linkDoors[i]!, lock });
  });

  // ---- placeholder hiding spots for the ghost (P3E). Inert here.
  const hidingSpots: NonNullable<EscapeSpec['hidingSpots']> = [];
  for (const p of plans) {
    for (let h = 0; h < hidingSpotsForStage(stage); h++) {
      if (spots(p, 'floor').length === 0) break;
      const s = take(p, rng, 'floor');
      hidingSpots.push({ id: `${p.id}_h${h}`, room: p.id, x: s.x, y: s.y, kind: h % 2 === 0 ? 'closet' : 'vent' });
    }
  }

  // ---- P3E step 4: the Pulse Gun. One per ghost stage, in the START room (so it needs no door opened to reach), locked in a locker or a safe.
  //      It is drawn from the same seeded generator AFTER everything else, so a stage without the ghost option is byte-for-byte what it was.
  if (gunOn) {
    const home = plans[0]!, gunId = `${prefix}_gun`;
    const useSafe = stage >= GUN_SAFE_FROM_STAGE && safes.length < ESCAPE_LIMITS.maxSafes && clues.length + 3 <= ESCAPE_LIMITS.maxClues && spots(home, 'any').length >= 4;
    if (useSafe) {
      const combo = digitsOf(rng, 3);
      const s = take(home, rng, 'floor');
      const clueIds = combo.split('').map((d, n) => {
        const c = take(home, rng, 'any'), id = `${prefix}_gs${n}`;
        clues.push({ id, room: home.id, x: c.x, y: c.y, label: `Torn page ${n + 1}`, text: COMBO_NOTE(n, d) });
        return id;
      });
      safes.push({ id: `${prefix}_gunsafe`, room: home.id, x: s.x, y: s.y, code: combo, clueIds, contains: gunId });
      items.push({ id: gunId, kind: 'pulse_gun', x: s.x, y: s.y, room: home.id, hidden: { container: 'locker', reveal: 'interact' } });
    } else {
      const s = take(home, rng, 'floor');
      stashes.push({ id: `${prefix}_gunlocker`, kind: 'locker', label: 'Locker', x: s.x, y: s.y, room: home.id });
      items.push({ id: gunId, kind: 'pulse_gun', x: s.x, y: s.y, room: home.id, hidden: { container: 'locker', reveal: 'interact', stashId: `${prefix}_gunlocker` } });
    }
  }

  // ---- the exit: in the alcove behind the gate, or in the last room
  const last = plans[count - 1]!;
  const exit = single ? { room: last.id, x: GATE.exitX, y: FLOOR_Y } : { room: last.id, x: last.width - 300, y: FLOOR_Y };

  const rooms: RoomDef[] = plans.map((p) => ({
    id: p.id,
    arena: { id: p.id, name: `Room ${p.index + 1}`, width: p.width, height: HEIGHT, solids: p.solids, spawns: [300, 350, 400, 450].map((x) => ({ x, y: FLOOR_Y })) },
    doors: doors[p.id]!,
  }));
  const graph: RoomGraph = { start: plans[0]!.id, rooms };
  const escape: EscapeSpec = { exit, links, keypads, safes, clues, switches, ...(hidingSpots.length > 0 ? { hidingSpots } : {}) };
  return StageDefSchema.parse({
    ...bareEscapeStage(`escape_${stage}`, stage === 1 ? 'Escape tutorial' : `Escape ${stage}`, graph, 20 * 60 * (5 + 3 * count)),
    stashes, items, escape,
    ...(stage === 1 ? { ambientMin: TUTORIAL_AMBIENT_MIN } : {}),
  });
}

export interface GeneratedEscape { def: StageDef; attempts: number }

/**
 * Stage N of an escape run. Deterministic in (stage, seed). Each attempt is checked by the full stage validator; an attempt that fails
 * (a room ran out of spots, say) is replaced by the next derived attempt, never by a different stage. Throws only if all 8 attempts fail,
 * which the test suite proves does not happen (every tested stage and seed succeeds on attempt 1).
 */
export function generateEscapeStageDetailed(stage: number, seed: number, opts: GenerateOptions = {}): GeneratedEscape {
  if (!Number.isSafeInteger(stage) || stage < 1) throw new Error(`Invalid stage number ${stage}`);
  let lastError = 'unknown';
  for (let tryNo = 0; tryNo < 8; tryNo++) {
    try {
      const def = attemptEscapeStage(stage, seed, tryNo, opts);
      const start = def.rooms!.rooms.find((r) => r.id === def.rooms!.start)!.arena;
      const errs = validateStageDef(def, start);
      if (opts.ghost === true && ghostPresentOnStage(stage)) errs.push(...requireGun(def));
      if (errs.length === 0) return { def, attempts: tryNo + 1 };
      lastError = errs.join('; ');
    } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
  }
  throw new Error(`escape stage ${stage} (seed ${seed}) could not be generated: ${lastError}`);
}
export function generateEscapeStage(stage: number, seed: number, opts: GenerateOptions = {}): StageDef { return generateEscapeStageDetailed(stage, seed, opts).def; }
