import { randomInt } from 'node:crypto';
import {
  MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SERVER_TICK_HZ,
  deriveSeed, isDifficultyUnlocked, nextRoomPhase,
  ARENA, EYE_HEIGHT, NOISE_KIND_LOUDNESS, PLAYER_HEIGHT, getArena, HOWLER_LIMITS, WIPE, ghostLineupForStage, ghostPickFor, ghostPresentOnStage, ghostSeedFor, inLitRegion, layoutOf, pointVisible, roomById, visionRadius, type AbilityAction, type DeathReviewMsg, type DeathState, type EscapeAction, type GhostAction, type GhostPing, type PlayerLife, type SpectateFollow, type SpectateMove, type SpectateRoom, type Arena, type RoomLayout, type ItemAction, type Difficulty, type GameSnapshot, type GhostCue, type GhostFx, type InputIntent, type RoomPhase, type RoomSnapshot, type StageAction, type StageState,
} from '@wb/shared';
import { GameSim } from './game';
import { StageEngine, type ActionResult } from './systems/engine';
import type { StageDef } from './systems/stageDef';
import { getStageDef } from './systems/registry';
import { fallbackStageDef } from './disasters/fallback';
import { withDefaultAbilities } from './abilities/defaults';
import { ABILITY_LAB_STAGE } from './systems/stages/abilityLab';
import { LOCK_SAMPLER_STAGE, ROOMS_DEMO_STAGE } from './rooms/demoStage';
import { generateEscapeStage } from './rooms/generate';
import type { EscapeResult } from './rooms/escape';
import { restrictedView, type RestrictedView } from './rooms/view';
import { CatchSystem, GhostSystem, PulseGun, type CatchHost, type GunHost, type ShotDelivery, type GhostEvent, type GhostPlayer, type GhostCatchEvent } from './ghost';
import type { InputExtra } from './game';
import type { AbilityResult } from './abilities/system';
import type { ItemResult } from './salvage/system';
import { DEATH_TABLE, DeathSystem, ReviveSystem, ReviewLog, SpectateSystem, buildMessage, cueNotes, type ReviewCueSig, type CarriedItem, type DeathHost, type DroppedItem, type KillCause } from './death';

/** Briefing countdown before play begins (3 s of server ticks). */
export const BRIEFING_TICKS = 3 * SERVER_TICK_HZ;

export type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

interface Member { id: string; name: string; ready: boolean; connected: boolean }

/** Server-side record of the stage being played. Never sent to clients (the seed derives hidden layouts). */
export interface StageRecord { stage: number; seed: number; defId: string; fallback: boolean; /** P4 step 4: 0 for the first try of this stage number, 1 for the first retry, and so on. */ attempt: number }

/** Pure, socket-free room state. All mutations are validated here. */
export class Room {
  phase: RoomPhase = 'lobby';
  difficulty: Difficulty = 'easy';
  stage = 1;
  /** P4 step 4: how many times this stage number has been retried after a team wipe (0 = the first try). Back to 0 on the next stage. */
  private attempt = 0;
  /** Team progression. Persistence arrives with the progression phase. */
  highestStage = 1;
  hostId = '';
  private members = new Map<string, Member>();
  private sim: GameSim | null = null;
  private engine: StageEngine | null = null;
  private briefingTicksLeft = 0;
  private stageRec: StageRecord | null = null;
  /** P3E: the ghost of the current stage (null when the option is off, on stage 1, or on a stage that is not an escape stage). */
  private ghost: GhostSystem | null = null;
  /** P3E step 3: hiding and the catch of the current stage (exists exactly when `ghost` does). */
  private catchSys: CatchSystem | null = null;
  /** P3E step 4: the Pulse Gun of the current stage (exists exactly when `ghost` does). */
  private gun: PulseGun | null = null;
  /** P4: who is alive, a body or eliminated on the current stage (exists exactly when `ghost` does: only a ghost kills). */
  private death: DeathSystem | null = null;
  /** P4 step 2: whom each dead player watches, and the ghost-here ping (exists exactly when `death` does). */
  private spectate: SpectateSystem | null = null;
  /** P4 step 3: reviving (exists exactly when `death` does). */
  private reviveSys: ReviveSystem | null = null;
  /** P4 step 2: pings waiting to be sent, each to the players it concerns. Bounded. */
  private pings: { to: string[]; ping: GhostPing }[] = [];
  /** P4 step 2: the (target, room) each spectator was last sent a layout for, so they learn the walls of the room they are watching and nothing else. */
  private specLayouts = new Map<string, string>();
  /** P4 step 4: what happened around each player (warnings, noise, hiding, rescues), noted as it happens; and what the cue stream last said, per player. */
  private reviewLog = new ReviewLog();
  private reviewSeen = new WeakSet<GhostEvent>();
  private cueSigs = new Map<string, ReviewCueSig>();
  /** P4 step 4: the reviews of the last wipe, each for ONE player (built when the wipe turns into the review), and the ticks left of the wipe beat. */
  private reviews = new Map<string, DeathReviewMsg>();
  private wipeLeft = 0;

  /**
   * `runSeed` is the root of every stage seed of this run (server-side only). It defaults to a pure function of the
   * room code so unit tests are deterministic; `RoomManager.create` passes a fresh crypto-random seed.
   */
  constructor(
    readonly code: string,
    private readonly briefingTicks: number = BRIEFING_TICKS,
    private readonly runSeed: number = deriveSeed('run', code),
    /**
     * P3B dev option `lab`: stage 1 of this room is the hand-authored Ability Lab (never part of the rotation).
     * P3C option `hunt`: stage 1 is the salvage hunt instead of the tutorial. `lab` wins when both are set.
     */
    private readonly opts: { lab?: boolean; hunt?: boolean; rooms?: boolean | 2; escape?: boolean; ghost?: boolean; startStage?: number } = {},
  ) {
    // P3E dev/test option: begin the run at this stage (so the ghost can be met without playing the stages before it)
    const s0 = opts.startStage;
    if (s0 !== undefined && Number.isSafeInteger(s0) && s0 >= 1) { this.stage = s0; this.highestStage = s0; }
  }

  /** True for a room created as an Ability Lab room. Only stage 1 is the Lab; stage 2+ are the normal endless stages. */
  get isLab(): boolean { return this.opts.lab === true; }

  /** Server-only view of the current stage seed and definition id (not part of any snapshot). */
  get stageRecord(): Readonly<StageRecord> | null { return this.stageRec; }

  /**
   * Builds the engine for `stage`. Stage 1 is hand-authored; later stages are generated from the stage seed.
   * If a generated stage ever fails validation, fall back to the deterministic fallback stage (never "no stage").
   */
  private buildEngine(stage: number, opts: { revBase?: number } = {}): StageEngine {
    // P4 step 4: a retry of the SAME stage number gets a NEW seed (derived from the run seed, the stage and the attempt); the first try keeps the seed it always had
    const seed = this.attempt === 0 ? deriveSeed(this.runSeed, 'stage', stage) : deriveSeed(this.runSeed, 'stage', stage, 'retry', this.attempt);
    const ids = [...this.members.keys()];
    let fallback = false;
    let engine: StageEngine;
    // `lab` wins over `rooms` (P3D dev demo), which wins over the hunt/tutorial choice of the registry.
    const base = this.isLab && stage === 1 ? ABILITY_LAB_STAGE
      : this.opts.rooms === true && stage === 1 ? ROOMS_DEMO_STAGE
      : this.opts.rooms === 2 && stage === 1 ? LOCK_SAMPLER_STAGE
      // P3D step 5: with escape stages on (ESCAPE_STAGES, default on for the dev server) EVERY stage, 1 included, is generated by the escape
      // generator; off, the previous stage 1 and generator behaviour are untouched.
      : this.opts.escape === true ? generateEscapeStage(stage, seed, { ghost: this.opts.ghost === true, difficulty: this.difficulty })
      : getStageDef(stage, seed, { hunt: this.opts.hunt === true });
    try {
      engine = new StageEngine(base.escape ? base : withDefaultAbilities(base, stage), ids, { ...opts, arena: this.stageArena(base), difficulty: this.difficulty, stage, rooms: this.roomsHost });
    } catch (err) {
      if (stage === 1 && this.opts.escape !== true) throw err;
      fallback = true;
      // never "no stage": a deterministic recovery stage (an escape run recovers with an escape tutorial)
      const fb = this.opts.escape === true ? generateEscapeStage(1, deriveSeed(seed, 'recovery')) : fallbackStageDef(stage);
      engine = new StageEngine(fb.escape ? fb : withDefaultAbilities(fb, stage), ids, { ...opts, arena: this.stageArena(fb), difficulty: this.difficulty, stage, rooms: this.roomsHost });
    }
    this.stageRec = { stage, seed, defId: engine.def.id, fallback, attempt: this.attempt };
    return engine;
  }

  /** The arena a built stage is played on (its `arenaId`; Relay Platform 01 for every rotation stage). */
  private arenaOf(engine: StageEngine): Arena {
    const g = engine.def.rooms; // P3D: a multi-room stage plays on its start room's arena
    if (g) { const start = roomById(g, g.start); if (start) return start.arena; }
    return getArena(engine.def.arenaId) ?? ARENA;
  }

  private stageArena(def: StageDef): Arena {
    if (def.rooms) { const start = roomById(def.rooms, def.rooms.start); if (start) return start.arena; }
    return getArena(def.arenaId) ?? ARENA;
  }

  /** P3D: how the stage engine reaches the rooms (who is where; carrying a player through a door). */
  private readonly roomsHost = {
    roomOf: (id: string): string | undefined => this.sim?.roomOf(id),
    sendThrough: (id: string, doorId: string): boolean => this.sim?.sendThrough(id, doorId) ?? false,
    /** P3D step 4: is (x, y) of the player's own room in that player's view (radius, line of sight, closed doors)? */
    canSee: (id: string, x: number, y: number): boolean => {
      const g = this.engine?.def.rooms, p = this.sim?.positionOf(id), rid = this.sim?.roomOf(id);
      const room = g && rid ? roomById(g, rid) : undefined;
      if (!p || !room || !this.engine) return false;
      const eye = { x: p.x, y: p.y - EYE_HEIGHT }, radius = this.radiusIn(rid!);
      if (!pointVisible(room, eye, { x, y }, this.engine.openDoorIds(), radius)) return false;
      const aim = this.coneVision ? this.sim?.aimOf(id) ?? null : null; // P3E: with the ghost option the view is the lit region; the same rule cuts refusals
      return aim === null || inLitRegion(eye, aim, { x, y }, radius);
    },
  };

  /** P3D step 4: on an escape stage each player is sent their own restricted view (never a broadcast). Other stages broadcast as before. */
  get restrictsViews(): boolean { return !!this.engine?.def.escape && !!this.engine.def.rooms; }
  /** P3E: with the ghost option on, what a player sees is cut to their lit region once their aim is known (otherwise the P3D radius). */
  private get coneVision(): boolean { return this.opts.ghost === true; }
  /** The restricted snapshot and stage state for one player (null when no escape stage is running). Spectators reuse `restrictedView`. */
  viewFor(playerId: string): RestrictedView | null {
    const e = this.engine, snapshot = this.gameSnapshot();
    if (!e || !snapshot || !e.def.escape || !e.def.rooms) return null;
    const ghosts = this.ghost?.publicGhosts();
    // P4 step 6: a dead player is a free-fly spectator. They are shown every teammate and every ghost on the stage (positions and look), wherever they are, and nothing
    // else: no items, codes, doors, safes, clues, switches or objectives, and no light to see by (they do not need one).
    if (this.death?.isDead(playerId)) {
      return restrictedView(
        { snapshot, stage: e.state(), graph: e.def.rooms, radius: 0, ...(ghosts ? { ghosts } : {}), ...(this.death ? { lives: this.livesMap() } : {}) },
        { eyes: '', self: null, spectator: true, fly: true },
      );
    }
    return restrictedView(
      { snapshot, stage: e.state(), graph: e.def.rooms, radius: this.radiusIn(this.sim?.roomOf(playerId) ?? ''), ...(ghosts ? { ghosts } : {}), ...(this.catchSys ? { hidden: this.catchSys.hiddenIds() } : {}), ...(this.death ? { lives: this.livesMap() } : {}) },
      { eyes: playerId, self: playerId, ...(this.coneVision ? { aim: this.sim?.aimOf(playerId) ?? null } : {}) },
    );
  }

  /** P3D: layouts waiting to be sent, each to ONE player. */
  private layoutQueue: { playerId: string; layout: RoomLayout }[] = [];
  /** P3D: the room graph of the current stage, if it has one. */
  private graph() { return this.engine?.def.rooms; }
  private queueLayout(playerId: string, roomId: string, withDoors = true): void {
    const g = this.graph(); const r = g && roomById(g, roomId);
    if (!r) return;
    const layout = layoutOf(r);
    // P4 step 6: a spectator is told the walls and floors of a room and nothing about its doors
    this.layoutQueue.push({ playerId, layout: withDoors ? layout : { ...layout, doors: [] } });
  }
  /** P3D: puts every player in the start room of a multi-room stage (or back on one arena) and queues the start room's layout for all. */
  private bindRooms(engine: StageEngine): void {
    this.layoutQueue = [];
    this.sim?.loadRooms(engine.def.rooms ?? null);
    if (this.sim) this.sim.touchDoors = !engine.def.escape; // an escape stage opens doors with E, not by touch
    const g = engine.def.rooms;
    if (g) for (const m of this.members.values()) this.layoutQueue.push({ playerId: m.id, layout: layoutOf(roomById(g, g.start)!) });
    this.bindGhost(engine);
  }

  /** P3E step 5: rooms whose lights a Howler broke, with the tick the lights come back. */
  private lightsOut = new Map<string, number>();
  /** The vision radius in a room: the stage's, cut to a share while a Howler's scream has broken the lights there. */
  private radiusIn(roomId: string): number {
    const base = visionRadius(this.difficulty, this.stage), until = this.lightsOut.get(roomId);
    return until !== undefined && (this.sim?.tick ?? 0) < until ? base * HOWLER_LIMITS.lightsOutShare : base;
  }
  /** Ticks of darkness left in a room (0 = lit). */
  private lightsOutLeft(roomId: string): number { return Math.max(0, (this.lightsOut.get(roomId) ?? 0) - (this.sim?.tick ?? 0)); }

  /** P3E: the ghost of this stage: only with the option on, only on an escape stage, never on stage 1, and its types and seed come from the stage. */
  private bindGhost(engine: StageEngine): void {
    this.ghost = null; this.catchSys = null; this.gun = null; this.death = null; this.spectate = null; this.reviveSys = null; this.pings = []; this.reviewLog = new ReviewLog(); this.reviewSeen = new WeakSet(); this.cueSigs = new Map(); this.reviews = new Map(); this.wipeLeft = 0; this.specLayouts = new Map(); this.lightsOut = new Map();
    this.sim?.clearFrozen();
    const graph = engine.def.rooms;
    if (this.opts.ghost !== true || !engine.def.escape || !graph || !this.sim || !ghostPresentOnStage(this.stage)) return;
    const seed = ghostSeedFor(this.stageRec?.seed ?? this.runSeed, this.stage);
    const sim = this.sim;
    const spots = (engine.def.escape.hidingSpots ?? []).map((h) => ({ id: h.id, room: h.room, x: h.x, y: h.y, kind: h.kind }));
    // P4: the death rules (one PlayerLife per player, items dropped where a player dies). Built before the catch and the ghost, which both call into it.
    const carriedOf = (id: string): CarriedItem[] =>
      (engine.state().items?.items ?? []).filter((i) => i.state === 'carried' && i.carrierId === id).map((i) => ({ itemId: i.id, kind: i.kind }));
    const deathHost: DeathHost = {
      get tick() { return sim.tick; },
      who: () => sim.senses().filter((s) => s.roomId !== null).map((s) => ({ id: s.id, name: s.name, slot: s.slot, room: s.roomId!, x: s.x, y: s.y, connected: s.connected })),
      freeze: (id, on) => sim.setFrozen(id, on),
      carried: carriedOf,
      dropOne: (id) => {
        const before = carriedOf(id);
        const left = engine.dropOneCarried(id, this.pos);
        const after = new Set(carriedOf(id).map((c) => c.itemId));
        const gone = before.find((b) => !after.has(b.itemId));
        const it = gone ? engine.state().items?.items.find((i) => i.id === gone.itemId) : undefined;
        const dropped: DroppedItem | null = gone && it ? { itemId: gone.itemId, kind: gone.kind, x: it.x, y: it.y, room: it.roomId ?? null } : null;
        return { left, dropped };
      },
      dropAll: (id) => engine.onDisconnect(id),
      leaveHiding: (id) => this.catchSys?.remove(id),
      say: (text, tone, room) => engine.announce(text, tone, room),
    };
    const death = new DeathSystem({ difficulty: this.difficulty, stage: this.stage }, deathHost);
    for (const m of this.members.keys()) death.addPlayer(m);
    this.death = death;
    this.spectate = new SpectateSystem({
      get tick() { return sim.tick; },
      roster: () => sim.senses().map((x) => ({ id: x.id, name: x.name, connected: x.connected })),
      isDead: (id) => death.isDead(id),
      isAlive: (id) => death.isAlive(id),
      rooms: () => (engine.def.rooms ? engine.def.rooms.rooms.map((r) => r.id) : [this.sim?.arena.id ?? 'arena']),
      bounds: (room) => {
        const r = engine.def.rooms?.rooms.find((x) => x.id === room);
        if (r) return { w: r.arena.width, h: r.arena.height };
        const a = this.sim?.arena;
        return a && (room === a.id || !engine.def.rooms) ? { w: a.width, h: a.height } : null;
      },
      positionOf: (id) => { const p = sim.senses().find((x) => x.id === id); return p && p.roomId ? { room: p.roomId, x: p.x, y: p.y } : null; },
    });
    this.reviveSys = new ReviveSystem({
      get tick() { return sim.tick; },
      people: () => sim.senses().filter((s) => s.roomId !== null).map((s) => ({
        id: s.id, room: s.roomId!, x: s.x, y: s.y, use: s.use, connected: s.connected, alive: death.isAlive(s.id), hidden: this.catchSys?.isHidden(s.id) ?? false,
      })),
      bodies: () => death.bodies().map((b) => ({ id: b.id, name: b.name, room: b.room, x: b.x, y: b.y })),
      carriesCell: (id) => engine.carriesKind(id, 'revive_cell'),
      spendCell: (id) => engine.spendCarried(id, 'revive_cell'),
      canRevive: (bodyId) => death.canRevive(bodyId),
      revive: (bodyId, by) => death.revive(bodyId, by),
      say: (text, tone, room) => engine.announce(text, tone, room),
      note: (kind, by, body) => {
        const t = sim.tick, nameOf = (id: string): string => this.members.get(id)?.name ?? 'A teammate';
        const [mine, theirs] = kind === 'start' ? [`Started reviving ${nameOf(body)}.`, `${nameOf(by)} started reviving you.`]
          : kind === 'stop' ? [`Stopped reviving ${nameOf(body)} before it was done.`, `${nameOf(by)} stopped reviving you before it was done.`]
          : [`Brought ${nameOf(body)} back.`, `${nameOf(by)} brought you back.`];
        this.reviewLog.add(by, 'rescue', t, mine);
        this.reviewLog.add(body, 'rescue', t, theirs);
      },
    });
    const causeOf = (ev?: GhostCatchEvent): KillCause => ({
      how: ev?.how ?? 'touch', ghost: ev?.ghost ?? 'g0', ghostKind: ev?.ghostKind ?? null, because: ev ? [...ev.because] : [],
    });
    const catchHost: CatchHost = {
      get tick() { return sim.tick; },
      who: () => sim.senses().filter((s) => s.roomId !== null).map((s) => ({ id: s.id, name: s.name, room: s.roomId!, x: s.x, y: s.y, connected: s.connected, use: s.use })),
      freeze: (id, on) => sim.setFrozen(id, on),
      kill: (id, ev) => { death.kill(id, causeOf(ev)); },
      dead: (id) => death.isDead(id),
      say: (text, tone, room) => engine.announce(text, tone, room),
      watched: (id) => this.ghost?.watching(id) ?? false,
      canSee: (id, x, y) => this.roomsHost.canSee(id, x, y),
    };
    this.catchSys = new CatchSystem(spots, catchHost);
    this.ghost = new GhostSystem(
      { stage: this.stage, seed, difficulty: this.difficulty, graph, visionRadius: visionRadius(this.difficulty, this.stage), types: ghostLineupForStage(this.stage, ghostPickFor(seed)), hidingSpots: spots },
      {
        get tick() { return sim.tick; },
        // P4: a touch must last, a kill leaves the ghost satiated, and the death rules may refuse a kill (spawn grace, protection, already dead)
        contactTicks: death.tuning.contactTicks,
        satiatedTicks: death.tuning.satiatedTicks,
        canKill: (id: string) => death.canKill(id),
        players: (): GhostPlayer[] => sim.senses().filter((s) => s.roomId !== null).map((s) => ({
          id: s.id, name: s.name, roomId: s.roomId!, x: s.x, y: s.y, connected: s.connected, moveX: s.moveX,
          crouch: s.sneak && Math.abs(s.moveX) <= 0.4, aim: s.aim, facing: s.facing,
          hidden: this.catchSys?.isHidden(s.id) ?? false, captured: death.isDead(s.id), // P4: a dead player is not a target, makes no noise
        })),
        openDoorIds: () => engine.openDoorIds(),
        onCatch: (id, ev) => this.catchSys?.capture(id, ev),
        occupantOf: (spotId) => this.catchSys?.occupantOf(spotId) ?? null,
        occupantsOf: (spotId) => this.catchSys?.occupantsOf(spotId) ?? [],
        onScream: (ev) => { this.lightsOut.set(ev.room, ev.tick + HOWLER_LIMITS.lightsOutTicks); },
      },
    );
    this.gun = this.buildGun(sim, engine);
  }
  /** P3E step 4: the Pulse Gun, built right after the ghost it stuns. */
  private buildGun(sim: GameSim, engine: StageEngine): PulseGun {
    const ghost = this.ghost!;
    const host: GunHost = {
      get tick() { return sim.tick; },
      shooter: (id) => { const s = sim.senses().find((x) => x.id === id); return s && s.roomId !== null ? { room: s.roomId, x: s.x, y: s.y, aim: s.aim, name: s.name, connected: s.connected } : undefined; },
      carries: (id) => engine.carriesKind(id, 'pulse_gun'),
      trace: (room, from, to, radius) => ghost.trace(room, from, to, radius),
      destroy: (ghostId, by) => ghost.destroy(ghostId, by),
      cooldownTicks: ghost.tuning.gunCooldownTicks,
      noise: (room, x, y, by, name) => ghost.makeNoise({ room, x, y, loud: NOISE_KIND_LOUDNESS.shot, player: by, name, kind: 'shot' }),
      say: (text, tone, room) => engine.announce(text, tone, room),
      log: (by, phase, room, text, ghostId) => ghost.logPulse(by, phase, room, text, ghostId),
      playerIds: () => sim.senses().map((s) => s.id),
      sees: (viewerId, room, x, y) => sim.roomOf(viewerId) === room && this.roomsHost.canSee(viewerId, x, y),
    };
    return new PulseGun(host);
  }
  /** P3E step 4: shots fired since the last call, each with the players who must be sent it. */
  drainShots(): ShotDelivery[] { return this.gun?.drainDeliveries() ?? []; }

  /** P3E step 5: effects (a dissolve, a scream) since the last call, each with the players who can SEE the spot. Nobody else is told where it happened. */
  drainFx(): { to: string[]; fx: GhostFx }[] {
    const g = this.ghost, sim = this.sim;
    if (!g || !sim) return [];
    return g.drainFx().map((fx) => ({ fx, to: sim.senses().filter((s) => s.connected && s.roomId === fx.room && this.roomsHost.canSee(s.id, fx.x, fx.y)).map((s) => s.id) }));
  }

  /** P3E step 3: put a released player on the floor at their room's entry (the start room's spawn slot, or the arrival point of a door into the room) and tell their client. */
  private placeAtEntry(id: string): void {
    const g = this.graph(), sim = this.sim, roomId = sim?.roomOf(id), room = g && roomId ? roomById(g, roomId) : undefined;
    const me = sim?.senses().find((s) => s.id === id);
    if (!g || !sim || !roomId || !room || !me) return;
    const door = roomId === g.start ? undefined : g.rooms.flatMap((r) => r.doors).find((d) => d.to === roomId);
    const at = door ? door.arrive : room.arena.spawns[me.slot] ?? room.arena.spawns[0]!;
    sim.placeAt(id, at.x, at.y);
    this.queueLayout(id, roomId); // the client restarts its prediction from the server's position
  }
  /** P3E: the ghost of the current stage (server side only), for tests and the next steps. */
  get ghostSystem(): GhostSystem | null { return this.ghost; }
  /** P3E step 3: hiding and the catch of the current stage (server side only), for tests. */
  get catchSystem(): CatchSystem | null { return this.catchSys; }
  /** P4: the life of every player on the current stage (server side only), for tests and the review. */
  get deathSystem(): DeathSystem | null { return this.death; }
  /** P3E: what one player can HEAR of the ghost (null when this stage has no ghost). The documented exception to the vision invariant: see shared `GHOST_CUE`. */
  ghostCue(playerId: string): GhostCue | null {
    if (!this.ghost || !this.sim) return null;
    const me = this.sim.senses().find((s) => s.id === playerId);
    const c = this.ghost.cueFor(me?.roomId ?? null, me?.x ?? 0, me?.y ?? 0);
    const kinds = c.warning ? this.ghost.warnKinds() : [];
    const dark = this.lightsOutLeft(me?.roomId ?? '');
    return {
      tick: this.sim.tick, warning: c.warning, sounds: c.sounds,
      ...(this.catchSys ? { status: this.catchSys.statusFor(playerId) } : {}),
      ...(kinds.length > 0 ? { warnKinds: kinds } : {}),
      ...(this.gun ? { gun: { left: this.gun.cooldownLeft(), total: this.ghost.tuning.gunCooldownTicks } } : {}),
      ...(dark > 0 ? { lightsOut: dark } : {}),
    };
  }
  /** P3E: ghost events logged since the last call. */
  drainGhostEvents(): GhostEvent[] { return this.ghost?.drainEvents() ?? []; }
  /** P3D: layouts to deliver (each to its player only). Empty on single-arena stages. */
  drainLayouts(): { playerId: string; layout: RoomLayout }[] { const q = this.layoutQueue; this.layoutQueue = []; return q; }

  /** Gives the stage engine the sim's physical world and loads the stage's authored props into it. */
  private bindWorld(engine: StageEngine): void {
    if (!this.sim) return;
    this.sim.configure((engine.def.props ?? []).map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, light: p.light })));
    engine.attachWorld(this.sim.world);
  }

  get size(): number { return this.members.size; }
  get connectedCount(): number { return [...this.members.values()].filter((m) => m.connected).length; }
  has(id: string): boolean { return this.members.has(id); }

  join(id: string, name: string): Result {
    if (this.phase !== 'lobby') return fail('Run already in progress');
    if (this.members.has(id)) return fail('Already in room');
    if (this.members.size >= MAX_PLAYERS) return fail('Room is full');
    this.members.set(id, { id, name, ready: false, connected: true });
    if (!this.hostId) this.hostId = id;
    return { ok: true };
  }

  leave(id: string): void {
    this.members.delete(id);
    this.sim?.removePlayer(id);
    this.engine?.removePlayer(id);
    this.catchSys?.remove(id);
    this.death?.removePlayer(id);
    this.spectate?.remove(id);
    this.reviveSys?.remove(id);
    this.reviewLog.remove(id);
    if (this.hostId === id) this.hostId = this.members.keys().next().value ?? '';
  }

  setReady(id: string, ready: boolean): Result {
    const m = this.members.get(id);
    if (!m) return fail('Not in room');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    m.ready = ready;
    return { ok: true };
  }

  setDifficulty(id: string, difficulty: Difficulty): Result {
    if (id !== this.hostId) return fail('Only the host can change difficulty');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    if (!isDifficultyUnlocked(difficulty, this.highestStage)) return fail(`${difficulty} is locked`);
    this.difficulty = difficulty;
    return { ok: true };
  }

  /** Solo players can start alone; with more players every non-host must be ready. */
  start(id: string): Result {
    if (id !== this.hostId) return fail('Only the host can start');
    if (this.phase !== 'lobby') return fail('Not in lobby');
    const notReady = [...this.members.values()].filter((m) => m.id !== this.hostId && !m.ready);
    if (notReady.length > 0) return fail('Waiting for players to ready up');
    this.phase = nextRoomPhase(this.phase, 'START');
    // Slots are fixed for the whole run (join order), so spawns and colours stay stable.
    const engine = this.buildEngine(this.stage);
    this.sim = new GameSim([...this.members.values()].map((m, slot) => ({ id: m.id, name: m.name, slot })), this.arenaOf(engine));
    this.engine = engine;
    this.bindWorld(this.engine);
    this.bindRooms(engine);
    this.briefingTicksLeft = this.briefingTicks;
    return { ok: true };
  }

  /**
   * Host-only. Uses the existing NEXT_STAGE transition (stage_complete -> briefing) and loads stage N+1.
   * Endless: there is no stage after which this is refused. Disconnected players are dropped, like on reset.
   */
  nextStage(id: string): Result {
    if (id !== this.hostId) return fail('Only the host can start the next stage');
    if (this.phase !== 'stage_complete' || !this.sim) return fail('There is no completed stage to advance from');
    for (const m of [...this.members.values()]) {
      if (!m.connected) { this.members.delete(m.id); this.sim.removePlayer(m.id); }
    }
    const next = this.stage + 1;
    const revBase = (this.engine?.state().rev ?? 0) + 1; // revisions keep increasing across stages
    const engine = this.buildEngine(next, { revBase }); // built before any mutation; N >= 2 falls back instead of throwing
    this.phase = nextRoomPhase(this.phase, 'NEXT_STAGE');
    this.attempt = 0; this.reviews = new Map(); // a new stage number: back to the first try
    this.stage = next;
    this.highestStage = Math.max(this.highestStage, next);
    this.sim.loadArena(this.arenaOf(engine)); // a stage may play on its own arena (the Lab); back to Relay Platform 01 afterwards
    this.sim.loadRooms(null); // P3D: leave any previous room chain before the new stage binds its own
    this.sim.reset(); // spawn positions, tick 0, new epoch: clients drop prediction state
    this.engine = engine;
    this.bindWorld(engine);
    this.bindRooms(engine);
    this.briefingTicksLeft = this.briefingTicks;
    return { ok: true };
  }

  /**
   * Positions the stage engine sees. P3D: a multi-room stage WITHOUT an escape spec keeps its content in the start room, so a player
   * standing elsewhere is not part of it. An escape stage has content in every room; its systems check rooms themselves.
   */
  private pos = (id: string) => {
    const sim = this.sim;
    if (sim?.contentRoom && !this.engine?.def.escape && sim.roomOf(id) !== sim.contentRoom) return undefined;
    return sim?.positionOf(id);
  };

  /**
   * P4: the positions the stage engine steps with. A dead player is inert to the stage: they are shown to it as NOT CONNECTED, so a body standing in the exit
   * zone does not clear the stage, no door opens for them, and nothing they stood on counts as a safe spot. Everyone else is as `pos` says.
   */
  private enginePos = (id: string) => {
    const p = this.pos(id);
    return p && this.death?.isDead(id) ? { ...p, connected: false } : p;
  };

  /** Advance one server tick. Briefing counts down (then BEGIN); playing steps the simulation. */
  tick(): { phaseChanged: boolean } {
    if (!this.sim) return { phaseChanged: false };
    if (this.phase === 'briefing') {
      this.briefingTicksLeft--;
      if (this.briefingTicksLeft <= 0) {
        this.briefingTicksLeft = 0;
        this.phase = nextRoomPhase(this.phase, 'BEGIN');
        return { phaseChanged: true };
      }
    } else if (this.phase === 'playing') {
      this.sim.step();
      this.engine?.step(this.enginePos);
      // P4: someone reached the exit alive on this tick: the stage is cleared and nobody can be killed on the same tick (the exit wins a tie)
      const cleared = this.engine?.status === 'stabilized';
      if (!cleared) {
        this.catchSys?.step();
        this.gun?.step();
        this.ghost?.step();
        this.death?.step();
        this.reviveSys?.step();
        this.spectate?.step();
        this.syncSpectatorLayouts();
        this.recordReview();
      }
      for (const t of this.sim.drainTransitions()) this.queueLayout(t.playerId, t.to); // each player learns the room they just entered
      if (cleared) {
        // P4 step 4: everyone, the dead included, goes on to the next stage; a team that lost nobody is paid a bonus (a revived death still counts)
        if (this.death && this.death.deaths === 0) this.engine?.grantBonus('no_deaths', DEATH_TABLE.noDeathBonus);
        this.phase = nextRoomPhase(this.phase, 'STAGE_CLEAR');
        return { phaseChanged: true };
      }
      // P4: nobody who is alive can act any more (and the dead have put their things down): the team is wiped. REVIEW and RETRY follow in step 4.
      if (this.death && this.death.noneAlive() && !this.death.dropping) {
        this.phase = nextRoomPhase(this.phase, 'TEAM_WIPE');
        this.wipeLeft = WIPE.beatTicks;
        return { phaseChanged: true };
      }
    } else if (this.phase === 'team_wiped') {
      // P4 step 4: a short beat on the wipe (the world is frozen), then the review of every death, built from the log
      this.wipeLeft--;
      if (this.wipeLeft <= 0) {
        this.wipeLeft = 0;
        this.buildReviews();
        this.phase = nextRoomPhase(this.phase, 'REVIEW');
        return { phaseChanged: true };
      }
    }
    return { phaseChanged: false };
  }

  /** Movement intent from a player. Accepted only while playing. */
  submitInput(id: string, seq: number, input: InputIntent, extra?: InputExtra): boolean {
    if (this.phase !== 'playing' || !this.sim) return false;
    const m = this.members.get(id);
    if (!m || !m.connected) return false;
    if (this.death?.isDead(id)) return false; // P4: a dead player cannot move, aim or hold anything (the body stays where it fell)
    return this.sim.queueInput(id, seq, input, extra);
  }

  /**
   * Socket dropped. In the lobby the player simply leaves (P0 behaviour). During a run the player
   * stays in the simulation, marked disconnected, so teammates see the connection state.
   */
  disconnect(id: string): void {
    const m = this.members.get(id);
    if (!m) return;
    if (this.phase === 'lobby' || !this.sim) { this.leave(id); return; }
    m.connected = false;
    this.sim.setConnected(id, false);
    this.death?.disconnect(id);
    this.engine?.onDisconnect(id);
    if (this.hostId === id) {
      const next = [...this.members.values()].find((x) => x.connected);
      if (next) this.hostId = next.id;
    }
  }

  /** Host-only: restore the known initial arena state, dropping disconnected players. */
  resetArena(id: string): Result {
    if (id !== this.hostId) return fail('Only the host can reset the arena');
    if (this.death?.isDead(id)) return fail('You are dead. You can only watch.'); // P4: a dead host cannot reset the living world
    if (this.phase !== 'playing' || !this.sim) return fail('Arena can only be reset during play');
    for (const m of [...this.members.values()]) {
      if (!m.connected) { this.members.delete(m.id); this.sim.removePlayer(m.id); }
    }
    // A fresh stage attempt; revisions keep increasing so clients never mistake it for an old state.
    const nextRev = (this.engine?.state().rev ?? 0) + 1;
    const engine = this.buildEngine(this.stage, { revBase: nextRev });
    this.sim.loadArena(this.arenaOf(engine));
    this.sim.loadRooms(null);
    this.sim.reset();
    this.engine = engine;
    this.bindWorld(this.engine);
    this.bindRooms(engine);
    return { ok: true };
  }

  /** P3E step 3: a caught or hiding player may do nothing but wait or come out. Null = free to act. */
  private blocked(id: string): string | null {
    if (this.death?.isDead(id)) return 'You are dead. You can only watch.';
    if (this.catchSys?.isHidden(id)) return 'Not while hiding. Press E to come out.';
    return null;
  }

  /** P4 step 2: a spectator is sent the layout (walls and doorways) of the room their target is in, when the target or the target's room changes. */
  private syncSpectatorLayouts(): void {
    const sp = this.spectate, sim = this.sim;
    if (!sp || !sim) return;
    for (const id of this.members.keys()) {
      const cam = sp.camOf(id);
      const key = cam ? cam.room : '';
      const was = this.specLayouts.get(id);
      if (was === key) continue;
      this.specLayouts.set(id, key);
      if (cam) this.queueLayout(id, cam.room, false); // the room the camera is in, walls only
      else if (was) { const mine = sim.roomOf(id); if (mine) this.queueLayout(id, mine); } // no longer a spectator (revived): learn the walls and doors of the room they stand in again
    }
  }

  /** P4: every player's life, for the team list (null on a stage without death). */
  private livesMap(): Map<string, PlayerLife> {
    const m = new Map<string, PlayerLife>();
    const d = this.death;
    if (d) for (const id of this.members.keys()) { const l = d.lifeOf(id); if (l) m.set(id, l); }
    return m;
  }

  /** P4 step 2: what one player is told about their life and whom they watch. Null when this stage has no death. */
  deathState(id: string): DeathState | null {
    const d = this.death, sp = this.spectate;
    if (!d || !sp || !this.sim || !d.lifeOf(id)) return null;
    const life = d.lifeOf(id)!;
    const dead = life !== 'alive';
    const body = d.bodies().find((b) => b.id === id);
    return {
      tick: this.sim.tick, life,
      following: dead ? sp.following(id) : null,
      watchable: dead ? sp.watchable(id) : [],
      pingReadyIn: dead ? sp.pingReadyIn(id) : 0,
      reviveLeft: body ? Math.max(0, body.reviveUntil - this.sim.tick) : 0,
      reviving: (() => { const w = this.reviveSys?.progress().find((x) => x.reviver === id); const b = w ? d.bodies().find((x) => x.id === w.body) : undefined; return w && b ? { id: b.id, name: b.name, progress: w.progress } : null; })(),
      beingRevived: this.reviveSys?.progress().find((x) => x.body === id)?.progress ?? null,
      ...(dead && sp.camOf(id) ? { cam: sp.camOf(id)!, rooms: this.engine?.def.rooms ? this.engine.def.rooms.rooms.map((r) => r.id) : [this.sim.arena.id] } : {}),
    };
  }

  /** P4 step 4: note what the server records around each player (the ghost's sounds and hiding checks, and the cues each player is sent). */
  private recordReview(): void {
    const g = this.ghost, d = this.death, sim = this.sim;
    if (!g || !d || !sim) return;
    const log = g.events, fresh: GhostEvent[] = [];
    for (let i = log.length - 1; i >= 0; i--) { const e = log[i]!; if (this.reviewSeen.has(e)) break; fresh.push(e); }
    for (const e of fresh.reverse()) {
      this.reviewSeen.add(e);
      if (e.kind === 'heard') this.reviewLog.add(e.player, 'noise', e.tick, e.text);
      else if (e.kind === 'inspect' && e.player && e.phase === 'found') this.reviewLog.add(e.player, 'hiding', e.tick, e.text);
    }
    for (const m of this.members.keys()) {
      if (!d.isAlive(m)) { this.cueSigs.delete(m); continue; }
      const cue = this.ghostCue(m);
      if (!cue) continue;
      const r = cueNotes(this.cueSigs.get(m) ?? null, cue);
      this.cueSigs.set(m, r.sig);
      for (const n of r.notes) this.reviewLog.add(m, 'warning', sim.tick, n);
    }
  }

  /** P4 step 4: the wipe turns into the review: each player gets THEIR OWN review (null if they did not die) and the list of who died when. */
  private buildReviews(): void {
    const d = this.death;
    this.reviews = new Map();
    if (!d) return;
    const roster = [...this.members.values()].map((m) => ({ id: m.id, name: m.name }));
    for (const m of roster) {
      this.reviews.set(m.id, buildMessage({
        stage: this.stage, attempt: this.attempt, wiped: true, viewer: m.id, roster, lifeOf: (id) => d.lifeOf(id), events: d.events, log: this.reviewLog,
      }));
    }
  }

  /** P4 step 4: the review of the last wipe, for one player only (null outside the review, or for a player who is not in the run). */
  reviewFor(id: string): DeathReviewMsg | null { return this.phase === 'death_review' ? this.reviews.get(id) ?? null : null; }

  /**
   * P4 step 4: from the review, start the SAME stage number again on a NEW seed (death_review -> briefing, the existing RETRY transition). The host does it; if the
   * host has left the run, any connected player may. Everyone returns, the dead included, alive and with empty hands (a new stage builds new players and items).
   * Disconnected players are dropped, like on the next stage. Never goes back to stage 1: the number is kept.
   */
  retryStage(id: string): Result {
    if (this.phase !== 'death_review' || !this.sim) return fail('There is no review to retry from');
    const m = this.members.get(id);
    if (!m) return fail('Not in room');
    const host = this.members.get(this.hostId);
    if (id !== this.hostId && host?.connected) return fail('Only the host can retry the stage');
    if (!m.connected) return fail('You are offline');
    for (const x of [...this.members.values()]) {
      if (!x.connected) { this.members.delete(x.id); this.sim.removePlayer(x.id); }
    }
    const before = this.attempt;
    this.attempt = before + 1;
    const revBase = (this.engine?.state().rev ?? 0) + 1;
    let engine: StageEngine;
    try { engine = this.buildEngine(this.stage, { revBase }); } catch (e) { this.attempt = before; throw e; } // built before any mutation
    this.phase = nextRoomPhase(this.phase, 'RETRY');
    this.reviews = new Map();
    this.sim.loadArena(this.arenaOf(engine));
    this.sim.loadRooms(null);
    this.sim.reset();
    this.engine = engine;
    this.bindWorld(engine);
    this.bindRooms(engine);
    this.briefingTicksLeft = this.briefingTicks;
    return { ok: true };
  }

  /** P4 step 2: a dead player picks whom to watch. */
  spectateFollow(id: string, req: SpectateFollow): { ok: true; message: string } | { ok: false; error: string } {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    if (!this.spectate) return { ok: false, error: 'You are not dead.' };
    return this.spectate.request(id, req.target);
  }

  /** P4 step 6: a dead player's camera keys. The server bounds it (speed, area, message rate); nothing else about the live world changes. */
  spectateMove(id: string, move: SpectateMove): { ok: true; message: string } | { ok: false; error: string } {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    if (!this.spectate) return { ok: false, error: 'You are not dead.' };
    return this.spectate.move(id, move);
  }

  /** P4 step 6: a dead player asks for another room of the stage. */
  spectateRoom(id: string, req: SpectateRoom): { ok: true; message: string } | { ok: false; error: string } {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    if (!this.spectate) return { ok: false, error: 'You are not dead.' };
    return this.spectate.room(id, req.room);
  }

  /** P4 step 2: "ghost here". The position is the server's: the nearest ghost in the spectator's own view. Sent to the living in that room and the other spectators. */
  spectatePing(id: string): { ok: true; message: string } | { ok: false; error: string } {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    const sp = this.spectate, d = this.death;
    if (!sp || !d) return { ok: false, error: 'You are not dead.' };
    // the ghost nearest the camera (one in the camera's room first): the position is the server's, the spectator only says "here"
    const cam = sp.camOf(id);
    const dist = (g: { room: string; x: number; y: number }): number => (cam && g.room === cam.room ? Math.hypot(g.x - cam.x, g.y - cam.y) : 1e9 + Math.hypot(g.x, g.y));
    const seen = [...(this.viewFor(id)?.snapshot.ghosts ?? [])].sort((a, b) => dist(a) - dist(b));
    const r = sp.ping(id, seen);
    if (!r.ok) return r;
    const sim = this.sim!;
    const to = sim.senses().filter((x) => x.connected && (d.isAlive(x.id) ? x.roomId === r.ping.room : d.isDead(x.id) && sp.camOf(x.id)?.room === r.ping.room)).map((x) => x.id);
    this.pings.push({ to, ping: r.ping });
    if (this.pings.length > 16) this.pings.splice(0, this.pings.length - 16);
    return { ok: true, message: 'Ghost here.' };
  }
  /** P4 step 2: pings waiting to be sent (taken once). */
  drainPings(): { to: string[]; ping: GhostPing }[] { const p = this.pings; this.pings = []; return p; }

  /** P3E step 3: hide in the hiding spot in reach, or come out. */
  ghostAction(id: string, action: GhostAction): { ok: true; message: string } | { ok: false; error: string } {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    if (!this.catchSys) return { ok: false, error: 'There is nothing to hide from here.' };
    if (this.death?.isDead(id)) return { ok: false, error: 'You are dead. You can only watch.' };
    if (action.action === 'fire') {
      const stop = this.blocked(id);
      if (stop) return { ok: false, error: stop };
      return this.gun ? this.gun.fire(id) : { ok: false, error: 'There is nothing to shoot here.' };
    }
    const r = action.action === 'hide' ? this.catchSys.hide(id) : this.catchSys.leave(id);
    // P4 step 4: the attempt is noted for the review, with what the server answered
    this.reviewLog.add(id, 'hiding', this.sim?.tick ?? 0, `${action.action === 'hide' ? 'Tried to hide' : 'Came out of hiding'}: ${r.ok ? r.message : r.error}`);
    return r;
  }

  /** A player's stage action. The engine validates range, tools, cooldowns and prerequisites. */
  stageAction(id: string, action: StageAction): ActionResult {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    const stop = this.blocked(id);
    if (stop) return { ok: false, error: stop };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    return this.engine.action(id, action, this.pos);
  }

  /** P3B: a player's reality-ability intent. The engine validates ownership, range, cooldown, energy, caps and rate. */
  abilityAction(id: string, action: AbilityAction): AbilityResult {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    const stop = this.blocked(id);
    if (stop) return { ok: false, error: stop };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    return this.engine.abilityAction(id, action, this.pos);
  }

  /** P3C: a player's salvage intent (pick up, drop, swap, hand over, install). The engine validates range, ownership, capacity, cooldown and rate. */
  /** P3D: a player's escape intent (use a door, enter a code, press a switch, read a clue). */
  escapeAction(id: string, action: EscapeAction): EscapeResult {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    const stop = this.blocked(id);
    if (stop) return { ok: false, error: stop };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    return this.engine.escapeAction(id, action, this.pos);
  }

  itemAction(id: string, action: ItemAction): ItemResult {
    if (this.phase !== 'playing' || !this.engine) return { ok: false, error: 'No stage is running.' };
    if (!this.members.has(id)) return { ok: false, error: 'You are not part of this run.' };
    const stop = this.blocked(id);
    if (stop) return { ok: false, error: stop };
    const r = this.engine.itemAction(id, action, this.pos);
    // P3E step 3: dropping a part is LOUD (a clatter the ghost may hear); picking up and handing over are not
    if (r.ok && (action.action === 'drop' || action.action === 'swap')) {
      const me = this.sim?.senses().find((s) => s.id === id);
      if (me && me.roomId) this.ghost?.makeNoise({ room: me.roomId, x: me.x, y: me.y - PLAYER_HEIGHT / 2, loud: NOISE_KIND_LOUDNESS.drop, player: id, name: me.name, kind: 'drop' });
    }
    return r;
  }

  /** Read-only view of the current public stage state (does not mark it as sent). */
  peekStageState(): StageState | null {
    return this.engine?.state() ?? null;
  }

  /** Public stage state if it changed since the last call (reliable delivery, full state). */
  consumeStageState(): StageState | null {
    return this.engine?.consumeState() ?? null;
  }

  /** Public simulation view, or null when no run is active. */
  gameSnapshot(): GameSnapshot | null {
    if (!this.sim || this.phase === 'lobby') return null;
    return this.sim.snapshot(this.phase, this.briefingTicksLeft * Math.round(1000 / SERVER_TICK_HZ), this.stage);
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      difficulty: this.difficulty,
      stage: this.stage,
      highestStage: this.highestStage,
      hostId: this.hostId,
      maxPlayers: MAX_PLAYERS,
      players: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, ready: m.ready || m.id === this.hostId, isHost: m.id === this.hostId,
      })),
      ...(this.isLab ? { lab: true } : {}),
    };
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private readonly opts: { briefingTicks?: number; huntStage?: boolean } = {}) {}

  create(opts: { lab?: boolean; hunt?: boolean; rooms?: boolean | 2; escape?: boolean; ghost?: boolean; startStage?: number } = {}): Room {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.opts.briefingTicks, randomInt(0x7fffffff), { hunt: this.opts.huntStage === true, ...opts });
    this.rooms.set(code, room);
    return room;
  }
  get(code: string): Room | undefined { return this.rooms.get(code); }
  remove(code: string): void { this.rooms.delete(code); }
  get count(): number { return this.rooms.size; }
  forEach(cb: (room: Room) => void): void { for (const r of [...this.rooms.values()]) cb(r); }
}
