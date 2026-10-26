import { GUN_LIMITS, type GhostShot } from '@wb/shared';

/** What the Pulse Gun may ask of its host (the Room). A narrow seam, so the shot is unit-testable without a Room. */
export interface GunHost {
  readonly tick: number;
  /** The shooter: room, feet position and the aim angle the server holds for them (radians, null = never sent). Undefined = unknown player. */
  shooter(id: string): { room: string; x: number; y: number; aim: number | null; name: string; connected: boolean } | undefined;
  /** Spend the Pulse Gun the player carries (it leaves their hands for good). False if they carry none. */
  spend(id: string): boolean;
  /** Does the player carry a Pulse Gun? */
  carries(id: string): boolean;
  /** Trace one tick of a bolt (see `GhostSystem.trace`). */
  trace(room: string, from: { x: number; y: number }, to: { x: number; y: number }, radius: number): { hit: string | null; blocked: boolean };
  /** Stun a ghost (false if it cannot be stunned now: not roaming or hunting). */
  stun(ghostId: string, by: string): boolean;
  /** The loud crack of a shot: a ghost in earshot investigates. */
  noise(room: string, x: number, y: number, by: string, name: string): void;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad', room?: string): void;
  log(by: string, phase: 'fired' | 'hit' | 'stunned' | 'absorbed' | 'wall' | 'miss', room: string, text: string, ghost?: string): void;
  /** Every player id of the run (to work out who sees the flash). */
  playerIds(): string[];
  /** Is (x, y) of `room` in the viewer's view? (False for a viewer in another room.) */
  sees(viewerId: string, room: string, x: number, y: number): boolean;
}

export type GunResult = { ok: true; message: string } | { ok: false; error: string };

interface Bolt { id: string; owner: string; room: string; x: number; y: number; dx: number; dy: number; travelled: number }
export interface ShotDelivery { to: string[]; shot: GhostShot }

/**
 * P3E step 4: the Pulse Gun. One charge: a shot spends the gun, hit or miss. The direction is the aim the server already holds for the player (never a
 * client-supplied vector). The bolt is simulated here, tick by tick: `speedPx` per tick for at most `rangePx`, ended by a wall or a closed door, and it
 * stuns the first ghost it touches. A stun never kills; it is refused in a ghost's WARNING because an absent ghost is not in the room to be touched.
 * Everything is a function of the tick and the inputs, so it is deterministic.
 */
export class PulseGun {
  private bolts: Bolt[] = [];
  private deliveries: ShotDelivery[] = [];
  private shots = 0;

  constructor(private readonly host: GunHost) {}

  get flying(): number { return this.bolts.length; }
  /** Shots to send to clients since the last call (each with the players who can see where it was fired). */
  drainDeliveries(): ShotDelivery[] { const d = this.deliveries; this.deliveries = []; return d; }

  fire(id: string): GunResult {
    const me = this.host.shooter(id);
    if (!me || !me.connected) return { ok: false, error: 'You are not part of this run.' };
    if (!this.host.carries(id)) return { ok: false, error: 'You have no Pulse Gun.' };
    if (me.aim === null) return { ok: false, error: 'Aim first: move the mouse.' };
    if (!this.host.spend(id)) return { ok: false, error: 'You have no Pulse Gun.' };
    const x = me.x, y = me.y - GUN_LIMITS.eyeHeight, t = this.host.tick;
    const bolt: Bolt = { id: `${id}_${t}_${this.shots++}`, owner: id, room: me.room, x, y, dx: Math.cos(me.aim), dy: Math.sin(me.aim), travelled: 0 };
    this.bolts.push(bolt);
    this.host.noise(me.room, x, y, id, me.name);
    this.host.log(id, 'fired', me.room, `${me.name} fired the Pulse Gun`);
    this.host.say(`${me.name} fires the Pulse Gun!`, 'info', me.room);
    const to = this.host.playerIds().filter((p) => p === id || this.host.sees(p, me.room, x, y));
    this.deliveries.push({ to, shot: { id: bolt.id, x, y, angle: me.aim, rangePx: GUN_LIMITS.rangePx, speedPx: GUN_LIMITS.speedPx, tick: t, room: me.room } });
    return { ok: true, message: 'Pulse fired. That was the only charge.' };
  }

  /** Once per server tick. */
  step(): void {
    const live: Bolt[] = [];
    for (const b of this.bolts) {
      const step = Math.min(GUN_LIMITS.speedPx, GUN_LIMITS.rangePx - b.travelled);
      const from = { x: b.x, y: b.y }, to = { x: b.x + b.dx * step, y: b.y + b.dy * step };
      const r = this.host.trace(b.room, from, to, GUN_LIMITS.hitRadiusPx);
      const by = this.host.shooter(b.owner)?.name ?? 'Someone';
      if (r.hit !== null) {
        const stunned = this.host.stun(r.hit, b.owner);
        this.host.log(b.owner, 'hit', b.room, `${by}'s pulse hit the ghost`, r.hit);
        if (stunned) {
          this.host.log(b.owner, 'stunned', b.room, 'The ghost is stunned', r.hit);
          this.host.say('The pulse hits! The ghost is stunned.', 'good', b.room);
        } else {
          this.host.log(b.owner, 'absorbed', b.room, 'The pulse had no effect', r.hit);
          this.host.say('The pulse hits the ghost, but it has no effect now.', 'warn', b.room);
        }
        continue;
      }
      if (r.blocked) { this.host.log(b.owner, 'wall', b.room, 'The pulse hit a wall'); continue; }
      b.x = to.x; b.y = to.y; b.travelled += step;
      if (b.travelled >= GUN_LIMITS.rangePx - 1e-9) { this.host.log(b.owner, 'miss', b.room, 'The pulse faded'); this.host.say('The pulse fades. It missed.', 'warn', b.room); continue; }
      live.push(b);
    }
    this.bolts = live;
  }
}
