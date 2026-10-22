import {
  ESCAPE_LIMITS, ESCAPE_NOTHING, RANGE_DY, bodyInDoor, needText,
  type EscapeAck, type EscapeAction, type EscapePublic, type RoomDef, type RoomGraph,
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
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad'): void;
  markDirty(): void;
  award(category: string, points: number): void;
  /** Penalty (positive) for forcing a cracked part into a lock. */
  wrongPartCost(): number;
  /** The room a player is in. */
  roomOf(playerId: string): string | undefined;
  /** Carry the player through a door (the door's own room). Returns false if that was not possible. */
  sendThrough(playerId: string, doorId: string): boolean;
  /** The exit was reached alive: clear the stage (the existing STAGE_CLEAR transition does the rest). */
  clear(): void;
}

interface LinkRt { lock: Lock; doors: readonly [string, string]; open: boolean; tried: boolean }
interface Keypad { id: string; room: string; x: number; y: number; wrong: number; lockedUntil: number; solved: boolean; link: LinkRt | null }
interface Safe { id: string; room: string; x: number; y: number; code: string; contains: string | undefined; wrong: number; lockedUntil: number; opened: boolean }
interface Switch { id: string; room: string; x: number; y: number; litUntil: number; wasLit: boolean }
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
  private readonly clues = new Map<string, EscapeSpec['clues'][number]>();
  private readonly pending = new Map<string, Pending>();
  /** Keypads and safes whose lockout is running (so its END is published, not only its start). */
  private readonly lockouts = new Set<{ lockedUntil: number }>();
  private readonly lastIntent = new Map<string, number>();
  private readonly players = new Set<string>();
  private cleared = false;

  constructor(private readonly spec: EscapeSpec, graph: RoomGraph, private readonly host: EscapeHost, private readonly items: ItemSystem | null) {
    for (const room of graph.rooms) for (const d of room.doors) this.doorRoom.set(d.id, { room, rect: { x: d.x, y: d.y, w: d.w, h: d.h } });
    this.links = spec.links.map((l) => ({ lock: l.lock, doors: l.doors, open: false, tried: false }));
    for (const l of this.links) for (const id of l.doors) this.linkOfDoor.set(id, l);
    for (const k of spec.keypads) {
      const link = this.links.find((l) => l.lock.type === 'code' && l.lock.keypadId === k.id) ?? null;
      this.keypads.set(k.id, { ...k, wrong: 0, lockedUntil: 0, solved: false, link });
    }
    for (const s of spec.safes) this.safes.set(s.id, { id: s.id, room: s.room, x: s.x, y: s.y, code: s.code, contains: s.contains, wrong: 0, lockedUntil: 0, opened: false });
    for (const s of spec.switches) this.switches.set(s.id, { ...s, litUntil: 0, wasLit: false });
    for (const c of spec.clues) this.clues.set(c.id, c);
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
      if (lock.type === 'key_item' || lock.type === 'safe' || lock.type === 'power') {
        const kind = lock.type === 'power' ? 'battery' : 'access_key';
        const used = this.items?.consumeCarried(pid, kind) ?? 'none';
        if (used === 'none') return fail(needText(lock.type));
        if (used === 'decoy') {
          this.host.award('wrong_part', -this.host.wrongPartCost());
          this.host.say(lock.type === 'power' ? 'The cracked battery sparks and dies in the socket.' : 'The cracked key snaps in the lock.', 'bad');
          return fail(lock.type === 'power' ? 'The battery was cracked and died.' : 'The key was cracked and snapped.');
        }
        link.open = true;
        this.host.say(lock.type === 'power' ? 'The battery powers the door. It unlocks.' : 'The key turns. The door unlocks.', 'good');
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
    if (!target || !this.inRoom(pid, target.room)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, target.x, target.y)) return fail('Too far away.');
    const length = k ? ESCAPE_LIMITS.codeLength : ESCAPE_LIMITS.comboLength;
    const done = k ? k.solved : s!.opened;
    if (done) return fail('That is already done.');
    const t = this.host.tick;
    if (t < target.lockedUntil) return fail(`Locked out. Try again in ${Math.ceil((target.lockedUntil - t) / 20)} seconds.`);
    if (code.length !== length) return fail(`Enter ${length} symbols.`);
    const right = k ? k.link?.lock.type === 'code' && k.link.lock.code === code : s!.code === code;
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
      this.host.say('The keypad accepts the code. A door unlocks somewhere.', 'good');
      return ok('Accepted. A door unlocked somewhere.');
    }
    const safe = s!;
    safe.opened = true;
    const revealed = safe.contains !== undefined && (this.items?.reveal(safe.contains) ?? false);
    this.host.say(revealed ? 'The safe opens. There is something inside.' : 'The safe opens. It is empty.', revealed ? 'good' : 'info');
    return ok(revealed ? 'The safe opens. Something is inside.' : 'The safe is empty.');
  }

  private press(pid: string, switchId: string, me: EscapePos): EscapeResult {
    const sw = this.switches.get(switchId);
    if (!sw || !this.inRoom(pid, sw.room)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, sw.x, sw.y)) return fail('Too far away.');
    sw.litUntil = this.host.tick + ESCAPE_LIMITS.switchHoldTicks;
    sw.wasLit = true;
    this.host.markDirty();
    for (const l of this.links) {
      const lock = l.lock;
      if (l.open || lock.type !== 'two_person') continue;
      const a = this.switches.get(lock.switchA), b = this.switches.get(lock.switchB);
      if (a && b && a.litUntil > this.host.tick && b.litUntil > this.host.tick) {
        l.open = true;
        this.host.say('Both switches hold. A door unlocks.', 'good');
      }
    }
    return ok('The switch lights. It holds for a few seconds.');
  }

  private read(pid: string, clueId: string, me: EscapePos): EscapeResult {
    const c = this.clues.get(clueId);
    if (!c || !this.inRoom(pid, c.room)) return fail(ESCAPE_NOTHING);
    if (!this.reach(me, c.x, c.y)) return fail('Too far away.');
    return ok(c.text, { id: c.id, text: c.text });
  }

  // ------------------------------------------------------------------ per tick
  step(pos: (id: string) => EscapePos | undefined): void {
    const t = this.host.tick;
    for (const l of [...this.lockouts]) if (l.lockedUntil <= t) { this.lockouts.delete(l); this.host.markDirty(); }
    for (const sw of this.switches.values()) if (sw.wasLit && sw.litUntil <= t) { sw.wasLit = false; this.host.markDirty(); }
    for (const [pid, p] of [...this.pending]) {
      const at = pos(pid);
      if (!at || !at.connected || Math.abs(at.x - p.x) > ESCAPE_LIMITS.doorDriftPx) { this.pending.delete(pid); this.host.markDirty(); continue; }
      if (t >= p.at) { this.pending.delete(pid); this.host.sendThrough(pid, p.doorId); this.host.markDirty(); }
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

  // ------------------------------------------------------------------ queries and projection
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
      switches: [...this.switches.values()].map((s) => ({ id: s.id, room: s.room, x: s.x, y: s.y, active: s.litUntil > t })),
      exit: { room: this.spec.exit.room, x: this.spec.exit.x, y: this.spec.exit.y },
    };
  }
}
