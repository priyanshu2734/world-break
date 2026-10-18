import {
  ABILITY_MIN_GAP_TICKS, ABILITY_SPECS, ENERGY_PER_REPAIR, MOMENTUM_DRIFT_TICKS, MOMENTUM_IMPULSE, WELL_GRAVITY, WELL_HALF_SIZE,
  type AbilitiesPublic, type AbilityAction, type AbilityId, type ActiveAbilityId, type Arena, type HazardKind,
} from '@wb/shared';
import type { AbilityConfig } from '../systems/stageDef';
import type { PhysicsWorld } from './world';

export type AbilityResult = { ok: true; message: string } | { ok: false; error: string };
const fail = (error: string): AbilityResult => ({ ok: false, error });
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
/** Body centre of a player whose position is the feet-centre. */
const BODY_MID = 20;

export interface AbilityHazard { id: string; kind: HazardKind; x: number; y: number; r: number }
/** What the ability system may ask of its host (the StageEngine). A narrow seam, so it is unit-testable. */
export interface AbilityHost {
  readonly tick: number;
  readonly arena: Arena;
  readonly world: PhysicsWorld | null;
  say(text: string, tone: 'info' | 'good' | 'warn' | 'bad'): void;
  markDirty(): void;
  hazards(): readonly AbilityHazard[];
  hazardFrozen(id: string): boolean;
  freezeHazard(id: string, untilTick: number): void;
  activeAnchors(): readonly { x: number; y: number; r: number }[];
}

interface PlayerAb {
  energy: number;
  cooldownUntil: Map<ActiveAbilityId, number>;
  lastIntentTick: number;
  passiveAcc: number;
}
interface FreezeRec { ownerId: string; kind: 'prop' | 'hazard'; targetId: string; untilTick: number }

/**
 * Reality Energy, cooldowns, caps and the four `ability:use` abilities. Every rule is enforced here, on the server.
 * Order of checks: enabled > rate limit > cooldown > energy > target / range / ownership / caps. Nothing is spent on failure.
 */
export class AbilitySystem {
  private players = new Map<string, PlayerAb>();
  private freezes: FreezeRec[] = [];

  constructor(readonly cfg: AbilityConfig, private readonly host: AbilityHost) {}

  addPlayer(id: string): void {
    this.players.set(id, { energy: this.cfg.energyStart, cooldownUntil: new Map(), lastIntentTick: -100, passiveAcc: 0 });
    this.host.markDirty();
  }
  removePlayer(id: string): void { this.players.delete(id); this.host.markDirty(); }
  energyOf(id: string): number | undefined { return this.players.get(id)?.energy; }

  /** Team repairs refill every player's meter (capped). */
  onRepair(kind: 'breakpoint' | 'conduit'): void {
    const gain = ENERGY_PER_REPAIR[kind];
    let gave = false;
    for (const p of this.players.values()) {
      const next = Math.min(this.cfg.energyMax, p.energy + gain);
      if (next !== p.energy) { p.energy = next; gave = true; }
    }
    if (gave) { this.host.say('Reality Energy surges back as the repair holds.', 'good'); this.host.markDirty(); }
  }

  /** Once per engine tick: expire freezes, optional passive regeneration. */
  step(): void {
    const t = this.host.tick;
    const before = this.freezes.length;
    this.freezes = this.freezes.filter((f) => f.untilTick > t);
    if (this.freezes.length !== before) this.host.markDirty();
    const every = this.cfg.passiveRegenTicks;
    if (every > 0) for (const p of this.players.values()) {
      if (p.energy >= this.cfg.energyMax) { p.passiveAcc = 0; continue; }
      if (++p.passiveAcc >= every) { p.passiveAcc = 0; p.energy++; this.host.markDirty(); }
    }
  }

  // ------------------------------------------------------------------ the intent
  use(playerId: string, a: AbilityAction, me: { x: number; y: number }): AbilityResult {
    const p = this.players.get(playerId);
    const world = this.host.world;
    if (!p) return fail('You are not part of this run.');
    const id: ActiveAbilityId = a.ability;
    if (!this.cfg.enabled.includes(id)) return fail('That ability is not available here.');
    if (!world) return fail('There is no physical world to act on.');
    const t = this.host.tick;
    if (t - p.lastIntentTick < ABILITY_MIN_GAP_TICKS) return fail('Too fast.');
    p.lastIntentTick = t;
    const spec = ABILITY_SPECS[id];
    if (t < (p.cooldownUntil.get(id) ?? 0)) return fail('That ability is still recharging.');
    if (p.energy < spec.energyCost) return fail('Not enough Reality Energy.');

    const r = this.apply(playerId, a, me, world);
    if (!r.ok) return r;
    p.energy -= spec.energyCost;
    p.cooldownUntil.set(id, t + spec.cooldownTicks);
    this.host.markDirty();
    return r;
  }

  private apply(pid: string, a: AbilityAction, me: { x: number; y: number }, world: PhysicsWorld): AbilityResult {
    switch (a.ability) {
      case 'gravity_well': return this.well(pid, a, me, world);
      case 'freeze': return this.freeze(pid, a, me, world);
      case 'duplicate': return this.duplicate(pid, a, me, world);
      case 'momentum': return this.momentum(pid, a, me, world);
    }
  }

  // ------------------------------------------------------------------ Gravity Well
  private activeWells(world: PhysicsWorld) { return world.activeZones(world.tick); }

  private well(pid: string, a: Extract<AbilityAction, { ability: 'gravity_well' }>, me: { x: number; y: number }, world: PhysicsWorld): AbilityResult {
    const spec = ABILITY_SPECS.gravity_well, arena = this.host.arena;
    if (dist(me.x, me.y - BODY_MID, a.x, a.y) > spec.range) return fail('Too far away.');
    if (a.x < 0 || a.x > arena.width || a.y < 0 || a.y > arena.height) return fail('That point is outside the arena.');
    for (const an of this.host.activeAnchors()) {
      if (dist(an.x, an.y, a.x, a.y) <= an.r) return fail('A gravity anchor holds this area steady.');
    }
    const wells = this.activeWells(world);
    if (wells.filter((z) => z.ownerId === pid).length >= spec.perPlayerCap) return fail('You already have a gravity well running.');
    if (wells.length >= spec.perRoomCap) return fail(`The room already has ${spec.perRoomCap} gravity wells.`);
    const size = WELL_HALF_SIZE * 2;
    const x = Math.max(0, Math.min(arena.width - size, a.x - WELL_HALF_SIZE));
    const y = Math.max(0, Math.min(arena.height - size, a.y - WELL_HALF_SIZE));
    const zone = world.addZone({ ownerId: pid, x, y, w: size, h: size, gx: 0, gy: WELL_GRAVITY[a.mode], durationTicks: spec.durationTicks });
    if (!zone) return fail('Reality cannot hold another gravity well right now.');
    const msg = a.mode === 'flip' ? 'Gravity flips inside the well.' : 'Gravity weakens inside the well.';
    this.host.say(msg, 'info');
    return { ok: true, message: msg };
  }

  // ------------------------------------------------------------------ Freeze
  private freeze(pid: string, a: Extract<AbilityAction, { ability: 'freeze' }>, me: { x: number; y: number }, world: PhysicsWorld): AbilityResult {
    const spec = ABILITY_SPECS.freeze, t = this.host.tick;
    const prop = world.prop(a.targetId);
    const hazard = prop ? undefined : this.host.hazards().find((h) => h.id === a.targetId);
    if (!prop && !hazard) return fail('Nothing there to freeze.');
    if (this.freezes.filter((f) => f.ownerId === pid).length >= spec.perPlayerCap) return fail('You already have something frozen.');
    if (this.freezes.length >= spec.perRoomCap) return fail(`The room already has ${spec.perRoomCap} frozen things.`);

    if (prop) {
      if (dist(me.x, me.y - BODY_MID, prop.x, prop.y - prop.h / 2) > spec.range) return fail('Too far away.');
      if (prop.ownerId !== null && prop.ownerId !== pid) return fail('That object belongs to another player.');
      if (world.isFrozen(prop.id)) return fail('That is already frozen.');
      if (!world.freezeProp(prop.id, world.tick + spec.durationTicks)) return fail('That cannot be frozen.');
      this.freezes.push({ ownerId: pid, kind: 'prop', targetId: prop.id, untilTick: t + spec.durationTicks });
      this.host.say('An object locks in place.', 'info');
      return { ok: true, message: 'Frozen.' };
    }
    const h = hazard!;
    if (h.kind === 'gravity_flux') return fail('Gravity flux cannot be frozen. Anchor it.');
    // A hazard is an area: reach means being within range of its edge.
    if (dist(me.x, me.y - BODY_MID, h.x, h.y) > spec.range + h.r) return fail('Too far away.');
    if (this.host.hazardFrozen(h.id)) return fail('That is already frozen.');
    this.host.freezeHazard(h.id, t + spec.durationTicks);
    this.freezes.push({ ownerId: pid, kind: 'hazard', targetId: h.id, untilTick: t + spec.durationTicks });
    this.host.say(`The hazard freezes mid-cycle.`, 'info');
    return { ok: true, message: 'Frozen.' };
  }

  // ------------------------------------------------------------------ Duplicate
  private duplicate(pid: string, a: Extract<AbilityAction, { ability: 'duplicate' }>, me: { x: number; y: number }, world: PhysicsWorld): AbilityResult {
    const spec = ABILITY_SPECS.duplicate;
    const src = world.prop(a.targetId);
    if (!src) return fail('Nothing there to duplicate.');
    if (src.cloneOf) return fail('A copy cannot be copied.');
    if (!src.light) return fail('That object is too heavy to duplicate.');
    if (src.ownerId !== null && src.ownerId !== pid) return fail('That object belongs to another player.');
    if (dist(me.x, me.y - BODY_MID, src.x, src.y - src.h / 2) > spec.range) return fail('Too far away.');
    if (dist(me.x, me.y - BODY_MID, a.x, a.y) > spec.range) return fail('Too far away to place a copy there.');
    if (world.clonesOf(pid) >= spec.perPlayerCap) return fail(`You already have ${spec.perPlayerCap} copies.`);
    if (world.cloneCount >= spec.perRoomCap) return fail('Too many copies exist right now.');
    if (!world.fits(a.x, a.y)) return fail('There is no room to place a copy there.');
    const clone = world.addClone(src.id, pid, a.x, a.y, spec.durationTicks);
    if (!clone) return fail('Reality cannot hold another copy right now.');
    this.host.say('A copy shimmers into existence.', 'info');
    return { ok: true, message: 'Duplicated.' };
  }

  // ------------------------------------------------------------------ Momentum
  private momentum(pid: string, a: Extract<AbilityAction, { ability: 'momentum' }>, me: { x: number; y: number }, world: PhysicsWorld): AbilityResult {
    const spec = ABILITY_SPECS.momentum;
    const cancel = a.dir === 'cancel';
    const dvx = a.dir === 'left' ? -MOMENTUM_IMPULSE : a.dir === 'right' ? MOMENTUM_IMPULSE : 0;
    const dvy = a.dir === 'up' ? -MOMENTUM_IMPULSE : a.dir === 'down' ? MOMENTUM_IMPULSE : 0;
    if (a.targetId === 'self') {
      if (!world.addImpulse({ playerId: pid, dvx, dvy, cancel, driftTicks: MOMENTUM_DRIFT_TICKS })) return fail('Reality cannot take another impulse right now.');
      const msg = cancel ? 'You brace and kill your momentum.' : 'You shove yourself through the air.';
      this.host.say(msg, 'info');
      return { ok: true, message: msg };
    }
    const prop = world.prop(a.targetId);
    if (!prop) return fail('Nothing there to push.');
    if (prop.ownerId !== null && prop.ownerId !== pid) return fail('That object belongs to another player.');
    if (dist(me.x, me.y - BODY_MID, prop.x, prop.y - prop.h / 2) > spec.range) return fail('Too far away.');
    if (world.isFrozen(prop.id)) return fail('Frozen objects cannot be pushed.');
    if (!world.impulseProp(prop.id, dvx, dvy, cancel)) return fail('That cannot be pushed.');
    const msg = cancel ? 'The object stops dead.' : 'The object lurches.';
    this.host.say(msg, 'info');
    return { ok: true, message: msg };
  }

  // ------------------------------------------------------------------ public projection
  publicState(): AbilitiesPublic {
    const world = this.host.world;
    const props = world ? world.listProps() : [];
    const t = this.host.tick;
    return {
      enabled: [...this.cfg.enabled],
      energyMax: this.cfg.energyMax,
      players: [...this.players].map(([id, p]) => ({
        id, energy: p.energy,
        cooldowns: [...p.cooldownUntil].map(([ability, cooldownUntilTick]) => ({ ability: ability as AbilityId, cooldownUntilTick })),
        clones: props.filter((x) => x.cloneOf && x.ownerId === id).length,
      })),
      active: {
        wells: world ? world.activeZones(world.tick).length : 0,
        freezes: this.freezes.filter((f) => f.untilTick > t).length,
        clones: props.filter((x) => x.cloneOf).length,
        anchors: this.host.activeAnchors().length,
      },
    };
  }
}
