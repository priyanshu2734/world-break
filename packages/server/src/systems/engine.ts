import {
  ACTION_MIN_GAP_TICKS, ANCHOR_RULES, ARENA, CHANNEL_RANGE_SLACK, INTERACT_RANGE, PLATE_DY, PLATE_HALF_W, RANGE_DY, TICK_DT, TOOL_SPECS,
  type AbilityAction, type Arena, type Difficulty, type ItemAction, type StageAction, type StageState, type ToolId,
} from '@wb/shared';
import type { Entity, Objective, StageDef } from './stageDef';
import { evaluateFailures, topoOrder, type FailureEval } from './failures';
import { evaluatePower, type PowerEval } from './power';
import { validateStageDef } from './validate';
import { DisasterRuntime } from '../disasters/runtime';
import { AbilitySystem, type AbilityHazard, type AbilityResult } from '../abilities/system';
import type { PhysicsWorld } from '../abilities/world';
import { ItemSystem, type ItemResult } from '../salvage/system';

export interface PlayerPos { x: number; y: number; connected: boolean }
export type PosFn = (playerId: string) => PlayerPos | undefined;
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
type Tone = StageState['feed'][number]['tone'];

interface Effect { id: string; tool: ToolId; ownerId: string; x: number; y: number; r: number; expiresTick: number }
interface Channel { playerId: string; targetId: string; range: number }
interface PlayerRt {
  tools: Map<ToolId, { charges: number; cooldownUntil: number }>;
  lastActionTick: number;
  cacheReadyAt: number;
}
interface ObjRt { status: 'locked' | 'active' | 'complete'; hold: number }
type TargetInfo = { type: 'breakpoint' | 'conduit' | 'decoy' | 'core'; x: number; y: number; required: number };

const TICKS_PER_SECOND = Math.round(1 / TICK_DT);
const MAX_FEED = 8;
const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (message: string): ActionResult => ({ ok: true, message });
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
/** Horizontal reach plus a bounded vertical offset (feet vs. entity base). */
const reach = (p: PlayerPos, x: number, y: number, range: number) => Math.abs(p.x - x) <= range && Math.abs(p.y - y) <= RANGE_DY;

/**
 * Authoritative state of one stage attempt. Pure and socket-free: it is driven by `step()` (once per
 * simulation tick) and `action()` (validated player intents), and it publishes a public projection via
 * `state()`. Hidden breakpoints never appear in that projection until revealed.
 */
export class StageEngine {
  tick = 0;
  status: 'running' | 'stabilized' = 'running';
  expired = false;

  private readonly order: string[];
  private readonly entities: Map<string, Entity>;
  private readonly bps: Map<string, StageDef['breakpoints'][number]>;
  private readonly nodes: Map<string, StageDef['power']['nodes'][number]>;
  private readonly conduits: Map<string, StageDef['power']['conduits'][number]>;
  private readonly objectives: Map<string, Objective>;
  /** P3A: lifecycle of the disaster this stage was generated from (null for hand-authored stages). */
  private readonly disaster: DisasterRuntime | null;

  private players = new Map<string, PlayerRt>();
  private bpRt = new Map<string, { revealed: boolean; repaired: boolean }>();
  private conduitFixed = new Set<string>();
  private switchClosed = new Map<string, boolean>();
  private sealed = new Set<string>();
  private armedUntil = new Map<string, number>();
  /** P3B: pressure plates pressed during the last step (recomputed every tick; only transitions mark the state dirty). */
  private platesPressed = new Set<string>();
  private progress = new Map<string, number>();
  private objRt = new Map<string, ObjRt>();
  private cellUntil = new Map<string, number>();
  private suppressUntil = new Map<string, number>();
  private effects: Effect[] = [];
  private channels = new Map<string, Channel>();
  private nextPulse = new Map<string, number>();
  private clues = new Map<string, number>();
  private feed: StageState['feed'] = [];
  private score = { total: 0, breakdown: {} as Record<string, number> };
  private effectSeq = 0;
  /** P3B: hazards held by a Freeze (hazard id -> tick they thaw). */
  private frozenHazards = new Map<string, number>();
  /** P3B: Reality Energy and ability rules (null when the stage has no abilities). */
  private readonly abilities: AbilitySystem | null;
  /** P3C: parts the players find, carry and install (null when the stage has no items). */
  private readonly items: ItemSystem | null;
  private world: PhysicsWorld | null = null;
  private readonly arena: Arena;
  private dirty = true;
  private revCounter = 0;

  constructor(
    readonly def: StageDef,
    playerIds: readonly string[],
    /** `difficulty` sets the clue clarity of requirements (easy: names + hint, intermediate: silhouettes, hardcore: nothing until tried). */
    opts: { revBase?: number; arena?: Arena; difficulty?: Difficulty } = {},
  ) {
    const errors = validateStageDef(def, opts.arena ?? ARENA);
    if (errors.length) throw new Error(`Invalid stage "${def.id}":\n - ${errors.join('\n - ')}`);
    this.revBase = opts.revBase ?? 0;
    this.arena = opts.arena ?? ARENA;
    this.abilities = def.abilities ? new AbilitySystem(def.abilities, this.abilityHost()) : null;
    this.order = topoOrder(def.failures, def.edges)!;
    this.entities = new Map(def.entities.map((e) => [e.id, e]));
    this.bps = new Map(def.breakpoints.map((b) => [b.id, b]));
    this.nodes = new Map(def.power.nodes.map((n) => [n.id, n]));
    this.conduits = new Map(def.power.conduits.map((c) => [c.id, c]));
    this.objectives = new Map(def.objectives.map((o) => [o.id, o]));
    this.disaster = def.disaster ? new DisasterRuntime(def.disaster) : null;
    this.items = def.items && def.items.length > 0 ? new ItemSystem(def.items, def.needs ?? [], this.arena, this.itemHost(), { stashes: def.stashes ?? [], clarity: opts.difficulty ?? 'easy' }) : null;

    for (const b of def.breakpoints) this.bpRt.set(b.id, { revealed: false, repaired: false });
    for (const e of def.entities) if (e.kind === 'power_switch') this.switchClosed.set(e.id, e.initiallyClosed);
    for (const o of def.objectives) this.objRt.set(o.id, { status: 'locked', hold: 0 });
    for (const id of playerIds) this.addPlayer(id);
    this.say('The relay has gone cold. Find out why.', 'info');
    if (this.disaster) this.say(this.disaster.message(), 'warn');
    this.refreshObjectiveLocks();
  }
  private readonly revBase: number;

  // ------------------------------------------------------------------ P3B: physical world + abilities
  /** The Room hands the engine the sim's physical world (props, zones, impulses). Needed only for ability use. */
  attachWorld(world: PhysicsWorld): void { this.world = world; this.dirty = true; }

  private abilityHost() {
    const self = this;
    return {
      get tick() { return self.tick; },
      get arena() { return self.arena; },
      get world() { return self.world; },
      say: (text: string, tone: 'info' | 'good' | 'warn' | 'bad') => self.say(text, tone),
      markDirty: () => { self.dirty = true; },
      hazards: (): readonly AbilityHazard[] => self.def.hazards.map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, r: h.r })),
      hazardFrozen: (id: string) => (self.frozenHazards.get(id) ?? 0) > self.tick,
      freezeHazard: (id: string, until: number) => { self.frozenHazards.set(id, until); self.dirty = true; },
      activeAnchors: () => self.effects.filter((e) => e.tool === 'gravity_anchor').map((e) => ({ x: e.x, y: e.y - 20, r: e.r })),
    };
  }

  /** A player's reality-ability intent (gravity well, freeze, duplicate, momentum). */
  abilityAction(playerId: string, a: AbilityAction, pos: PosFn): AbilityResult {
    const me = pos(playerId);
    if (!this.players.has(playerId) || !me || !me.connected) return fail('You are not part of this run.');
    if (this.status !== 'running') return fail('This stage is already stabilised.');
    if (!this.abilities) return fail('Reality abilities are not available in this stage.');
    return this.abilities.use(playerId, a, me);
  }

  // ------------------------------------------------------------------ P3C: salvage (items, carrying, installing)
  private itemHost() {
    const self = this;
    return {
      get tick() { return self.tick; },
      say: (text: string, tone: 'info' | 'good' | 'warn' | 'bad') => self.say(text, tone),
      markDirty: () => { self.dirty = true; },
      award: (category: string, points: number) => self.award(category, points),
      wrongPartCost: () => self.def.scoring.wrongTargetPenalty,
      installTarget: (id: string): { x: number; y: number; label: string } | null => {
        const b = self.bps.get(id);
        if (b) return self.bpRt.get(id)!.revealed ? { x: b.x, y: b.y, label: b.label } : null; // hidden breakpoints do not exist yet
        const c = self.conduits.get(id);
        if (c) {
          const a = self.nodes.get(c.from)!, n = self.nodes.get(c.to)!;
          return { x: (a.x + n.x) / 2, y: Math.max(a.y, n.y), label: 'The connection' };
        }
        const e = self.entities.get(id);
        return e ? { x: e.x, y: e.y, label: e.label } : null;
      },
      busy: (playerId: string) => self.channels.has(playerId),
      unsafeAt: (x: number, y: number) => self.def.hazards.some((h) =>
        h.kind === 'arc_discharge' && self.hazardArmed(h) && dist(h.x, h.y, x, y - 20) <= (self.disaster?.hazardMod(h.id)?.r ?? h.r)),
    };
  }

  /** A player's salvage intent (pick up, drop, swap, hand over, install). */
  itemAction(playerId: string, a: ItemAction, pos: PosFn): ItemResult {
    const me = pos(playerId);
    if (!this.players.has(playerId) || !me || !me.connected) return fail('You are not part of this run.');
    if (this.status !== 'running') return fail('This stage is already stabilised.');
    if (!this.items) return fail('There is nothing to carry in this stage.');
    return this.items.use(playerId, a, me, pos);
  }

  /** Placement rules for the Gravity Anchor tool (P3B). Returns the reason it cannot be planted, or null. */
  private anchorPlacementError(me: PlayerPos): string | null {
    const a = this.arena;
    if (ANCHOR_RULES.needsFooting && !a.solids.some((s) => Math.abs(s.y - me.y) < 1.5 && me.x >= s.x && me.x <= s.x + s.w))
      return 'A gravity anchor needs solid footing.';
    if (me.x < ANCHOR_RULES.edgeMargin || me.x > a.width - ANCHOR_RULES.edgeMargin) return 'Too close to the edge to plant an anchor.';
    const anchors = this.effects.filter((e) => e.tool === 'gravity_anchor');
    if (anchors.length >= ANCHOR_RULES.maxActive) return `Only ${ANCHOR_RULES.maxActive} anchors can hold at once. Wait for one to fade.`;
    if (anchors.some((e) => dist(e.x, e.y, me.x, me.y) < ANCHOR_RULES.minSpacing)) return 'Too close to another anchor.';
    return null;
  }

  // ------------------------------------------------------------------ roster
  addPlayer(id: string): void {
    this.abilities?.addPlayer(id);
    this.items?.addPlayer(id);
    const tools = new Map<ToolId, { charges: number; cooldownUntil: number }>();
    for (const t of this.def.loadout) tools.set(t, { charges: TOOL_SPECS[t].maxCharges, cooldownUntil: 0 });
    this.players.set(id, { tools, lastActionTick: -100, cacheReadyAt: 0 });
    this.dirty = true;
  }
  removePlayer(id: string): void { this.items?.removePlayer(id); this.players.delete(id); this.channels.delete(id); this.abilities?.removePlayer(id); this.dirty = true; }
  onDisconnect(id: string): void { this.items?.onDisconnect(id); if (this.channels.delete(id)) this.dirty = true; }

  // ------------------------------------------------------------------ derived world state
  private conducts = (conduitId: string): boolean => {
    const c = this.conduits.get(conduitId)!;
    if (c.condition !== 'ok' && !this.conduitFixed.has(conduitId)) return false;
    return c.switchEntityId ? this.switchClosed.get(c.switchEntityId) === true : true;
  };
  private power(): PowerEval {
    return evaluatePower(this.def.power.nodes, this.def.power.conduits, this.def.power.capacity, this.conducts);
  }
  private cellActive(consumerId: string) { return (this.cellUntil.get(consumerId) ?? 0) > this.tick; }
  private consumerPowered(id: string) { return this.power().poweredConsumers.has(id) || this.cellActive(id); }

  private failureEval(): Map<string, FailureEval> {
    const grid = this.power();
    const own = (id: string): boolean => {
      const f = this.def.failures.find((x) => x.id === id)!;
      if (f.kind === 'breakpoint') return !this.bpRt.get(this.def.breakpoints.find((b) => b.failureId === id)!.id)!.repaired;
      if (f.kind === 'fault') return this.def.power.faultBindings.filter((b) => b.failureId === id).some((b) => !grid.poweredConsumers.has(b.consumerId));
      return false;
    };
    return evaluateFailures(this.order, this.def.edges, own, (id) => (this.suppressUntil.get(id) ?? 0) > this.tick);
  }

  private objStatus(id: string) { return this.objRt.get(id)!.status; }
  private hazardArmed(h: StageDef['hazards'][number]) {
    const base = !h.armedWhenObjective || this.objStatus(h.armedWhenObjective) === 'active';
    if (!base) return false;
    const mod = this.disaster?.hazardMod(h.id); // P3A: the disaster lifecycle may hold a hazard disarmed
    return mod ? mod.armed : true;
  }
  private hazardStabilized(hazardId: string) {
    const h = this.def.hazards.find((x) => x.id === hazardId)!;
    return this.effects.some((e) => TOOL_SPECS[e.tool].stabilizes.includes(h.kind) && dist(e.x, e.y, h.x, h.y) <= e.r);
  }
  private shielded(p: PlayerPos, kind: 'arc_discharge') {
    return this.effects.some((e) => TOOL_SPECS[e.tool].protectsFrom.includes(kind) && dist(e.x, e.y, p.x, p.y) <= e.r);
  }
  private coreObjective(targetId: string) {
    return this.def.objectives.find((o) => o.params.kind === 'channel_hold' && o.params.entityId === targetId);
  }

  // ------------------------------------------------------------------ bookkeeping helpers
  private say(text: string, tone: Tone) {
    this.feed.push({ tick: this.tick, text, tone });
    if (this.feed.length > MAX_FEED) this.feed.shift();
    this.dirty = true;
  }
  private award(category: string, points: number) {
    if (points === 0) return;
    this.score.total = Math.max(0, this.score.total + points);
    this.score.breakdown[category] = (this.score.breakdown[category] ?? 0) + points;
    this.dirty = true;
  }

  /** What a channel on `id` is working towards, or null if it no longer exists. */
  private targetInfo(id: string): TargetInfo | null {
    const bp = this.bps.get(id);
    if (bp) return { type: 'breakpoint', x: bp.x, y: bp.y, required: bp.repairTicks };
    const c = this.conduits.get(id);
    if (c) {
      const a = this.nodes.get(c.from)!, b = this.nodes.get(c.to)!;
      return { type: 'conduit', x: (a.x + b.x) / 2, y: Math.max(a.y, b.y), required: c.repairTicks };
    }
    const e = this.entities.get(id);
    if (e?.kind === 'decoy_panel') return { type: 'decoy', x: e.x, y: e.y, required: e.repairTicks };
    if (e?.kind === 'core_console') {
      const o = this.coreObjective(id);
      if (o && o.params.kind === 'channel_hold') return { type: 'core', x: e.x, y: e.y, required: o.params.requiredTicks };
    }
    return null;
  }

  // ------------------------------------------------------------------ simulation step
  step(pos: PosFn): void {
    if (this.status !== 'running') return;
    const t = ++this.tick;

    // timed things expire
    const nEffects = this.effects.length;
    this.effects = this.effects.filter((e) => e.expiresTick > t);
    if (this.effects.length !== nEffects) { this.dirty = true; this.say('A field collapses.', 'warn'); }
    for (const [id, until] of [...this.cellUntil]) if (until <= t) {
      this.cellUntil.delete(id);
      this.say(`The Power Cell feeding ${this.nodes.get(id)!.label} runs dry.`, 'warn');
    }
    for (const [id, until] of [...this.suppressUntil]) if (until <= t) {
      this.suppressUntil.delete(id);
      if (this.failureEval().get(id)?.raw) this.say(`${this.def.failures.find((f) => f.id === id)!.label} is back.`, 'bad');
    }
    for (const [id, until] of [...this.armedUntil]) if (until <= t) {
      this.armedUntil.delete(id);
      if (this.entities.get(id)?.kind === 'pressure_plate') continue; // plates re-arm every tick they stay pressed
      if (this.objStatus(this.consoleObjective(id)) !== 'complete') this.say(`${this.entities.get(id)!.label} slipped out of phase.`, 'warn');
      this.dirty = true;
    }
    this.stepPlates(pos);

    for (const [id, until] of [...this.frozenHazards]) if (until <= t) { this.frozenHazards.delete(id); this.say('The hazard thaws and resumes its cycle.', 'warn'); this.dirty = true; }
    this.abilities?.step();
    this.items?.step(pos);

    this.stepHazards(pos);
    this.stepChannels(pos);
    this.stepObjectives();
    this.stepDisaster();

    if (this.status === 'running' && !this.expired && t >= this.def.deadlineTicks) {
      this.expired = true;
      this.award('overrun', -this.def.scoring.expiredPenalty);
      this.say('Time overrun. The relay is deteriorating.', 'bad');
    }
    if (this.expired && t > this.def.deadlineTicks && t % TICKS_PER_SECOND === 0) this.award('overrun', -this.def.scoring.expiredDrainPerSecond);
  }

  private stepHazards(pos: PosFn) {
    for (const h of this.def.hazards) {
      if (h.kind !== 'arc_discharge') continue;
      const mod = this.disaster?.hazardMod(h.id);
      const period = mod?.periodTicks ?? h.periodTicks!;
      const radius = mod?.r ?? h.r;
      if (!this.hazardArmed(h)) { if (this.nextPulse.delete(h.id)) this.dirty = true; continue; }
      if (!this.nextPulse.has(h.id)) { this.nextPulse.set(h.id, this.tick + (h.firstPulseTick ?? period)); this.dirty = true; }
      if ((this.frozenHazards.get(h.id) ?? 0) > this.tick) { // P3B: a Freeze holds the cycle (the countdown pauses)
        this.nextPulse.set(h.id, this.nextPulse.get(h.id)! + 1);
        this.dirty = true;
        continue;
      }
      if (this.tick < this.nextPulse.get(h.id)!) continue;
      this.nextPulse.set(h.id, this.tick + period);
      this.dirty = true;
      for (const pid of this.players.keys()) {
        const p = pos(pid);
        if (!p?.connected || dist(h.x, h.y, p.x, p.y - 20) > radius) continue;
        if (this.shielded(p, 'arc_discharge')) { this.say('The shield absorbs an arc discharge.', 'good'); continue; }
        this.award('hazard', -this.def.scoring.hazardHitPenalty);
        this.say('An arc discharge hits the core deck.', 'bad');
        this.items?.onHazardHit(pid); // P3C: bounded loss of one carried part (shielded players never get here)
        if (this.channels.has(pid)) this.interrupt(pid, 'The discharge breaks your concentration.', true);
      }
    }
  }

  /** P3A: advance the disaster lifecycle (ticks only). Runs after objectives; a finished stage forces CLEANUP. */
  private stepDisaster() {
    if (!this.disaster || !this.def.disaster) return;
    const resolved = this.def.disaster.resolveObjectives.every((o) => this.objStatus(o) === 'complete');
    const apply = (r: ReturnType<DisasterRuntime['step']>) => {
      for (const line of r.feed) this.say(line.text, line.tone);
      if (r.scoreDelta !== 0) this.award('disaster', r.scoreDelta);
      if (r.changed) this.dirty = true;
    };
    apply(this.disaster.step(this.tick, resolved));
    if (this.status === 'stabilized') {
      apply(this.disaster.finish(this.tick)); // engine stops stepping: clean up now
      if (this.nextPulse.size > 0) { this.nextPulse.clear(); this.dirty = true; } // no telegraph may outlive the disaster
    }
  }

  private stepChannels(pos: PosFn) {
    const counts = new Map<string, number>();
    for (const ch of [...this.channels.values()]) {
      const p = pos(ch.playerId);
      const info = this.targetInfo(ch.targetId);
      if (!p || !p.connected || !info) { this.channels.delete(ch.playerId); this.dirty = true; continue; }
      if (Math.abs(p.x - info.x) > ch.range + CHANNEL_RANGE_SLACK || Math.abs(p.y - info.y) > RANGE_DY + CHANNEL_RANGE_SLACK) {
        this.interrupt(ch.playerId, 'You moved out of reach.', false);
        continue;
      }
      const o = this.coreObjective(ch.targetId);
      if (o?.params.kind === 'channel_hold' && o.params.needsStableHazard && !this.hazardStabilized(o.params.needsStableHazard)) {
        this.interrupt(ch.playerId, 'The gravity field destabilises and throws you off.', true);
        continue;
      }
      if (o && !this.consumerPowered(this.coreConsumer(ch.targetId))) {
        this.interrupt(ch.playerId, 'The console loses power.', true);
        continue;
      }
      counts.set(ch.targetId, (counts.get(ch.targetId) ?? 0) + 1);
    }
    for (const [target, n] of counts) {
      const info = this.targetInfo(target)!;
      const prog = (this.progress.get(target) ?? 0) + n; // each active channeller adds one tick of work per tick
      this.progress.set(target, prog);
      this.dirty = true;
      if (prog >= info.required) this.completeTarget(target, info);
    }
  }

  private coreConsumer(entityId: string): string {
    const e = this.entities.get(entityId);
    return e?.kind === 'core_console' ? e.consumerId : '';
  }
  private consoleObjective(entityId: string): string {
    const e = this.entities.get(entityId);
    return e && (e.kind === 'sync_console' || e.kind === 'core_console') ? e.objectiveId : '';
  }

  /** Ends a player's channel. A hazard setback halves the shared progress on that target. */
  private interrupt(playerId: string, why: string, setback: boolean) {
    const ch = this.channels.get(playerId);
    if (!ch) return;
    this.channels.delete(playerId);
    if (setback) this.progress.set(ch.targetId, Math.floor((this.progress.get(ch.targetId) ?? 0) / 2));
    this.say(setback ? `${why} Progress is set back.` : why, setback ? 'bad' : 'warn');
  }

  private completeTarget(target: string, info: TargetInfo) {
    for (const [pid, ch] of [...this.channels]) if (ch.targetId === target) this.channels.delete(pid);
    if (info.type === 'breakpoint') {
      this.bpRt.get(target)!.repaired = true;
      this.abilities?.onRepair('breakpoint');
      this.award('repair', 100);
      this.say(`${this.bps.get(target)!.label} repaired.`, 'good');
    } else if (info.type === 'conduit') {
      this.conduitFixed.add(target);
      this.abilities?.onRepair('conduit');
      this.award('repair', 50);
      this.say('Connection repaired.', 'good');
    } else if (info.type === 'decoy') {
      const e = this.entities.get(target) as Extract<Entity, { kind: 'decoy_panel' }>;
      this.progress.delete(target);
      this.suppressUntil.set(e.mitigates, this.tick + e.mitigateTicks);
      this.award('wrong_target', -this.def.scoring.wrongTargetPenalty);
      this.say('The flicker eases, for now. The pulse is still arriving from somewhere.', 'warn');
    } else {
      this.completeObjective(this.coreObjective(target)!);
    }
  }

  // ------------------------------------------------------------------ objectives
  private refreshObjectiveLocks() {
    for (const o of this.def.objectives) {
      const rt = this.objRt.get(o.id)!;
      if (rt.status === 'complete') continue;
      const locked = o.prerequisites.some((p) => this.objStatus(p) !== 'complete');
      const next = locked ? 'locked' : 'active';
      if (rt.status !== next) { rt.status = next; this.dirty = true; }
    }
  }

  /** Is something standing on this plate right now? Players count unless the plate is heavy; props count only when resting. */
  private platePressed(e: Extract<Entity, { kind: 'pressure_plate' }>, pos: PosFn): boolean {
    if (e.activatedBy !== 'object') {
      for (const id of this.players.keys()) {
        const p = pos(id);
        if (p?.connected && Math.abs(p.x - e.x) <= PLATE_HALF_W && Math.abs(p.y - e.y) <= PLATE_DY) return true;
      }
    }
    for (const pr of this.world?.listProps() ?? []) {
      if (pr.grounded && Math.abs(pr.x - e.x) <= PLATE_HALF_W && Math.abs(pr.y - e.y) <= PLATE_DY) return true;
    }
    return false;
  }

  private stepPlates(pos: PosFn) {
    const now = new Set<string>();
    for (const e of this.def.entities) {
      if (e.kind !== 'pressure_plate') continue;
      if (this.platePressed(e, pos)) { now.add(e.id); this.armedUntil.set(e.id, this.tick + 1); }
    }
    if (now.size !== this.platesPressed.size || [...now].some((id) => !this.platesPressed.has(id))) this.dirty = true;
    this.platesPressed = now;
  }

  private stepObjectives() {
    this.refreshObjectiveLocks();
    for (const o of this.def.objectives) {
      const rt = this.objRt.get(o.id)!;
      if (rt.status !== 'active') continue;
      const p = o.params;
      if (p.kind === 'repair_breakpoint') {
        if (this.bpRt.get(p.breakpointId)!.repaired) this.completeObjective(o);
      } else if (p.kind === 'power_route') {
        // Only grid power counts; a Power Cell merely mitigates. The route must hold, then it is sealed.
        const before = rt.hold;
        rt.hold = this.power().poweredConsumers.has(p.consumerId) ? rt.hold + 1 : 0;
        if (rt.hold !== before) this.dirty = true;
        if (rt.hold >= p.holdTicks) this.completeObjective(o);
      } else if (p.kind === 'timed_controls') {
        if (p.controls.every((c) => (this.armedUntil.get(c) ?? 0) > this.tick)) this.completeObjective(o);
      }
      // channel_hold completes through completeTarget()
    }
    this.refreshObjectiveLocks();
  }

  private completeObjective(o: Objective) {
    const rt = this.objRt.get(o.id)!;
    if (rt.status === 'complete') return;
    rt.status = 'complete';
    this.award('objective', o.bonus);
    this.say(`Objective complete: ${o.label}.`, 'good');
    if (o.params.kind === 'power_route') {
      for (const s of o.params.sealSwitches) this.sealed.add(s);
      this.say('The breakers seal. The route holds.', 'good');
    }
    this.refreshObjectiveLocks();
    if (this.def.objectives.every((x) => this.objStatus(x.id) === 'complete')) {
      this.status = 'stabilized';
      const secondsLeft = Math.max(0, Math.floor((this.def.deadlineTicks - this.tick) / TICKS_PER_SECOND));
      this.award('time', secondsLeft * this.def.scoring.timeBonusPerSecond);
      this.channels.clear();
      this.say('The relay core is stable. Stage cleared.', 'good');
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ player actions
  action(playerId: string, a: StageAction, pos: PosFn): ActionResult {
    const p = this.players.get(playerId);
    const me = pos(playerId);
    if (!p || !me || !me.connected) return fail('You are not part of this run.');
    if (this.status !== 'running') return fail('This stage is already stabilised.');

    if (a.kind === 'cancel') {
      if (!this.channels.has(playerId)) return fail('Nothing to cancel.');
      this.channels.delete(playerId);
      this.dirty = true;
      return ok('Cancelled. Progress is kept.');
    }
    if (this.tick - p.lastActionTick < ACTION_MIN_GAP_TICKS) return fail('Too fast.');
    p.lastActionTick = this.tick;
    return a.kind === 'interact' ? this.interact(playerId, p, me, a.targetId) : this.useTool(playerId, p, me, a.tool, a.targetId);
  }

  private interact(pid: string, p: PlayerRt, me: PlayerPos, targetId: string): ActionResult {
    const e = this.entities.get(targetId);
    if (!e) return fail('Nothing there.');
    if (!reach(me, e.x, e.y, INTERACT_RANGE)) return fail('Too far away.');
    if (this.channels.has(pid)) return fail('Finish or cancel your current task first.');

    const oid = e.kind === 'sync_console' || e.kind === 'core_console' ? e.objectiveId : null;
    if (oid) {
      const o = this.objectives.get(oid)!;
      if (this.objStatus(oid) === 'locked') return fail(o.lockedMessage || 'Locked.');
      if (this.objStatus(oid) === 'complete') return fail('Already done.');
    }

    const missing = this.items?.gateMessage(e.id); // P3C: a console, switch or cache that needs parts stays shut until they are installed
    if (missing) return fail(missing);

    switch (e.kind) {
      case 'supply_cache': {
        if (this.tick < p.cacheReadyAt) return fail('The cache is still resupplying.');
        const needs = [...p.tools].some(([t, v]) => v.charges < TOOL_SPECS[t].maxCharges);
        if (!needs) return fail('Your tools are already full.');
        for (const [t, v] of p.tools) v.charges = TOOL_SPECS[t].maxCharges;
        p.cacheReadyAt = this.tick + e.cooldownTicks;
        this.award('resupply', -e.refillPenalty);
        this.say('Tools resupplied.', 'info');
        return ok('Tools resupplied.');
      }
      case 'power_switch': {
        if (this.sealed.has(e.id)) return fail('That breaker is sealed.');
        const closed = !this.switchClosed.get(e.id);
        this.switchClosed.set(e.id, closed);
        this.dirty = true;
        if (this.power().overloaded) {
          for (const sw of this.switchClosed.keys()) if (!this.sealed.has(sw)) this.switchClosed.set(sw, false);
          this.award('overload', -this.def.scoring.overloadPenalty);
          this.say('Generator overload! Every breaker trips open.', 'bad');
          return ok('Overload. The breakers tripped open.');
        }
        this.say(`${e.label} ${closed ? 'closed' : 'opened'}.`, 'info');
        return ok(`${e.label} ${closed ? 'closed' : 'opened'}.`);
      }
      case 'sync_console': {
        const o = this.objectives.get(e.objectiveId)!;
        if (o.params.kind !== 'timed_controls') return fail('Nothing there.');
        this.armedUntil.set(e.id, this.tick + o.params.armTicks);
        this.dirty = true;
        this.say(`${e.label} armed.`, 'info');
        return ok(`${e.label} armed.`);
      }
      case 'pressure_plate':
        return fail(e.activatedBy === 'object' ? 'Too light to trigger it. It needs something heavy resting on it.' : 'Step on it and stay on it.');
      case 'decoy_panel':
        return ok('The panel reads nominal. Whatever is wrong is not here.');
      case 'core_console': {
        if (!this.consumerPowered(e.consumerId)) return fail('The console is dead. It has no power feed.');
        const o = this.objectives.get(e.objectiveId)!;
        if (o.params.kind === 'channel_hold' && o.params.needsStableHazard && !this.hazardStabilized(o.params.needsStableHazard))
          return fail('Gravity is too unstable to hold the console.');
        this.channels.set(pid, { playerId: pid, targetId: e.id, range: INTERACT_RANGE });
        this.dirty = true;
        return ok('Stabilising the core. Stay in reach.');
      }
    }
  }

  private spend(inv: { charges: number; cooldownUntil: number }, tool: ToolId) {
    inv.charges--;
    inv.cooldownUntil = this.tick + TOOL_SPECS[tool].cooldownTicks;
    this.dirty = true;
  }

  private useTool(pid: string, p: PlayerRt, me: PlayerPos, tool: ToolId, targetId?: string): ActionResult {
    const spec = TOOL_SPECS[tool];
    const inv = p.tools.get(tool);
    if (!inv) return fail('You are not carrying that tool.');
    if (inv.charges <= 0) return fail('That tool is out of charges. Visit the supply cache.');
    if (this.tick < inv.cooldownUntil) return fail('That tool is still recharging.');

    switch (tool) {
      case 'phase_scanner': {
        this.spend(inv, tool);
        const found: string[] = [];
        for (const b of this.def.breakpoints) {
          const rt = this.bpRt.get(b.id)!;
          if (rt.revealed || dist(me.x, me.y, b.x, b.y) > spec.radius) continue;
          if (!b.scanRequires.every((o) => this.objStatus(o) === 'complete')) continue; // not eligible yet
          rt.revealed = true;
          found.push(b.label);
          this.say(`Scanner: ${b.label} located.`, 'good');
        }
        let readings = 0;
        for (const c of this.def.clues) {
          if (this.clues.has(c.id) || dist(me.x, me.y, c.x, c.y) > spec.radius) continue;
          this.clues.set(c.id, this.tick);
          this.say(c.text, 'clue');
          readings++;
        }
        const stash = this.items?.revealByScan(me.x, me.y, spec.radius) ?? 0; // P3C: hidden parts within range come into focus
        return ok(found.length ? `Found: ${found.join(', ')}.` : readings ? 'The scan picked up readings.' : stash ? 'The scan turned up hidden parts.' : 'Nothing unusual in range.');
      }
      case 'flux_welder': {
        if (!targetId) return fail('Choose something to weld.');
        const b = this.bps.get(targetId);
        const visibleBp = b && this.bpRt.get(targetId)!.revealed;
        const c = this.conduits.get(targetId);
        const e = this.entities.get(targetId);
        // Hidden breakpoints are indistinguishable from nothing: no oracle for unrevealed targets.
        if ((b && !visibleBp) || (!b && !c && !e && !this.nodes.has(targetId))) return fail('Nothing there to repair.');
        const info = this.targetInfo(targetId);
        if (!info) return fail('The welder has no use on that.');
        if (!reach(me, info.x, info.y, spec.range)) return fail('Too far away.');
        if (b) {
          if (this.bpRt.get(targetId)!.repaired) return fail('That is already repaired.');
          if (!b.weldable) return fail('The welder cannot fix that.');
        } else if (c) {
          if (c.condition === 'ok' || this.conduitFixed.has(targetId)) return fail('That connection is not damaged.');
          if (c.condition === 'melted') return fail('That connection is too far gone to weld. Route power around it.');
        } else if (info.type !== 'decoy') {
          return fail('The welder has no use on that.');
        }
        const missing = this.items?.gateMessage(targetId); // P3C: a target that needs parts cannot be welded until they are installed
        if (missing) return fail(missing);
        if (this.channels.has(pid)) return fail('Finish or cancel your current task first.');
        this.spend(inv, tool);
        this.channels.set(pid, { playerId: pid, targetId, range: spec.range });
        return ok('Welding. Stay in reach.');
      }
      case 'gravity_anchor':
      case 'shield_projector': {
        if (tool === 'gravity_anchor') {
          const why = this.anchorPlacementError(me); // P3B placement rules; nothing is spent when they refuse
          if (why) return fail(why);
        }
        this.spend(inv, tool);
        this.effects.push({ id: `fx${++this.effectSeq}`, tool, ownerId: pid, x: me.x, y: me.y, r: spec.radius, expiresTick: this.tick + spec.durationTicks });
        const msg = tool === 'gravity_anchor' ? 'Gravity anchor deployed.' : 'Shield projected.';
        this.say(msg, 'info');
        return ok(msg);
      }
      case 'power_cell': {
        if (!targetId) return fail('Choose a system to power.');
        const n = this.nodes.get(targetId);
        if (!n || n.kind !== 'consumer') return fail('A Power Cell can only feed a consumer.');
        if (!reach(me, n.x, n.y, spec.range)) return fail('Too far away.');
        if (this.consumerPowered(n.id)) return fail('That system already has power.');
        this.spend(inv, tool);
        this.cellUntil.set(n.id, this.tick + spec.durationTicks);
        for (const fb of this.def.power.faultBindings) if (fb.consumerId === n.id) this.suppressUntil.set(fb.failureId, this.tick + spec.durationTicks);
        this.say(`The Power Cell feeds ${n.label} for a while.`, 'good');
        return ok(`${n.label} is running on a Power Cell.`);
      }
    }
  }

  // ------------------------------------------------------------------ public projection
  /** Returns the public state if anything changed since the last call, else null. */
  consumeState(): StageState | null {
    if (!this.dirty) return null;
    this.revCounter++;
    this.dirty = false;
    return this.state();
  }

  state(): StageState {
    const grid = this.power();
    const fe = this.failureEval();
    const prog = (id: string, req: number) => Math.min(1, (this.progress.get(id) ?? 0) / req);

    return {
      rev: this.revBase + this.revCounter,
      stageId: this.def.id,
      name: this.def.name,
      status: this.status,
      tick: this.tick,
      deadlineTick: this.def.deadlineTicks,
      expired: this.expired,
      score: { total: this.score.total, breakdown: { ...this.score.breakdown } },
      objectives: this.def.objectives.map((o) => {
        const rt = this.objRt.get(o.id)!;
        const p = o.params;
        let progress = 0;
        if (rt.status === 'complete') progress = 1;
        else if (p.kind === 'repair_breakpoint') progress = prog(p.breakpointId, this.bps.get(p.breakpointId)!.repairTicks);
        else if (p.kind === 'power_route') progress = Math.min(1, rt.hold / p.holdTicks);
        else if (p.kind === 'timed_controls') progress = p.controls.filter((c) => (this.armedUntil.get(c) ?? 0) > this.tick).length / p.controls.length;
        else progress = prog(p.entityId, p.requiredTicks);
        return {
          id: o.id, label: o.label, description: o.description, status: rt.status, progress,
          prerequisites: [...o.prerequisites], lockedMessage: o.lockedMessage,
        };
      }),
      symptoms: this.def.failures.filter((f) => f.kind === 'symptom').map((f) => {
        const ev = fe.get(f.id)!;
        return {
          id: f.id, label: f.label, hint: f.hint, state: ev.state,
          mitigatedUntilTick: ev.state === 'mitigated' ? this.mitigationEnd(f.id, fe) : null,
        };
      }),
      // Only revealed breakpoints are visible. Hidden ones are absent, not flagged.
      breakpoints: this.def.breakpoints.filter((b) => this.bpRt.get(b.id)!.revealed).map((b) => ({
        id: b.id, label: b.label, x: b.x, y: b.y, repaired: this.bpRt.get(b.id)!.repaired,
        progress: this.bpRt.get(b.id)!.repaired ? 1 : prog(b.id, b.repairTicks),
      })),
      entities: this.def.entities.map((e) => {
        let state = 'ready', locked = false, armed: number | null = null;
        if (e.kind === 'power_switch') {
          locked = this.sealed.has(e.id);
          state = locked ? 'sealed' : this.switchClosed.get(e.id) ? 'closed' : 'open';
        } else if (e.kind === 'sync_console') {
          const st = this.objStatus(e.objectiveId);
          locked = st !== 'active';
          const until = this.armedUntil.get(e.id) ?? 0;
          armed = until > this.tick ? until : null;
          state = st === 'complete' ? 'locked' : armed ? 'armed' : 'idle';
        } else if (e.kind === 'core_console') {
          const st = this.objStatus(e.objectiveId);
          locked = st !== 'active';
          state = st === 'complete' ? 'complete' : [...this.channels.values()].some((c) => c.targetId === e.id) ? 'channeling'
            : this.consumerPowered(e.consumerId) ? 'powered' : 'dead';
        } else if (e.kind === 'pressure_plate') {
          const st = this.objStatus(e.objectiveId);
          locked = st === 'locked';
          state = st === 'complete' ? 'complete' : this.platesPressed.has(e.id) ? 'pressed' : 'idle';
        } else if (e.kind === 'decoy_panel') {
          state = (this.suppressUntil.get(e.mitigates) ?? 0) > this.tick ? 'calm' : 'flickering';
        }
        return { id: e.id, kind: e.kind, label: e.label, x: e.x, y: e.y, state, armedUntilTick: armed, locked };
      }),
      power: {
        capacity: this.def.power.capacity, load: grid.load,
        nodes: this.def.power.nodes.map((n) => {
          const gridOn = grid.liveNodes.has(n.id);
          const cell = n.kind === 'consumer' && !gridOn && this.cellActive(n.id);
          return { id: n.id, kind: n.kind, label: n.label, x: n.x, y: n.y, powered: gridOn || cell, source: gridOn ? 'grid' as const : cell ? 'cell' as const : null };
        }),
        conduits: this.def.power.conduits.map((c) => ({
          id: c.id, from: c.from, to: c.to,
          condition: this.conduitFixed.has(c.id) ? 'ok' as const : c.condition,
          switchEntityId: c.switchEntityId ?? null,
          closed: c.switchEntityId ? this.switchClosed.get(c.switchEntityId) === true : true,
          live: grid.liveConduits.has(c.id),
        })),
      },
      hazards: this.def.hazards.map((h) => ({
        id: h.id, kind: h.kind, label: h.label, x: h.x, y: h.y, r: this.disaster?.hazardMod(h.id)?.r ?? h.r,
        armed: this.hazardArmed(h), stabilized: this.hazardStabilized(h.id), nextPulseTick: this.nextPulse.get(h.id) ?? null,
        ...((this.frozenHazards.get(h.id) ?? 0) > this.tick ? { frozenUntilTick: this.frozenHazards.get(h.id)! } : {}),
      })),
      effects: this.effects.map((e) => ({ id: e.id, tool: e.tool, ownerId: e.ownerId, x: e.x, y: e.y, r: e.r, expiresTick: e.expiresTick })),
      channels: [...this.channels.values()].map((c) => {
        const info = this.targetInfo(c.targetId)!;
        return { playerId: c.playerId, targetId: c.targetId, progress: prog(c.targetId, info.required) };
      }),
      players: [...this.players].map(([id, rt]) => ({
        id,
        tools: [...rt.tools].map(([tool, v]) => ({ tool, charges: v.charges, maxCharges: TOOL_SPECS[tool].maxCharges, cooldownUntilTick: v.cooldownUntil })),
      })),
      clues: [...this.clues].map(([id, tick]) => ({ id, text: this.def.clues.find((c) => c.id === id)!.text, tick })),
      feed: this.feed.map((f) => ({ ...f })),
      ...(this.disaster ? { disaster: this.disaster.publicState() } : {}),
      ...(this.abilities ? { abilities: this.abilities.publicState() } : {}),
      ...(this.items ? { items: this.items.publicState() } : {}),
    };
  }

  /** When a mitigated symptom relapses: the earliest expiry among the active mitigations masking it. */
  private mitigationEnd(id: string, fe: Map<string, FailureEval>): number | null {
    let end: number | null = null;
    const visit = (n: string) => {
      const until = this.suppressUntil.get(n);
      if (until && until > this.tick) end = end === null ? until : Math.min(end, until);
      for (const e of this.def.edges) if (e.to === n && fe.get(e.from)!.raw) visit(e.from);
    };
    visit(id);
    return end;
  }
}
