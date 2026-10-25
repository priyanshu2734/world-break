# WORLD//BREAK: THE REALITY RELAY: Architecture & Milestones

## Layout
npm workspaces monorepo. `@wb/shared` is consumed as TypeScript source by both sides.

    packages/shared   Zod schemas, protocol types, state machines, difficulty rules (no I/O)
    packages/server   Authoritative Node + Socket.IO server (Room logic is socket-free and unit-testable)
    packages/client   Phaser 3 + Vite renderer/input. Sends intents, renders server snapshots

## Principles
- Server owns all state. Clients send *intents*; the server validates (Zod), applies, broadcasts.
- Snapshots are public-only. Scenario solutions and the OpenAI key stay server-side.
- AI output is data only: Zod-parsed, then checked by a deterministic solver/validator before launch.
  On any failure -> tested deterministic fallback scenario.
- Explicit state machines (`RoomPhase`, `PlayerLife`) with illegal transitions throwing.

## Milestones
- [x] P0 Foundation: monorepo, contracts, state machines, lobby (1-4 players), difficulty gating
- [x] P1 Playable core: fixed-timestep sim @20Hz, movement, interpolation, one hand-authored arena, 1-4 players (see docs/P1_HANDOFF.md)
- [x] P2 Systems graph: breakpoints, failure chains, tools, repair progress, timers, scoring (server-side). Verified as per docs/handoffs/P2.md (200 unit/integration tests, build, and an automated real-browser run of the full repair chain; NOT yet verified by a human playtest or on a real GPU)
- [~] P3 Abilities + disasters. P3A done (endless loop, disasters, seeding; docs/handoffs/P3A.md). P3B done (reality abilities, shared-step physics migration, Ability Lab; docs/ABILITIES.md, docs/handoffs/P3B.md). P3C (salvage, carrying, requirements, a real stage 1 behind the opt-in hunt option) is delivered except generator items (docs/SALVAGE.md, docs/handoffs/P3C.md; see the P3C section below).
- [ ] P4 Downed/revive/spectate, team wipe, death review, retry with new scenario
- [ ] P5 Scenario generator + validator + fallback; then OpenAI integration (structured outputs, timeouts, retries)
- [ ] P6 Persistence (stage progression, unlock 10/20, rewards), difficulty select per stage
- [ ] P7 Visual/audio polish, HUD, hazard warnings; Playwright E2E (multi-context), load/soak tests

## Initial risks
1. Netcode feel (latency, interpolation): mitigate with fixed ticks, snapshot interpolation, client-side prediction only for own movement.
2. Solvability of generated scenarios: must be provable by a deterministic solver, not by prompt trust.
3. Scope: strict phase gating; each phase must ship playable.
4. Bundle size (Phaser ~1.5 MB): acceptable now; revisit code-splitting in P7.
5. No OpenAI key in dev/CI: fallback path is the default-tested path; live API calls need a key and are not yet verified.

## P2 systems architecture (current)
    shared/src/systems/tools.ts     tool + hazard vocabulary, TOOL_SPECS, range/gap constants (public, rules enforced by server)
    shared/src/systems/schemas.ts   StageActionSchema (intents) and StageStateSchema (public projection)
    server/src/systems/stageDef.ts  PRIVATE authoring schema (hidden failure chain). Never import from the client
    server/src/systems/failures.ts  failure dependency graph + mitigation (active / mitigated / resolved)
    server/src/systems/power.ts     power routing + generator capacity
    server/src/systems/validate.ts  deterministic stage validation (must pass before a stage can launch)
    server/src/systems/engine.ts    StageEngine: tools, channels, objectives, hazards, timers, scoring, public state
    server/src/systems/tutorial.ts  the hand-authored tutorial stage ("Cold Start"); registry.ts maps stage number -> def
    client/src/ui/                  StageView (world overlay), StageHud, targeting.ts (convenience picking only)

Flow: client sends `stage:action` intent -> gateway Zod-validates -> `Room.stageAction` -> `StageEngine.action` validates
membership, rate limit, range, ownership, charges, cooldown, compatibility, prerequisites. The engine steps once per
simulation tick after `GameSim.step()`. Public state is published as `stage:state` (reliable, full, only when changed).
Completion triggers the existing `STAGE_CLEAR` room transition.

## P3A architecture: endless loop, disasters, seeding (current)
    shared/src/disasters/rng.ts        mulberry32 PRNG, deriveSeed (FNV-1a), forkable Rng. No Math.random / Date.now in authoritative code
    shared/src/disasters/lifecycle.ts  disaster phase machine: WARNING > ACTIVE > ESCALATED > RESOLVED | FAILED > CLEANUP
    shared/src/disasters/public.ts     DisasterId, DisasterThreat, DisasterPublic (optional StageState.disaster)
    server/src/disasters/meta.ts       PRIVATE DisasterMeta carried in StageDef.disaster (schedule, messages, threats, hazard phases, heat)
    server/src/disasters/runtime.ts    DisasterRuntime: pure, tick-driven; hazardMod(); bounded heat drain; finish() forces CLEANUP
    server/src/disasters/validate.ts   DISASTER_LIMITS + validateDisasterMeta (called from validateStageDef)
    server/src/disasters/framework.ts  defineDisaster<P>: params schema + deriveParams + generate
    server/src/disasters/kit.ts        shared generator parts (mirror, spots, timing, grids, controls)
    server/src/disasters/<id>.ts       one generator per disaster (reactorOverload, gravityInversion, realityFracture, temporalStorm, cascadingPowerFailure)
    server/src/disasters/registry.ts   SUPPORTED (all five, selectable) vs CANDIDATES (empty gate for future disasters); generateDisasterStage(stage, seed)
    server/src/disasters/{generate,fallback}.ts  stage N >= 2 entry point; tested tutorial clone if generation or validation fails
    client/src/ui/disasterText.ts      HUD lines + incoming-hazard marker from the public disaster state

Endless loop: `room:nextStage` (host only, after `stage_complete`) reuses the existing `NEXT_STAGE` transition. The Room derives
`stage seed = deriveSeed(runSeed, 'stage', stage)` (run seed is server-only), builds the engine from `getStageDef(stage, seed)` and records
`StageRecord { stage, seed, defId, fallback }` server-side. Stage 1 is the hand-authored tutorial; every later stage is generated. There is no final stage.

Engine step order is now: expiries > hazards > channels > objectives > **disaster** > deadline. `hazardArmed` consults `DisasterRuntime.hazardMod`;
effects are a pure function of the phase, so CLEANUP removes them; a stabilised stage is cleaned up in the same tick. FAILED is a soft failure
(bounded penalty, stage still completable; hard failure is P4). See `docs/DISASTERS.md` for the lifecycle table, fairness limits and each disaster,
and `docs/handoffs/P3A.md` for the contract list, what was verified and what was NOT RUN. All five disasters are supported (maintainer-confirmed tests);
the game picks one by seed for every stage N >= 2.

## Ownership boundaries for P3 (disaster library)
P3 may add `shared/src/disasters/**`, `server/src/disasters/**` and new stages in `server/src/systems/registry.ts`.
Additive-only edits: `stageDef.ts`, `engine.ts` (hooks), `tools.ts`, `schemas.ts`, `protocol.ts`, `room.ts`, `gateway.ts`, client `ui/**`, `GameScene.ts`.
Frozen unless a documented migration updates server AND client prediction together: `shared/src/sim.ts`, `shared/src/arena.ts`.
Frozen: `phases.ts`, `difficulty.ts`, `loop.ts`, `prediction.ts`, `interpolation.ts`, `tutorial.ts` (add new stages instead), all existing tests.
Do not start OpenAI integration (P5), persistence (P6) or death review (P4).

## P3B ability framework (current)
Full rules and the limits table: `docs/ABILITIES.md`. How the pieces fit:

    key 6-9 -> ui/abilityView.buildAbilityAction (aim; convenience only) -> Session.abilityUse -> 'ability:use'
      -> gateway (Zod: AbilityActionSchema) -> Room.abilityAction -> StageEngine.abilityAction -> AbilitySystem.use
      -> PhysicsWorld.addZone / addImpulse / impulseProp / freezeProp / addClone      (or the engine's frozen-hazard timer)
      -> applied by the next GameSim.step; published as GameSnapshot.world and StageState.abilities

* **Tick order** (`Room.tick`, phase playing): `GameSim.step()` (each body with `worldForTick(...)`, then `PhysicsWorld.step()`: props,
  expiry of clones, zones and impulses, then the clock) and then `StageEngine.step(pos)` (frozen-hazard thaw, `AbilitySystem.step`,
  plates, hazards, channels, objectives).
* **Who owns what.** `GameSim` owns the `PhysicsWorld` (zones, impulses, props; `GameSim.configure` loads the stage's props,
  `GameSim.loadArena` swaps arena). `StageEngine` owns the `AbilitySystem` (energy, cooldowns, caps, rules), created only when
  `StageDef.abilities` exists, and reaches the world through `engine.attachWorld(world)`, which `Room.bindWorld` calls after every build.
  Energy therefore resets with the engine: every stage start and every arena reset.
* **Engine hooks (all additive):** `abilityAction`, `attachWorld`, `frozenHazards` (arc pulse countdown pauses while frozen),
  `anchorPlacementError` (Anchor rules), `platesPressed` / `stepPlates`, `AbilitySystem.onRepair` from breakpoint and conduit repairs.
* **Server-side validation lives in one place:** `server/src/abilities/system.ts` (enabled, rate, cooldown, energy, target, range,
  ownership, caps) plus Zod at the gateway. The client never decides an outcome.
* **Default stage economy:** `server/src/abilities/defaults.ts` (`ABILITIES_IN_ROTATION`, `withDefaultAbilities`): stage 2 and up get
  every ability, the tutorial none, a stage that declares its own `abilities` keeps them.
* **Client:** `ui/AbilityHud` (energy bar, five slots), `ui/WorldView` (props, copies, frozen overlay, gravity zones), `ui/abilityView`
  (slot status and aiming, unit-tested), `GameScene` (keys 6-9, Shift, mouse aim).
* **Tests:** `server/test/abilities/*`, `server/test/gateway.ability.test.ts`, `server/test/gateway.lab.test.ts`,
  `shared/test/abilities.test.ts`, `client/test/abilityView.test.ts`.

## P3B physics migration (shared step, additive)
`shared/src/sim.ts` is shared by the server (authoritative) and client prediction. P3B changed it ONLY additively:

    stepBody(body, input, arena = ARENA, world?: StepWorld)      // new optional 4th parameter
    StepWorld = { zones?: StepZone[]; impulse?: { dvy, cancelVy, driftVx } }   // data for THIS tick only

* **Default is untouched.** With `world` undefined, `{}`, empty zones or a zero impulse the arithmetic is the pre-P3B step.
  `shared/test/sim.baseline.test.ts` proves it against a frozen copy of the old function (`test/helpers/simBaseline.ts`):
  40 bodies x 1500 ticks x 5 "empty" world shapes, every field equal (`Object.is`) on every tick. Never edit that copy.
* **Gravity zones are data**, not state: `GravityZone { id, ownerId, x, y, w, h, gx, gy, startTick, expiresTick }`. A zone is active for
  `startTick <= tick < expiresTick`; the body is inside it if its CENTRE (x, y - 22) is in the rectangle at the start of a sub-step.
  `gy` replaces gravity; `gx` is a lateral wind of `gx * 0.1 s` (walking overwrites `vx` every sub-step). Flipped gravity is capped at
  `-TERMINAL_VELOCITY`.
* **Momentum is data**, not state: `ImpulseEvent { id, tick, playerId, dvx, dvy, cancel, driftTicks }`. `dvy` and `cancel` apply once at
  `tick`; `dvx` is a drift velocity that fades linearly to 0 over `driftTicks` (it is a function of `tick - event.tick`, so `PlayerBody`
  gained no field). Impulses are bounded (`MOMENTUM_IMPULSE`) per axis.
* **One pure bridge for both sides:** `worldForTick(worldData, tick, playerId) -> StepWorld | undefined` (`shared/src/abilities/world.ts`).
  The server calls it from `PhysicsWorld.forPlayer` (inside `GameSim.step`), the client from `LocalPredictor`.
* **Publication:** `GameSnapshot.world?: { zones, impulses, props }` (optional; absent when empty, so pre-P3B snapshots are byte-identical).
  Expired zones and impulses stay listed for 40 ticks so a client replaying recent inputs still sees them.
* **Prediction:** `LocalPredictor.start/reconcile` take an optional `PredictionWorldCtx { tick, playerId, world }`. `tick` is the snapshot's
  tick = the NEXT tick the server simulates, so the i-th unacknowledged input replays at `tick + i`, exactly when the server applies it.
  Omit the context and the predictor is the pre-P3B predictor (all existing prediction tests pass unchanged).
* **What can still differ:** events created after a snapshot (a zone opened by a teammate) are unknown to the client until the next
  snapshot; the server wins and the reconcile corrects it. Snapshots round to 0.01 px, so a body hovering exactly on a zone edge can
  differ by one sub-step (a few px, far below `SNAP_DISTANCE`).
* **Tests:** `shared/test/{sim.baseline,sim.world}.test.ts` (differential oracle, zone/impulse behaviour, fuzz: finite, in bounds, never
  inside a solid), `server/test/abilities/parity.test.ts` (server `GameSim` vs client `LocalPredictor`: bit-for-bit lockstep over 2500
  ticks of random input and random zones/impulses, and a latency + reconcile scenario), `server/test/abilities/physics.room.test.ts`.

## P3B pressure plates, props and the Ability Lab (current)
* **Props** (`PhysicsWorld`, `server/src/abilities/world.ts`): crates are server-simulated (gravity, zones, friction, solids, arena
  bounds), never collide with players or each other, and are published in `GameSnapshot.world.props` (clients ease toward them; no
  prediction). Hard cap: `MAX_PROPS_TOTAL` (12) alive per room, clones included. Clones expire (`ABILITY_SPECS.duplicate.durationTicks`).
* **Pressure plates** are an entity kind (`pressure_plate`) used as the controls of the EXISTING `timed_controls` objective. Each tick a
  plate is pressed it re-arms itself for one tick, so a plate objective needs `armTicks: 1` ("all plates pressed at the same moment").
  `activatedBy: 'any'` is pressed by a player standing on it (feet within 3 px of its surface, centre within 24 px) or a resting prop;
  `'object'` (a heavy plate) only by a RESTING prop. A prop in flight never presses a plate. The objective latches once complete.
  No new objective kind was added, so exhaustive switches in older code and test helpers are untouched.
* **Per-stage arena.** `StageDef.arenaId` now selects the arena through `getArena(id)` (`shared/src/abilities/labArena.ts`; an unregistered id is a
  validation error, `arena mismatch`). `Room` builds the `GameSim` and the `StageEngine` for the stage's arena, `GameSim.loadArena` swaps it between
  stages and resets the world. `GameSnapshot.arenaId` already told clients which arena; `GameScene` redraws the platforms and
  `LocalPredictor.setArena` predicts against it when it changes.
* **Ability Lab** (`server/src/systems/stages/abilityLab.ts`, arena `ability-lab-01`): stage 1 of a room created with the dev flag, never
  returned by the stage registry (tested for stages 1..80 over several seeds). Open it with `ABILITY_LAB=1` on the server and `/?lab=1` in the
  browser (details in `docs/ABILITIES.md` section 8 and `docs/handoffs/P3B.md`).
* **Freeze substitutes the shield** in the validator only when the loadout has no Shield Projector, Freeze is enabled, and the channel
  fits inside one freeze with 10 ticks of slack (`FREEZE_CHANNEL_SLACK_TICKS`). Every other stage validates exactly as before.

## Ownership boundaries after P3B
Unchanged rules from P3 still hold. P3B's files: `shared/src/abilities/**`, `server/src/abilities/**`, `server/src/systems/stages/**`,
`client/src/ui/{AbilityHud,WorldView,abilityView}.ts`, `client/src/net/labParam.ts`. `sim.ts` changed only by the documented additive migration
above (optional 4th parameter, guarded by a bit-exact differential test against a frozen copy of the P2 step); `prediction.ts` only gained the
optional `PredictionWorldCtx` and `setArena`; `arena.ts` was not touched. `phases.ts`, `difficulty.ts`, `loop.ts` and every pre-P3B test were not touched.

## P3C salvage (complete except generator items; see docs/handoffs/P3C.md)
Rules, limits, keys and how to play the hunt are in `docs/SALVAGE.md`; the support status of each feature is in `docs/handoffs/P3C.md`. Pieces (all additive):

    shared/src/salvage/specs.ts      ItemKind, ITEM_KIND_SPECS (label, default slots), ITEM_LIMITS (the single source of truth for every limit)
    shared/src/salvage/public.ts     ItemActionSchema (intents), ItemsPublicSchema (optional StageState.items)
    server/src/salvage/rest.ts       restY / surfaceBelow / hasFooting: items rest on platforms, computed from the arena (no physics)
    server/src/salvage/system.ts     ItemSystem: pick up, drop, swap, hand over, install; carry slots; last-safe-position drop on disconnect
    server/src/systems/stageDef.ts   StageDef.items (ItemDef) and StageDef.needs (NeedDef), both optional
    server/src/systems/engine.ts     itemAction(), itemHost(), items.step(pos); StageState.items published when the stage has items
    server/src/systems/validate.ts   structural item/needs checks (ids, platform, fall limit, counts, genuine supply per need)

Flow: client sends `item:action` -> gateway Zod (`ItemActionSchema`, error `Invalid item request`) -> `Room.itemAction` -> `StageEngine.itemAction` -> `ItemSystem.use`.
Order of checks: known player > busy channelling > rate limit (`minGapTicks`, advances on refusals too) > action rules. Nothing changes on a refusal.
Item life states: `hidden | in_world | carried | installed | consumed | destroyed`. Only `in_world`, `carried` and `installed` are ever published;
a hidden, consumed, destroyed or nonexistent id gets the SAME refusal text in every action (`NOTHING_THERE`, `NOT_CARRYING`, `NO_INSTALL_TARGET`).
The decoy flag and the hidden rule are server-private. `StageDef.needs` maps a target id (breakpoint, conduit or entity) to the kinds that must be installed.

### P3C step 2 (requirements, hiding, decoys, hazards, validator)
    server/src/salvage/reach.ts      platformGraph / reachableFrom: which platforms ONE player can reach unaided, computed with the REAL stepBody physics
    server/src/salvage/validate.ts   validateSalvage (called from validateStageDef): hiding rules, ability gates, solo-safe supply, trip bound

* **Hiding.** `ItemDef.hidden = { container, reveal: 'scan' | 'interact', stashId? }`. `scan`: the Phase Scanner reveals the part when used within its radius
  (`ItemSystem.revealByScan`, called from the engine's scanner branch; message `The scan turned up hidden parts.` when nothing else was found).
  `interact`: the part sits in a visible **stash** (`StageDef.stashes`, published as `items.stashes`, empty stashes look identical) and `item:action { action: 'open', stashId }`
  reveals it. The open intent names a stash, never an item, so hidden parts have no id a client could probe; an unknown stash id gets `NOTHING_THERE`.
  `ItemDef.gate` marks a spot that needs a P3B ability (`gravity_well | freeze | duplicate | momentum`); the validator requires the stage to enable it AND the spot to be unreachable on foot.
* **Requirements (`StageDef.needs`, by target id).** Published as `items.needs` only for DISCOVERED targets: the team has stood within `needsRevealRange` of a visible target
  (an unrevealed breakpoint never qualifies). Shape by clarity (`Engine opts.difficulty`, passed by `Room.buildEngine`): easy = part names + tools + the author's hint line;
  intermediate = silhouettes (`small | heavy`), tools, no hint; hardcore = nothing until a first attempt on the target (a refused repair or an install), then silhouettes and no tools.
  Installed parts are shown by name at every clarity.
* **Gating.** A target with unmet needs refuses the Flux Welder (before any charge is spent) and `interact` on its entity (console, switch, cache): `ItemSystem.gateMessage`
  (text by clarity, and the refusal counts as "tried"). Gates run only AFTER the existing visibility and range checks, so unrevealed and nonexistent targets still give identical answers.
  Objective requirements are expressed on the objective's console/breakpoint (there is no separate objective-level gate).
* **Decoys.** A decoy of the right kind shatters on install, costs `scoring.wrongTargetPenalty` (`wrong_part`) and is gone; the need stays unmet. `ItemDef.tell` (decoys only) publishes `cracked: true`
  (not in hardcore); a decoy without a tell is indistinguishable until installed.
* **Hazards.** An unshielded arc discharge hit destroys at most ONE carried part (the last picked up) and the player is safe for `hazardGraceTicks` (100) afterwards; installed parts are immune.
  The pulse is telegraphed by the hazard's public `nextPulseTick`.
* **Validator (`validateSalvage`).** One player, spawn 0: every part and target must lie on a platform reachable on foot (real physics) or carry a declared, enabled gate; every mandatory need must be matched to a
  DISTINCT genuine (non-decoy) part that is revealable and can be carried from its platform to the target (bipartite matching, so one part never serves two demands); the 2-slot limit is respected by trips
  (installs persist: a heavy part is one trip, two light parts share one; at most `maxTripsPerStage`). Hazards, crates and timing are NOT modelled: authored stages are additionally proven with the real-physics bot (step 3).
  Needs may list only `flux_welder`, only on breakpoints or conduits.

* **Stage 1 hunt (step 3).** `systems/stages/hunt.ts` (`salvage_hunt`, copied by value from the tutorial, which is not edited): the Welder needs a Flux Coil on the coupling, the only genuine coil is hidden
  in a locker (E opens it), one visible coil is cracked (decoy with a `tell`), breaker 2 needs a Fuse, and a spare Battery nothing needs competes for the two hands. It is an OPT-IN mapping:
  `getStageDef(stage, seed, { hunt: true })` / `HUNT_REGISTRY`, `new Room(..., { hunt: true })`, `RoomManager({ huntStage })`, `createGameServer({ huntStage })` and env `HUNT_STAGE`
  (`main.ts`: on unless `HUNT_STAGE=0`). Without the option stage 1 is still the tutorial, so the older tests are unchanged. Stage 2+ are generated as before (endless).
* **Client (step 3).** `ui/itemView.ts` is the pure view-model (carry slots, "Needs: ..." prompts, tones and shapes, key -> intent, hand-over feedback); `ItemHud`, `ItemMarkers` and `itemDraw` only draw it.
  Keys: E pick up / open (else use), G drop or swap (Shift = older part), F fit a part, H hand over. Colours: red danger/cracked, cyan interactive, amber closed stash, green installed. Parts differ by shape.

Not implemented: generator items (item 7 of the P3C prompt): no generated stage (stage 2 and later) has parts, needs or stashes, and `StageState.items` is absent there.
Not covered by automation: the Phaser drawing and key wiring (`ItemHud`, `ItemMarkers`, `itemDraw`, `GameScene`); only the pure view-model `itemView.ts` is unit-tested.
Ownership: `server/src/salvage/**`, `shared/src/salvage/**` and `client/src/ui/{itemView,itemDraw,ItemHud,ItemMarkers}.ts` belong to P3C; later phases extend them additively.

## P3D rooms (steps 1, 1B, 2, 3, 4 and 5 done: see docs/handoffs/P3D.md when written)

* **Darkness (steps 1, 1B).** `shared/src/rooms/ambient.ts` is the ambient table (a stage and mode value, never a player setting). A stage def with `dark: true` publishes `StageState.darkness.ambient`
  (optional, additive). The client (`ui/Darkness.ts`, `ui/darkParam.ts`) draws a screen-fixed dark layer with a radius light and a flashlight cone, clips depth 5 to 9 world objects to the light with a geometry
  mask, and offers an in-light accessibility assist (key V). `?dark=1&dev=1` keeps the old spike keys. This is presentation only: server-side hiding is step 4.
* **Rooms (step 2).** `shared/src/rooms/**`: `RoomGraph` (rooms, each with its own `Arena` and doors), `validateRoomGraph`, `bodyInDoor`/`doorAt`, `layoutOf`, `ROOM_LIMITS` and the schemas. A stage def may carry
  `rooms` (optional). **A room id is its arena id**, so ids must be unique per stage. Until step 3 the stage's content (items, entities) lives in the START room; a player in another room is not part of the
  engine's world (`Room.pos` returns undefined, so every action from there is refused as "not part of this run").
* **Server.** `GameSim.loadRooms(graph | null)` gives each player a `roomId`; `step()` runs `stepBody` against THAT player's room arena (the P3B physical world stays with the start room), then `passDoors`: a body
  overlapping a door of its room moves to the door's `arrive` point in the target room (cooldown `doorCooldownTicks` = 4). `doorGate(doorId, playerId)` is the hook step 3 plugs locks into. `drainTransitions()`
  reports passages. `Room` queues one `room:layout` per player at stage start/reset and on every transition (`drainLayouts`); the gateway emits each to that player's socket only (never broadcast).
  `GamePlayer.roomId` is optional and written only on room stages (single-arena snapshots are byte-identical to before).
* **Client.** `Session.layouts` keeps the layouts the server sent. `GameScene` simulates the local player in `pickArena(me.roomId, ...)`; on a room change it stops the predictor, switches arena and restarts it from the
  server position. The camera follows the player (`ui/roomMath.cameraScroll`); HUD objects (depth 90+) are pinned to the screen; the dark layer takes the scroll. Players in other rooms are hidden (different
  coordinates); stage world art is drawn only in the content room. `ui/DoorView.ts` draws the doorways.
* **Dev entry.** `/?rooms=1` creates a room whose stage 1 is `server/src/rooms/demoStage.ts` (3 rooms, dark, hunt content in room 0). It needs the server env `ESCAPE_STAGES` not `0` (default on in `main.ts`);
  `createGameServer({ escapeStages })` defaults to off, so every existing test is unchanged.

### P3D migration: arena-per-stage to arena-per-room (additive)

The P3B Ability Lab swaps ONE arena for a whole stage (`GameSim.loadArena`, `getArena(id)`, `LocalPredictor.setArena`). Rooms generalise that without touching the shared movement code:

| Piece | What changed | Default behaviour |
|---|---|---|
| `shared/src/sim.ts` (`stepBody`) | nothing: it already took the arena as a parameter | identical |
| `shared/src/arena.ts` | nothing | identical |
| `client/src/sim/prediction.ts` | nothing: `setArena` + `stop()` + `start()` is the room-change sequence | identical |
| `GameSim` | optional `loadRooms`, per-player `roomId`, `passDoors`, `doorGate`, `drainTransitions`; `loadRooms(null)` restores single-arena mode | no rooms loaded = old code path |
| `GamePlayerSchema` | optional `roomId` | absent on single-arena stages |
| protocol | event `room:layout` (per player), optional join flag `rooms` | never sent without a room graph |
| `StageDef` | optional `dark`, `rooms` | absent on every existing stage |

Rule for later phases: never read a position or an arena without the player's room. Anything keyed by an arena (items, entities, hazards, props) is, from step 3, keyed by room id too.
Parity is proven by `server/test/rooms/sim.test.ts` (server step equals `stepBody` on the room arena across a door passage) and `client/test/rooms.test.ts` (the predictor equals `stepBody` on a room arena, reconciles with no correction, and restarts cleanly after a door).

### P3D step 3: doors, locks, exit, clear rule

* **Doors open with E, not by touching.** On an escape stage (`StageDef.escape` present) `GameSim.touchDoors` is false. `use_door` (event `escape:action`) starts a 0.5 s opening delay (`ESCAPE_LIMITS.doorDelayTicks`); the runtime then calls
  `GameSim.sendThrough(player, doorId)`, which is the same move as the step 2 touch passage. Drifting more than 60 px away cancels it. An opened door stays open for everybody.
* **`server/src/rooms/escape.ts` (`EscapeRuntime`)** owns doors, keypads, safes, clues, switches and the exit. The engine builds it from `def.escape` and `def.rooms` and reaches the rooms only through `EscapeHost`
  (roomOf, sendThrough, say, award, markDirty, clear), so it is unit-testable. Every intent checks, in order: player in the run > rate limit (4 ticks, accepted and refused alike) > same room and reach > the rule of the intent.
  Anything nonexistent, hidden or in another room answers `Nothing there.` (byte-identical); only a thing you can see answers `Too far away.`
* **Lock types** (`server/src/rooms/escapeSpec.ts`, one per physical door, shared by both sides): `key_item` (an `access_key` part is consumed), `power` (a `battery` part is consumed), `code` (4-digit keypad, clue digits spell the code),
  `two_person` (two switches lit together; a lit switch holds 6 s so one player can run between them), `safe` (the door needs a key that lies in a safe opened with a 3-digit combination spelled by its clues).
  Wrong tries: 3 on a keypad or safe, then a 5 s lockout (the end of the lockout is published too), so brute force is bounded. A refusal on a locked door says WHAT is missing (`needText`), never where.
* **P3C reuse.** Keys and batteries are ordinary P3C parts: 2 hand slots, hidden in stashes (`interact` reveal), decoys (a cracked key or battery is destroyed by the lock and costs the wrong-part penalty). `ItemSystem` gained optional room
  support: `ItemDef.room`/`StashDef.room` (default: the start room), `opts.arenaOf`, `host.roomOf`; a part is reachable only from its own room; dropped parts rest in the dropper's room; `consumeCarried(player, kind)` is what a lock takes.
  Single-arena stages pass none of this and behave as before (all 124 salvage tests unchanged). The P3C `NeedDef` repair-target model is not used: doors are not repair targets.
* **Exit and clear rule (GAMEPLAY.md section 3).** The exit is a 60x100 zone on a floor. Each tick the runtime checks every connected player in the exit room; the first one inside calls `StageEngine.clearStage()`, which sets
  `status = 'stabilized'` and pays the same time bonus an objective clear pays. `Room.tick` already turns `stabilized` into the existing STAGE_CLEAR phase transition (`phases.ts` is untouched), and `room.nextStage` resets
  every player (including those who never left room 0) onto the next stage. `StageDef.objectives` may now be empty, but only with an `escape` spec (`validateStageDef` enforces it).
* **Validation.** `server/src/rooms/escapeValidate.ts` proves structurally that every lock can be opened by one player from its near side of the door: keys/batteries/keypads/safes/clues/switches lie on the near side, clue digits spell
  the code, counts of parts cover the locks that need them, two-person switches are one room and one run apart, every door has exactly one lock, no two neighbouring doors share a lock type, every object stands on a solid.
  Physical reachability by real physics is shown by `server/test/rooms/bot.ts` (look-ahead with `stepBody`) in `escape.test.ts`; step 5 turns that into the generic solvability bot.
* **Client.** `ui/escapeUse.ts` (pure: what is in reach, prompts, code entry, per-room state), `ui/EscapeView.ts` (keypads, safes, clues, switches, exit, the E prompt, the NOTES panel), `ui/CodePad.ts` (typing a code), `ui/DoorView.ts`
  (red = locked, green = open). E picks up or opens parts first, then acts on the nearest door/keypad/safe/clue/switch. Clue text goes to the reader only (`EscapeAck.note`, kept in `Session.notes`), never in the public state.
* **Public state** (`StageState.escape`, optional): doors (open, and the requirement only after somebody tried), keypads, safes, clues (position and label only), switches, exit. Step 4 filters this per player by vision;
  until then a modified client can see where everything is (not any code or clue text).
* **Dev stages.** `/?rooms=1`: 3 rooms, key then code. `/?rooms=2`: 6 rooms, key, code, power, two-person, safe (`server/src/rooms/demoStage.ts`). Both need ESCAPE_STAGES not `0`.

### P3D step 4: server-side visibility and the minimal HUD

* **One rule of "in view"** (`shared/src/rooms/vision.ts`): a point is in view when it is in the viewer's own room, within `visionRadius(difficulty, stage)` of their eye (feet + 28 px), and the straight line from the eye crosses no solid and no CLOSED door
  (`segmentHitsBox`, `occluders`, `pointVisible`). Rooms never see into each other. `POINT_HEIGHT` fixes the height each kind of thing is seen at. The radius is a stage and mode parameter like the ambient: Easy 460 px at stage 1,
  Intermediate 430, Hardcore 400, minus 1 px per stage, floors 340/320/300. The client draws its flashlight exactly that far (`lightGeometry(..., reach)`), capped at the radius even with the accessibility assist.
* **What is sent** (`server/src/rooms/view.ts`, `restrictedView(source, viewer)`). On an escape stage nothing is broadcast any more: the gateway sends each socket its own `game:snapshot` and `stage:state`
  (`Room.restrictsViews`, `Room.viewFor`). A view contains: the players in view (positions only), `GameSnapshot.team` (every teammate's name, slot and connection, for the team panel), the parts and containers in view, the player's OWN hands
  (`items.players` and carried parts: a teammate's inventory is never sent), the keypads, safes, notes, switches, doors and exit in view, and feed messages from the player's own room. Everything else is not in the message at all, so a modified client has nothing to read.
  The stage state is re-sent to a player whenever THEIR view changes (they moved and something came into or left view), compared without `tick`/`rev`; `rev` is kept strictly rising per player. Non-escape stages broadcast exactly as before.
* **Spectator-ready.** `Viewer = { eyes, self }`: `eyes` is whose position and line of sight the view is cut from, `self` whose hands are shown (null = nobody's). P4 spectating a teammate is `restrictedView(src, { eyes: teammateId, self: null })`; unknown eyes see no objects at all.
* **Refusals.** A part, container, keypad, safe, note or switch that is out of view (hidden, in another room, or just beyond the radius or behind a platform) is refused with the SAME words as one that does not exist (`Nothing there.`);
  only a visible thing out of reach says `Too far away.` (`ItemHost.canSee`, `EscapeHost.canSee`; doors are always known from the room layout, so they are exempt). Probing ids therefore teaches nothing.
* **Feed.** `FeedEntry.room` (optional) tags events that happened in one room; players elsewhere are not told ("The key turns..." is only for the room where it turned).
* **Minimal HUD (client).** On an escape stage `StageHud` hides the objectives/symptoms panel and the tool bar, the ability bar is not updated, the keys line is `ESCAPE_KEYS_HINT` (GAMEPLAY.md section 11, Q and Tab marked soon), `EscapeView` shows ONE goal line (`goalLine`, derived only from what the
  player's own view contains), the 2 hand slots stay, the NOTES panel stays. Doors you cannot see are drawn neutral (cyan): the server only tells you a door's state while you can see it. Safes pulse faintly (lockers already did) and "E open" prompts appear within reach;
  items win the single prompt slot over doors, keypads, notes and switches. Escape stages never get the default reality abilities (`Room.buildEngine`).
* **Known limit.** The server does not know where the flashlight points (aim is client-side), so it publishes everything within the vision radius and line of sight, not only the cone. Sending the aim angle with input would let it publish the cone only; not done here.

### P3D step 5: the generator, the endless loop, validation

* **Every stage is generated** (`server/src/rooms/generate.ts`, tables in `shared/src/rooms/tables.ts`). With `ESCAPE_STAGES` on, `Room.buildEngine` calls `generateEscapeStage(stage, seed)` for stage 1 and for every stage after a cleared one (`room.nextStage` is unchanged: it increments the
  stage number and builds the next engine). The dev stages (`/?rooms=1`, `/?rooms=2`, `/?lab=1`) still replace stage 1 only. If a generated stage ever failed validation or engine construction, `Room` recovers with a generated stage 1 (never "no stage"); the tests show it does not happen.
  `ESCAPE_STAGES=0` (or `createGameServer` without `escapeStages`, the default for every existing test) skips all of this and plays the previous stage 1 and generators.
* **Gates.** A single-room stage needs a "door" and an exit in one room: a wall from floor to ceiling with two doors of the SAME room on either side. `validateRoomGraph` allows a door into its own room only when the room has two such doors; `GameSim.sendThrough` then moves the player within the room and the client
  restarts prediction (`Session.layoutSeq`). `validateEscape` treats everything left of the gate as the near side.
* **Stage state additions.** `StageDef.ambientMin` (the tutorial's brightness floor, applied where the engine publishes `darkness`), `EscapeSpec.hidingSpots` (server-private, inert, never published, for the ghost), `ESCAPE_LIMITS.maxClues` is 20 (a 6-room stage can hold 13 real notes).
* **Validation.** `validateEscape` now also checks gate near sides and hiding spots; the generator calls the full `validateStageDef` on every attempt. The real-physics solver is `server/test/rooms/solver.ts` (test code, not shipped): it plays any generated stage with real input.
* **Not generated here.** Breather and Major Breach stages (GAMEPLAY.md section 4) are not implemented; escape stages have no disasters, abilities or tools; the ghost and death are P3E and later.

## P3E the ghost (step 1 done: the core, server side; see docs/GHOST.md and, when written, docs/handoffs/P3E.md)

* **One system per stage** (`server/src/ghost/system.ts`), owned by `Room` (`bindGhost`), stepped once per tick right after the simulation and the stage engine. It reads the world through a narrow `GhostHost` (players in slot order, open doors, a catch callback), so it is unit-tested without a Room or sockets.
* **Additive contract changes:** `GameInput` gains optional `aim` (0 to 255) and `sneak`; `GameSnapshot` gains optional `ghosts` (at most 2, only those in the viewer's view); `POINT_HEIGHT` gains `ghost`; `GameSim.queueInput` takes an optional extra (aim, sneak), `senses()` and `aimOf()` are new; `Room` options gain `ghost` and `startStage`; `restrictedView` takes optional `ghosts` and a viewer `aim`; `createGameServer` takes `ghostStages` (default: env `GHOST_STAGES=1`). `stepBody`, `InputIntent` and the client predictor are untouched: aim and sneak never reach the movement code.
* **Visibility invariant kept:** the ghost is an entity of `restrictedView`. With the ghost option on, the whole view (and the refusals, through `Room.roomsHost.canSee`) is cut to the lit region once a player's aim is known. The deliberate, documented exception (ghost SOUND cues through walls, bounded to a distance bucket and left or right) arrives in step 2.
* **Determinism:** the ghost never reads a clock or `Math.random`; each ghost owns a generator seeded from the stage seed; paths are A* with index tie-breaking.
* **Not done yet (later steps):** client sound and look, hiding spots, capture and rescue, noise from dropped items (the `makeNoise` seam exists), the Pulse Gun and its safe (the `stun` seam exists), the Shade and Howler behaviour, generator integration and the solver extension, `docs/handoffs/P3E.md`.

### P3E step 2: ghost sound and look
Adds the `ghost:cue` event (sound cue: distance bucket and direction, no coordinates; the one documented exception to the vision invariant), the `ghost` dev join flag (`?ghost=N`), optional `aim` and `sneak` on `game:input`, `GhostSystem.cueFor` and `Room.ghostCue` on the server, and `client/src/ui/ghost/**` (pure `ghostParam`, `cueMath`, `soundScheduler`, `flicker`, `ghostLook`; Phaser/WebAudio `GhostView`, `GhostAudio`). See `docs/GHOST.md`.
