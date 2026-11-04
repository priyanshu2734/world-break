import {
  EVIDENCE_LABELS, JOURNAL, ESCAPE_LIMITS, ESCAPE_NOTHING, POINT_HEIGHT, RANGE_DY, bodyInDoor, needText,
  type EscapeAck, type EscapeAction, type EscapePublic, type GhostType, type RoomDef, type RoomGraph,
} from '@wb/shared';
import type { ItemSystem } from '../salvage/system';
import type { EscapeSpec, Lock } from './escapeSpec';

export type EscapeResult = ({ ok: true } & EscapeAck) | { ok: false; error: string };
const fail = (error: string): EscapeResult => ({ ok: false, error });
const ok = (message: string, note?: EscapeAck['note']): EscapeResult => ({ ok: true, message, ...(note ? { note } : {}) });

export interface EscapePos { x: number; y: number; connected: boolean }

/** What the escape mechanics may ask of their host (the stage engine, itself fed by the Room). A narrow seam, so it is unit-testable. */
export interface EscapeHost {
  readonly tick: number;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
  markDirty(): void;
  award(category: string, points: number): void;
  /** Penalty (positive) for forcing a cracked part into a lock. */
  wrongPartCost(): number;
  /** The room a player is in. */
  roomOf(playerId: string): string | undefined;
  /** Is the point (x, y) of the player's own room in that player's view? Anything out of view is "nothing there". */
  canSee(playerId: string, x: number, y: number): boolean;
  /** Carry the player through a door (the door's own room). Returns false if that was not possible. */
  sendThrough(playerId: string, doorId: string): boolean;
  /** P3F step 4: a loot cache was opened. The host pays the outcome (score, an upgrade, or a hazard) and answers with the words the opener reads. */
  loot?(o: { outcome: 'score' | 'upgrade' | 'hazard'; room: string; x: number; y: number; by: string }): string;
  /** The exit was reached alive: clear the stage (the existing STAGE_CLEAR transition does the rest). */
  clear(): void;
}

/** P3F step 2: the running state of a puzzle lock (all zero for the original five). */
interface LinkRt {
  lock: Lock; doors: readonly [string, string]; open: boolean; tried: boolean;
  /** lever sequence: levers already down in the right order. */
  step: number;
  /** wrong sequences (levers) or wrong wires, and the tick until which the panel refuses input. */
  wrong: number; lockedUntil: number;
  /** breaker panel: presses since the panel was last reset. */
  presses: number;
  /** timed door: the tick it locks again, and whether somebody has gone through (then it stays open). */
  openUntil: number; permanent: boolean;
  /** flashlight sensor: ticks in a row the working sensor has been lit. */
  seen: number;
}
/** The lock types that have a keypad and a 4-digit code. */
type KeypadLock = Extract<Lock, { keypadId: string }>;
const hasKeypad = (l: Lock): l is KeypadLock => l.type === 'code' || l.type === 'symbol_match';
interface Keypad { id: string; room: string; x: number; y: number; wrong: number; lockedUntil: number; solved: boolean; link: LinkRt | null }
interface Safe { id: string; room: string; x: number; y: number; code: string; contains: string | undefined; wrong: number; lockedUntil: number; opened: boolean }
interface Switch { id: string; room: string; x: number; y: number; litUntil: number; wasLit: boolean; /** lever down, breaker on: stays until a reset. */ latched: boolean }
/** What a switch is for (P3F step 2). A switch no lock names is a plain two-person switch. */
type Role =
  | { kind: 'lever' | 'breaker' | 'wire'; link: LinkRt; idx: number }
  | { kind: 'timer' | 'plate'; link: LinkRt }
  | { kind: 'sensor'; link: LinkRt; genuine: boolean };
interface Pending { doorId: string; at: number; x: number }

/**
 * The escape mechanics of one stage: doors that open with E after a short delay, five lock types, keypads, safes, clues, switches
 * and the exit. Every rule is enforced here, on the server. Order of checks for every intent: known player > rate limit >
 * room and reach (anything in another room, or nonexistent, gives the SAME refusal) > intent-specific rules.
 */
export class EscapeRuntime {
  private readonly links: LinkRt[];
  private readonly linkOfDoor = new Map<string, LinkRt>();
  private readonly doorRoom = new Map<string, { room: RoomDef; rect: { x: number; y: number; w: number; h: number } }>();
  private readonly keypads = new Map<string, Keypad>();
  private readonly safes = new Map<string, Safe>();
  private readonly switches = new Map<string, Switch>();
  private readonly roles = new Map<string, Role>();
  private readonly clues = new Map<string, EscapeSpec['clues'][number]>();
  private readonly pending = new Map<string, Pending>();
  /** Keypads and safes whose lockout is running (so its END is published, not only its start). */
  private readonly lockouts = new Set<{ lockedUntil: number }>();
  private readonly lastIntent = new Map<string, number>();
  private readonly players = new Set<string>();
  private cleared = false;
  /** P3F step 3: the shared team journal. `found` = evidence examined, `marks` = types entered (final for the stage). */
  private readonly evidence = new Map<string, NonNullable<EscapeSpec['ghostEvidence']>[number]>();
  private readonly found = new Set<string>();
  private readonly marks: GhostType[] = [];
  private readonly truth: ReadonlySet<GhostType>;
  private lootOpened = false;

  constructor(private readonly spec: EscapeSpec, graph: RoomGraph, private readonly host: EscapeHost, private readonly items: ItemSystem | null) {
    for (const room of graph.rooms) for (const d of room.doors) this.doorRoom.set(d.id, { room, rect: { x: d.x, y: d.y, w: d.w, h: d.h } });
    this.links = spec.links.map((l) => ({ lock: l.lock, doors: l.doors, open: false, tried: false, step: 0, wrong: 0, lockedUntil: 0, presses: 0, openUntil: 0, permanent: false, seen: 0 }));
    for (const l of this.links) for (const id of l.doors) this.linkOfDoor.set(id, l);
    for (const k of spec.keypads) {
      const link = this.links.find((l) => hasKeypad(l.lock) && l.lock.keypadId === k.id) ?? null;
      this.keypads.set(k.id, { ...k, wrong: 0, lockedUntil: 0, solved: false, link });
    }
    for (const s of spec.safes) this.safes.set(s.id, { id: s.id, room: s.room, x: s.x, y: s.y, code: s.code, contains: s.contains, wrong: 0, lockedUntil: 0, opened: false });
    for (const s of spec.switches) this.switches.set(s.id, { ...s, litUntil: 0, wasLit: false, latched: false });
    for (const l of this.links) this.arm(l);
    for (const c of spec.clues) this.clues.set(c.id, c);
    for (const v of spec.ghostEvidence ?? []) this.evidence.set(v.id, v);
    this.truth = new Set((spec.ghostEvidence ?? []).map((v) => v.ghost));
  }

  // ------------------------------------------------------------------ P3F step 3: the journal
  /** The journal has one line per ghost on the stage; none at all on a stage without evidence. */
  private get lines(): number { return this.truth.size; }
  /** The types the team entered AND that really run on this stage (server side only: drives the warning bonus and the gun). */
  identified(): GhostType[] { return this.marks.filter((g) => this.truth.has(g)); }

  private examine(pid: string, id: string, me: EscapePos): EscapeResult {
    const v = this.evidence.get(id);
    if (!v || !this.inRoom(pid, v.room) || !this.host.canSee(pid, v.x, v.y - POINT_HEIGHT.clue)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, v.x, v.y)) return fail('Too far away.');
    const label = EVIDENCE_LABELS[v.kind];
    if (this.found.has(id)) return ok(`${label}. Already in the team journal.`, { id, text: label });
    this.found.add(id);
    this.host.markDirty();
    this.host.say(`${label} is noted in the team journal.`, 'info', v.room);
    return ok(`${label}. It is written in the team journal.`, { id, text: label });
  }

  /** P3F step 4: the optional cache. Same refusals as everything else out of view; it can be opened once. */
  private openLoot(pid: string, id: string, me: EscapePos): EscapeResult {
    const c = this.spec.loot;
    if (!c || c.id !== id || !this.inRoom(pid, c.room) || !this.host.canSee(pid, c.x, c.y - POINT_HEIGHT.clue)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, c.x, c.y)) return fail('Too far away.');
    if (this.lootOpened) return fail('The cache is empty.');
    this.lootOpened = true;
    this.host.markDirty();
    const text = this.host.loot?.({ outcome: c.outcome, room: c.room, x: c.x, y: c.y, by: pid }) ?? 'The cache is empty.';
    return ok(text);
  }

  private mark(ghost: GhostType): EscapeResult {
    if (this.lines === 0) return fail('There is nothing to enter in the journal.');
    if (this.found.size < JOURNAL.minExamined) return fail('Examine some evidence first.');
    if (this.marks.includes(ghost)) return fail('That is already in the journal.');
    if (this.marks.length >= this.lines) return fail('Every line of the journal is used.');
    this.marks.push(ghost);
    if (!this.truth.has(ghost)) this.host.award(JOURNAL.category, -JOURNAL.wrongCost);
    this.host.markDirty();
    this.host.say(`The team journal now names a ${ghost}. Entries are final.`, 'info');
    return ok(`Entered: ${ghost}. A right entry helps the team, a wrong one costs ${JOURNAL.wrongCost} points.`);
  }

  /** P3F step 2: tell each switch of a puzzle lock what it is for, and set the breakers to their starting positions. */
  private arm(link: LinkRt): void {
    const lock = link.lock;
    const set = (ids: readonly string[], kind: 'lever' | 'breaker' | 'wire') => ids.forEach((id, idx) => this.roles.set(id, { kind, link, idx }));
    switch (lock.type) {
      case 'lever_sequence': set(lock.levers, 'lever'); break;
      case 'wiring': set(lock.terminals, 'wire'); break;
      case 'breaker_panel':
        set(lock.breakers, 'breaker');
        lock.breakers.forEach((id, i) => { const sw = this.switches.get(id); if (sw) sw.latched = lock.start[i] === true; });
        break;
      case 'pressure_plates': for (const id of lock.plates) this.roles.set(id, { kind: 'plate', link }); break;
      case 'timed_switch': this.roles.set(lock.switchId, { kind: 'timer', link }); break;
      case 'flashlight_sensor': for (const id of lock.sensors) this.roles.set(id, { kind: 'sensor', link, genuine: id === lock.genuine }); break;
      default: break;
    }
  }

  addPlayer(id: string): void { this.players.add(id); }
  removePlayer(id: string): void { this.players.delete(id); this.pending.delete(id); this.lastIntent.delete(id); }

  // ------------------------------------------------------------------ the intents
  act(playerId: string, a: EscapeAction, me: EscapePos): EscapeResult {
    if (!this.players.has(playerId)) return fail('You are not part of this run.');
    const t = this.host.tick;
    const last = this.lastIntent.get(playerId) ?? -100;
    if (t - last < ESCAPE_LIMITS.minGapTicks) return fail('Too fast.');
    this.lastIntent.set(playerId, t);
    switch (a.action) {
      case 'use_door': return this.useDoor(playerId, a.doorId, me);
      case 'enter_code': return this.enterCode(playerId, a.targetId, a.code, me);
      case 'press': return this.press(playerId, a.switchId, me);
      case 'read': return this.read(playerId, a.clueId, me);
      case 'examine': return this.examine(playerId, a.evidenceId, me);
      case 'mark': return this.mark(a.ghost);
      case 'loot': return this.openLoot(playerId, a.lootId, me);
    }
  }

  /** Same room and within reach of (x, y) standing on the floor at y. */
  private reach(me: EscapePos, x: number, y: number, extra = 0): boolean {
    return Math.abs(me.x - x) <= ESCAPE_LIMITS.useRange + extra && Math.abs(me.y - y) <= RANGE_DY;
  }
  private inRoom(playerId: string, room: string): boolean { return this.host.roomOf(playerId) === room; }

  private useDoor(pid: string, doorId: string, me: EscapePos): EscapeResult {
    const d = this.doorRoom.get(doorId);
    // a door that does not exist, or is in another room, is "nothing there": the same words
    if (!d || !this.inRoom(pid, d.room.id)) return fail(ESCAPE_NOTHING);
    const cx = d.rect.x + d.rect.w / 2;
    if (!this.reach(me, cx, d.rect.y + d.rect.h, d.rect.w / 2)) return fail('Too far away.');
    const link = this.linkOfDoor.get(doorId);
    if (!link) return fail(ESCAPE_NOTHING);
    if (this.pending.has(pid)) return fail('The door is already opening.');
    if (!link.open) {
      link.tried = true;
      this.host.markDirty();
      const lock = link.lock;
      if (lock.type === 'key_item' || lock.type === 'safe' || lock.type === 'power' || lock.type === 'tool_key') {
        const kind = lock.type === 'power' ? 'battery' : 'access_key';
        const used = this.items?.consumeCarried(pid, kind) ?? 'none';
        if (used === 'none') return fail(needText(lock.type));
        if (used === 'decoy') {
          this.host.award('wrong_part', -this.host.wrongPartCost());
          this.host.say(lock.type === 'power' ? 'The cracked battery sparks and dies in the socket.' : 'The cracked key snaps in the lock.', 'bad', d.room.id);
          return fail(lock.type === 'power' ? 'The battery was cracked and died.' : 'The key was cracked and snapped.');
        }
        link.open = true;
        this.host.say(lock.type === 'power' ? 'The battery powers the door. It unlocks.' : 'The key turns. The door unlocks.', 'good', d.room.id);
      } else {
        return fail(needText(lock.type));
      }
    }
    this.pending.set(pid, { doorId, at: this.host.tick + ESCAPE_LIMITS.doorDelayTicks, x: me.x });
    this.host.markDirty();
    return ok('The door slides open.');
  }

  private enterCode(pid: string, targetId: string, code: string, me: EscapePos): EscapeResult {
    const k = this.keypads.get(targetId), s = this.safes.get(targetId);
    const target = k ?? s;
    if (!target || !this.inRoom(pid, target.room) || !this.host.canSee(pid, target.x, target.y - (k ? POINT_HEIGHT.keypad : POINT_HEIGHT.safe))) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, target.x, target.y)) return fail('Too far away.');
    const length = k ? ESCAPE_LIMITS.codeLength : ESCAPE_LIMITS.comboLength;
    const done = k ? k.solved : s!.opened;
    if (done) return fail('That is already done.');
    const t = this.host.tick;
    if (t < target.lockedUntil) return fail(`Locked out. Try again in ${Math.ceil((target.lockedUntil - t) / 20)} seconds.`);
    if (code.length !== length) return fail(`Enter ${length} symbols.`);
    const right = k ? k.link !== null && hasKeypad(k.link.lock) && k.link.lock.code === code : s!.code === code;
    if (!right) {
      target.wrong++;
      if (target.wrong >= ESCAPE_LIMITS.maxWrongTries) {
        target.wrong = 0;
        target.lockedUntil = t + ESCAPE_LIMITS.lockoutTicks;
        this.lockouts.add(target);
        this.host.markDirty();
        return fail('Wrong code. It locks out for a few seconds.');
      }
      return fail('Wrong code.');
    }
    target.wrong = 0;
    this.host.markDirty();
    if (k) {
      k.solved = true;
      if (k.link) k.link.open = true;
      this.host.say('The keypad accepts the code. A door unlocks somewhere.', 'good', k.room);
      return ok('Accepted. A door unlocked somewhere.');
    }
    const safe = s!;
    safe.opened = true;
    const revealed = safe.contains !== undefined && (this.items?.reveal(safe.contains) ?? false);
    this.host.say(revealed ? 'The safe opens. There is something inside.' : 'The safe opens. It is empty.', revealed ? 'good' : 'info', safe.room);
    return ok(revealed ? 'The safe opens. Something is inside.' : 'The safe is empty.');
  }

  private press(pid: string, switchId: string, me: EscapePos): EscapeResult {
    const sw = this.switches.get(switchId);
    if (!sw || !this.inRoom(pid, sw.room) || !this.host.canSee(pid, sw.x, sw.y - POINT_HEIGHT.switch)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, sw.x, sw.y)) return fail('Too far away.');
    const role = this.roles.get(switchId);
    if (role) return this.pressPuzzle(sw, role);
    sw.litUntil = this.host.tick + ESCAPE_LIMITS.switchHoldTicks;
    sw.wasLit = true;
    this.host.markDirty();
    for (const l of this.links) {
      const lock = l.lock;
      if (l.open || lock.type !== 'two_person') continue;
      const a = this.switches.get(lock.switchA), b = this.switches.get(lock.switchB);
      if (a && b && a.litUntil > this.host.tick && b.litUntil > this.host.tick) {
        l.open = true;
        this.host.say('Both switches hold. A door unlocks.', 'good', sw.room);
      }
    }
    return ok('The switch lights. It holds for a few seconds.');
  }

  /** P3F step 2: a press on a lever, breaker, wire terminal, timer switch, plate or sensor. (A plate and a sensor do not answer to a hand.) */
  private pressPuzzle(sw: Switch, role: Role): EscapeResult {
    const t = this.host.tick, link = role.link, lock = link.lock;
    if (role.kind === 'plate' || role.kind === 'sensor') return fail('Nothing happens.');
    if (role.kind === 'timer') {
      if (link.permanent) return fail('Nothing happens.');
      link.open = true; link.openUntil = t + ESCAPE_LIMITS.timedDoorTicks;
      this.host.markDirty();
      this.host.say('Somewhere a lock clunks. It will not stay open for long.', 'warn', sw.room);
      return ok('Something unlocks, but not for long.');
    }
    if (link.open) return fail('It will not move any more.');
    if (t < link.lockedUntil) return fail(`Dead for now. Try again in ${Math.ceil((link.lockedUntil - t) / 20)} seconds.`);
    const lockOut = (): void => { link.lockedUntil = t + ESCAPE_LIMITS.lockoutTicks; };
    if (role.kind === 'lever' && lock.type === 'lever_sequence') {
      if (sw.latched) return fail('It is already down.');
      if (lock.order[link.step] === role.idx) {
        sw.latched = true; link.step++;
        this.host.markDirty();
        if (link.step < lock.order.length) return ok('The lever clunks down.');
        link.open = true;
        this.host.say('The levers lock together. A door unlocks.', 'good', sw.room);
        return ok('The last lever clunks down. A door unlocked somewhere.');
      }
      for (const id of lock.levers) { const l = this.switches.get(id); if (l) l.latched = false; }
      link.step = 0; link.wrong++;
      if (link.wrong >= ESCAPE_LIMITS.maxWrongTries) { link.wrong = 0; lockOut(); }
      this.host.markDirty();
      return fail('The levers clunk back up. Wrong order.');
    }
    if (role.kind === 'breaker' && lock.type === 'breaker_panel') {
      sw.latched = !sw.latched; link.presses++;
      const now = lock.breakers.map((id) => this.switches.get(id)?.latched === true);
      this.host.markDirty();
      if (now.every((on, i) => on === lock.target[i])) {
        link.open = true;
        this.host.say('The panel hums. A door unlocks.', 'good', sw.room);
        return ok('The circuits settle. A door unlocked somewhere.');
      }
      if (link.presses > lock.breakers.length + ESCAPE_LIMITS.breakerSlack) {
        lock.breakers.forEach((id, i) => { const b = this.switches.get(id); if (b) b.latched = lock.start[i] === true; });
        link.presses = 0; lockOut();
        return fail('The panel trips and resets.');
      }
      return ok(sw.latched ? 'The breaker clicks on.' : 'The breaker clicks off.');
    }
    if (role.kind === 'wire' && lock.type === 'wiring') {
      if (role.idx === lock.right) {
        link.open = true;
        this.host.markDirty();
        this.host.say('Power surges through the wire. A door unlocks.', 'good', sw.room);
        return ok('The wire is live. A door unlocked somewhere.');
      }
      lockOut(); link.wrong++;
      this.host.markDirty();
      return fail('A spark jumps. The panel locks out for a few seconds.');
    }
    return fail('Nothing happens.');
  }

  private read(pid: string, clueId: string, me: EscapePos): EscapeResult {
    const c = this.clues.get(clueId);
    if (!c || !this.inRoom(pid, c.room) || !this.host.canSee(pid, c.x, c.y - POINT_HEIGHT.clue)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, c.x, c.y)) return fail('Too far away.');
    return ok(c.text, { id: c.id, text: c.text });
  }

  // ------------------------------------------------------------------ per tick
  step(pos: (id: string) => EscapePos | undefined): void {
    const t = this.host.tick;
    for (const l of [...this.lockouts]) if (l.lockedUntil <= t) { this.lockouts.delete(l); this.host.markDirty(); }
    for (const sw of this.switches.values()) if (sw.wasLit && sw.litUntil <= t) { sw.wasLit = false; this.host.markDirty(); }
    this.stepPuzzles(pos);
    for (const [pid, p] of [...this.pending]) {
      const at = pos(pid);
      if (!at || !at.connected || Math.abs(at.x - p.x) > ESCAPE_LIMITS.doorDriftPx) { this.pending.delete(pid); this.host.markDirty(); continue; }
      if (t >= p.at) {
        this.pending.delete(pid);
        if (this.host.sendThrough(pid, p.doorId)) { const l = this.linkOfDoor.get(p.doorId); if (l?.lock.type === 'timed_switch') l.permanent = true; } // gone through in time: the door stays open for the team
        this.host.markDirty();
      }
    }
    if (this.cleared) return;
    const e = this.spec.exit;
    const zone = { x: e.x - ESCAPE_LIMITS.exitWidth / 2, y: e.y - ESCAPE_LIMITS.exitHeight, w: ESCAPE_LIMITS.exitWidth, h: ESCAPE_LIMITS.exitHeight };
    for (const pid of this.players) {
      const at = pos(pid);
      if (at?.connected && this.host.roomOf(pid) === e.room && bodyInDoor(at, zone)) {
        this.cleared = true;
        this.host.clear();
        return;
      }
    }
  }

  /** P3F step 2: the puzzles that run by themselves each tick: plates (a body on them), sensors (light on them) and the timed door (it locks again). */
  private stepPuzzles(pos: (id: string) => EscapePos | undefined): void {
    const t = this.host.tick;
    for (const link of this.links) {
      const lock = link.lock;
      if (lock.type === 'timed_switch') {
        if (link.open && !link.permanent && t >= link.openUntil && ![...this.pending.values()].some((p) => this.linkOfDoor.get(p.doorId) === link)) {
          link.open = false;
          this.host.markDirty();
          this.host.say('The door seals itself again.', 'info', this.switches.get(lock.switchId)?.room); // told only to the room it happened in
        }
      } else if (lock.type === 'pressure_plates' && !link.open) {
        const lit = lock.plates.map((id) => this.switches.get(id));
        for (const sw of lit) {
          if (!sw) continue;
          const onIt = [...this.players].some((pid) => { const at = pos(pid); return at !== undefined && at.connected && this.host.roomOf(pid) === sw.room && Math.abs(at.x - sw.x) <= ESCAPE_LIMITS.plateRadius && Math.abs(at.y - sw.y) <= 6; });
          if (onIt) { if (sw.litUntil <= t) this.host.markDirty(); sw.litUntil = t + ESCAPE_LIMITS.plateHoldTicks; sw.wasLit = true; }
        }
        if (lit.every((sw) => sw !== undefined && sw.litUntil > t)) {
          link.open = true;
          this.host.markDirty();
          this.host.say('Both plates are down. A door unlocks.', 'good', lit[0]!.room);
        }
      } else if (lock.type === 'flashlight_sensor' && !link.open) {
        const sw = this.switches.get(lock.genuine);
        if (!sw) continue;
        const lightOn = [...this.players].some((pid) => { const at = pos(pid); return at !== undefined && at.connected && this.host.roomOf(pid) === sw.room && this.host.canSee(pid, sw.x, sw.y - POINT_HEIGHT.switch); });
        if (lightOn) { if (sw.litUntil <= t) this.host.markDirty(); sw.litUntil = t + 2; sw.wasLit = true; link.seen++; } else link.seen = 0;
        if (link.seen >= ESCAPE_LIMITS.sensorTicks) {
          link.open = true;
          this.host.markDirty();
          this.host.say('The sensor chimes. A door unlocks.', 'good', sw.room);
        }
      }
    }
  }

  // ------------------------------------------------------------------ queries and projection
  /** Ids of the open doors (an open door no longer blocks sight). */
  openDoorIds(): Set<string> {
    const out = new Set<string>();
    for (const [id, l] of this.linkOfDoor) if (l.open) out.add(id);
    return out;
  }
  isOpen(doorId: string): boolean { return this.linkOfDoor.get(doorId)?.open ?? false; }
  get reached(): boolean { return this.cleared; }

  publicState(): EscapePublic {
    const t = this.host.tick;
    const lock = (until: number) => (until > t ? until : null);
    return {
      doors: [...this.linkOfDoor].map(([id, l]) => ({
        id, room: this.doorRoom.get(id)!.room.id, open: l.open,
        need: l.open || !l.tried ? null : needText(l.lock.type, ESCAPE_LIMITS.codeLength),
      })),
      keypads: [...this.keypads.values()].map((k) => ({ id: k.id, room: k.room, x: k.x, y: k.y, length: ESCAPE_LIMITS.codeLength, solved: k.solved, lockedUntilTick: lock(k.lockedUntil) })),
      safes: [...this.safes.values()].map((s) => ({ id: s.id, room: s.room, x: s.x, y: s.y, length: ESCAPE_LIMITS.comboLength, opened: s.opened, lockedUntilTick: lock(s.lockedUntil) })),
      clues: [...this.clues.values()].map((c) => ({ id: c.id, room: c.room, x: c.x, y: c.y, label: c.label })),
      switches: [...this.switches.values()].map((s) => ({ id: s.id, room: s.room, x: s.x, y: s.y, active: s.latched || s.litUntil > t })),
      ...(this.spec.loot ? { loot: { id: this.spec.loot.id, room: this.spec.loot.room, x: this.spec.loot.x, y: this.spec.loot.y, opened: this.lootOpened } } : {}),
      ...(this.evidence.size > 0 ? {
        evidence: [...this.evidence.values()].map((v) => ({ id: v.id, room: v.room, x: v.x, y: v.y, examined: this.found.has(v.id) })),
        journal: {
          entries: [...this.found].flatMap((id) => { const v = this.evidence.get(id); return v ? [{ id, kind: v.kind }] : []; }),
          marks: [...this.marks], lines: this.lines,
        },
      } : {}),
      exit: { room: this.spec.exit.room, x: this.spec.exit.x, y: this.spec.exit.y },
    };
  }
}
