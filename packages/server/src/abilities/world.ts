import {
  MAX_IMPULSES_LISTED, MAX_PROPS_TOTAL, MAX_ZONES_LISTED, PROP_H, PROP_W, boundImpulse, stepProp, worldForTick,
  type Arena, type GravityZone, type ImpulseEvent, type Prop, type StepWorld, type WorldPublic,
} from '@wb/shared';

/** Expired zones and impulses stay in the public list this long so a client replaying recent inputs still sees them. */
export const ZONE_KEEP_TICKS = 40;
export const IMPULSE_KEEP_TICKS = 40;

export interface PropSpawn { id: string; kind: 'crate'; x: number; y: number; light: boolean }

const overlapsSolid = (arena: Arena, x: number, y: number, w: number, h: number) =>
  arena.solids.some((r) => x + w / 2 > r.x && x - w / 2 < r.x + r.w && y > r.y && y - h < r.y + r.h);

/**
 * The physical, server-authoritative world around the players: gravity zones, impulse events and props.
 * `GameSim` owns one and steps it once per tick, AFTER the player bodies. Everything is bounded (see MAX_* in
 * shared/abilities/specs.ts). Its public projection goes into the game snapshot.
 */
export class PhysicsWorld {
  /** The sim tick about to be simulated (equals GameSim.tick). */
  tick = 0;
  private props = new Map<string, Prop>();
  private zones: GravityZone[] = [];
  private impulses: ImpulseEvent[] = [];
  private seq = 0;

  constructor(readonly arena: Arena) {}

  /** Back to tick 0 with the stage's authored props and nothing else. */
  reset(spawns: readonly PropSpawn[] = []): void {
    this.tick = 0; this.seq = 0;
    this.props.clear(); this.zones = []; this.impulses = [];
    for (const s of spawns) {
      this.props.set(s.id, {
        id: s.id, kind: s.kind, x: s.x, y: s.y, vx: 0, vy: 0, w: PROP_W, h: PROP_H, grounded: true,
        frozenUntilTick: 0, ownerId: null, cloneOf: null, expiresTick: null, light: s.light,
      });
    }
  }

  get isEmpty(): boolean { return this.props.size === 0 && this.zones.length === 0 && this.impulses.length === 0; }

  // ------------------------------------------------------------------ queries
  prop(id: string): Readonly<Prop> | undefined { return this.props.get(id); }
  listProps(): readonly Readonly<Prop>[] { return [...this.props.values()]; }
  get propCount(): number { return this.props.size; }
  clonesOf(ownerId: string): number { let n = 0; for (const p of this.props.values()) if (p.cloneOf && p.ownerId === ownerId) n++; return n; }
  get cloneCount(): number { let n = 0; for (const p of this.props.values()) if (p.cloneOf) n++; return n; }
  activeZones(tick = this.tick): readonly GravityZone[] { return this.zones.filter((z) => z.startTick <= tick && tick < z.expiresTick); }
  isFrozen(id: string): boolean { return (this.props.get(id)?.frozenUntilTick ?? 0) > this.tick; }
  /** Can a prop-sized box stand here without overlapping a solid or leaving the arena? */
  fits(x: number, y: number): boolean {
    return x >= PROP_W / 2 && x <= this.arena.width - PROP_W / 2 && y >= PROP_H && y <= this.arena.height
      && !overlapsSolid(this.arena, x, y, PROP_W, PROP_H);
  }

  // ------------------------------------------------------------------ mutations (callers validate rules; these enforce hard bounds)
  addZone(z: { ownerId: string; x: number; y: number; w: number; h: number; gx: number; gy: number; durationTicks: number }): GravityZone | null {
    if (this.zones.length >= MAX_ZONES_LISTED) return null;
    const zone: GravityZone = {
      id: `zone_${++this.seq}`, ownerId: z.ownerId, x: z.x, y: z.y, w: z.w, h: z.h, gx: z.gx, gy: z.gy,
      startTick: this.tick, expiresTick: this.tick + Math.max(1, z.durationTicks),
    };
    this.zones.push(zone);
    return zone;
  }

  /** Impulse on a player's body: applied by the NEXT sim step through `worldForTick` (server and prediction alike). */
  addImpulse(e: { playerId: string; dvx: number; dvy: number; cancel: boolean; driftTicks: number }): ImpulseEvent | null {
    if (this.impulses.length >= MAX_IMPULSES_LISTED) return null;
    const ev: ImpulseEvent = {
      id: `imp_${++this.seq}`, tick: this.tick, playerId: e.playerId,
      dvx: boundImpulse(e.dvx), dvy: boundImpulse(e.dvy), cancel: e.cancel, driftTicks: Math.max(1, Math.floor(e.driftTicks)),
    };
    this.impulses.push(ev);
    return ev;
  }

  /** Impulse on a prop (it has persistent velocity). `cancel` stops it dead. Returns false if it cannot be pushed. */
  impulseProp(id: string, dvx: number, dvy: number, cancel: boolean): boolean {
    const p = this.props.get(id);
    if (!p || this.isFrozen(id)) return false;
    if (cancel) { p.vx = 0; p.vy = 0; return true; }
    p.vx = boundImpulse(p.vx + boundImpulse(dvx));
    p.vy = boundImpulse(p.vy + boundImpulse(dvy));
    p.grounded = false;
    return true;
  }

  freezeProp(id: string, untilTick: number): boolean {
    const p = this.props.get(id);
    if (!p || this.isFrozen(id)) return false;
    p.frozenUntilTick = untilTick; p.vx = 0; p.vy = 0;
    return true;
  }

  addClone(sourceId: string, ownerId: string, x: number, y: number, lifeTicks: number): Prop | null {
    const src = this.props.get(sourceId);
    if (!src || this.props.size >= MAX_PROPS_TOTAL || !this.fits(x, y)) return null;
    const clone: Prop = {
      id: `clone_${++this.seq}`, kind: src.kind, x, y, vx: 0, vy: 0, w: src.w, h: src.h, grounded: false,
      frozenUntilTick: 0, ownerId, cloneOf: src.id, expiresTick: this.tick + Math.max(1, lifeTicks), light: false,
    };
    this.props.set(clone.id, clone);
    return clone;
  }

  // ------------------------------------------------------------------ stepping
  /** The optional `stepBody` parameter for one player at the tick about to be simulated. */
  forPlayer(playerId: string): StepWorld | undefined {
    return worldForTick({ zones: this.zones, impulses: this.impulses }, this.tick, playerId);
  }

  /** Advance props one tick, expire things, then move the clock. Call AFTER all bodies stepped at `this.tick`. */
  step(): void {
    const t = this.tick;
    const zones = this.activeZones(t).map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h, gx: z.gx, gy: z.gy }));
    for (const p of [...this.props.values()]) {
      if (p.expiresTick !== null && p.expiresTick <= t) { this.props.delete(p.id); continue; }
      stepProp(p, t, this.arena, zones.length ? zones : undefined);
    }
    this.zones = this.zones.filter((z) => t < z.expiresTick + ZONE_KEEP_TICKS);
    this.impulses = this.impulses.filter((e) => t < e.tick + e.driftTicks + IMPULSE_KEEP_TICKS);
    this.tick = t + 1;
  }

  /** Public projection (deep copy). Undefined when there is nothing to show, so old snapshots stay byte-identical. */
  publicState(): WorldPublic | undefined {
    if (this.isEmpty) return undefined;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      zones: this.zones.map((z) => ({ ...z })),
      impulses: this.impulses.map((e) => ({ ...e })),
      props: [...this.props.values()].map((p) => ({ ...p, x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy) })),
    };
  }
}
