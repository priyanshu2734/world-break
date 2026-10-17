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
    server/src/disasters/registry.ts   SUPPORTED (selectable) vs CANDIDATES (implemented, unconfirmed); generateDisasterStage(stage, seed)
    server/src/disasters/{generate,fallback}.ts  stage N >= 2 entry point; tested tutorial clone if generation or validation fails
    client/src/ui/disasterText.ts      HUD lines + incoming-hazard marker from the public disaster state

Endless loop: `room:nextStage` (host only, after `stage_complete`) reuses the existing `NEXT_STAGE` transition. The Room derives
`stage seed = deriveSeed(runSeed, 'stage', stage)` (run seed is server-only), builds the engine from `getStageDef(stage, seed)` and records
`StageRecord { stage, seed, defId, fallback }` server-side. Stage 1 is the hand-authored tutorial; every later stage is generated. There is no final stage.

Engine step order is now: expiries > hazards > channels > objectives > **disaster** > deadline. `hazardArmed` consults `DisasterRuntime.hazardMod`;
effects are a pure function of the phase, so CLEANUP removes them; a stabilised stage is cleaned up in the same tick. FAILED is a soft failure
(bounded penalty, stage still completable; hard failure is P4). See `docs/DISASTERS.md` for the lifecycle table, fairness limits and each disaster,
and `docs/handoffs/P3A.md` for the contract list, what was verified and what was NOT RUN.

## Ownership boundaries for P3 (disaster library)
P3 may add `shared/src/disasters/**`, `server/src/disasters/**` and new stages in `server/src/systems/registry.ts`.
Additive-only edits: `stageDef.ts`, `engine.ts` (hooks), `tools.ts`, `schemas.ts`, `protocol.ts`, `room.ts`, `gateway.ts`, client `ui/**`, `GameScene.ts`.
Frozen unless a documented migration updates server AND client prediction together: `shared/src/sim.ts`, `shared/src/arena.ts`.
Frozen: `phases.ts`, `difficulty.ts`, `loop.ts`, `prediction.ts`, `interpolation.ts`, `tutorial.ts` (add new stages instead), all existing tests.
Do not start OpenAI integration (P5), persistence (P6) or death review (P4).
