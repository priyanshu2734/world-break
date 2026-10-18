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
- [ ] P3 Abilities + disasters: gravity inversion, reactor overload, fractures, temporal storms, power cascade, combos
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

## P3B pressure plates, props and the Ability Lab (steps 1-3)
* **Props** (`PhysicsWorld`, `server/src/abilities/world.ts`): crates are server-simulated (gravity, zones, friction, solids, arena
  bounds), never collide with players or each other, and are published in `GameSnapshot.world.props` (clients ease toward them; no
  prediction). Hard cap: `MAX_PROPS_TOTAL` (12) alive per room, clones included. Clones expire (`ABILITY_SPECS.duplicate.durationTicks`).
* **Pressure plates** are an entity kind (`pressure_plate`) used as the controls of the EXISTING `timed_controls` objective. Each tick a
  plate is pressed it re-arms itself for one tick, so a plate objective needs `armTicks: 1` ("all plates pressed at the same moment").
  `activatedBy: 'any'` is pressed by a player standing on it (feet within 3 px of its surface, centre within 24 px) or a resting prop;
  `'object'` (a heavy plate) only by a RESTING prop. A prop in flight never presses a plate. The objective latches once complete.
  No new objective kind was added, so exhaustive switches in older code and test helpers are untouched.
* **Per-stage arena.** `StageDef.arenaId` now selects the arena through `getArena(id)` (`shared/src/abilities/labArena.ts`; unknown id =
  Relay Platform 01). `Room` builds the `GameSim` and the `StageEngine` for the stage's arena, `GameSim.loadArena` swaps it between
  stages and resets the world. `GameSnapshot.arenaId` already told clients which arena; `GameScene` redraws the platforms and
  `LocalPredictor.setArena` predicts against it when it changes.
* **Ability Lab** (`server/src/systems/stages/abilityLab.ts`, arena `ability-lab-01`): stage 1 of a room created with the dev flag, never
  returned by the stage registry (tested for stages 1..80 over several seeds). See `docs/handoffs/P3B.md` for how to open it.
* **Freeze substitutes the shield** in the validator only when the loadout has no Shield Projector, Freeze is enabled, and the channel
  fits inside one freeze with 10 ticks of slack (`FREEZE_CHANNEL_SLACK_TICKS`). Every other stage validates exactly as before.
