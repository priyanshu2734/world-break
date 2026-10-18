# Handoff: P3B (Reality abilities and the physics migration)

STATUS: complete. Steps 1 to 4 are delivered; the acceptance checks that could be run were run (section 3). What could not be run is
listed explicitly (NOT RUN) in sections 1, 3 and 10. Read `docs/ABILITIES.md` (limits table, support status, rules) and the P3B sections
of `docs/ARCHITECTURE.md` first.

## Ability support status (an ability is supported only if its tests passed)
Full suite on the developer's machine after step 3 and again in the sandbox after step 4: client 43, server 629, shared 86 = **758 passed, 0 failed**.

| Ability | Status | Main tests |
|---|---|---|
| Gravity Well (flip / reduce) | **Supported** | `server/test/abilities/physics.room.test.ts`, `shared/test/sim.world.test.ts`, `server/test/abilities/parity.test.ts` |
| Freeze (objects and hazards) | **Supported** | `server/test/abilities/system.test.ts` |
| Duplicate: copies that hold plates | **Supported** | `server/test/abilities/duplicate.test.ts` |
| Duplicate: "block a beam" | **NOT supported, not implemented** (no beams exist in P3B) | none |
| Momentum (self and objects) | **Supported** | `physics.room.test.ts`, `sim.world.test.ts`, `duplicate.test.ts` |
| Anchor placement rules | **Supported** | `system.test.ts`, `physics.room.test.ts` |
| Reality Energy (cap, costs, regeneration by breakpoint repairs) | **Supported** | `system.test.ts`, `lab.solvability.test.ts` |
| Reality Energy: regeneration by conduit repairs (+15) | **Implemented, NOT tested** | none |
| Physics migration (bit-exact default, prediction parity) | **Supported** | `shared/test/sim.baseline.test.ts`, `sim.world.test.ts`, `parity.test.ts` |
| Ability Lab (1 to 4 players, each ability required) | **Supported** | `lab.solvability.test.ts`, `lab.room.test.ts`, `gateway.lab.test.ts`, `fuzz.room.test.ts` |

Reported by the developer, not automated: the Lab was played in a real browser after step 3 and all abilities worked.

## How to open the Ability Lab
Dev-only stage, outside the endless rotation. It needs a flag on the server AND a URL parameter on the client.

1. Start the server with `ABILITY_LAB=1` (its log prints `Ability Lab: ON, open /?lab=1`):
   * bash / zsh / Git Bash: `ABILITY_LAB=1 npm run dev:server`
   * PowerShell: `$env:ABILITY_LAB = "1"; npm run dev:server`
   * cmd.exe: `set ABILITY_LAB=1 && npm run dev:server`
2. Start the client: `npm run dev:client`.
3. Open **http://localhost:5173/?lab=1**. This creates a NEW room as an Ability Lab room (the lobby shows `ABILITY LAB (dev)`). Press Enter to start.
4. Other players (up to 4 in total) join with the room code as usual (`http://localhost:5173/#CODE`); no `?lab=1` is needed for them.

The flag counts only when a room is CREATED. If the server was not started with `ABILITY_LAB=1`, `?lab=1` shows "The Ability Lab is not enabled
on this server (start it with ABILITY_LAB=1)." and creates no room. Without `?lab=1` you get the normal game. The Lab is stage 1 of that room;
the host's "next stage" continues with the normal stage 2 on Relay Platform 01. Hold R (host) resets the Lab.
Controls: 1 to 5 tools, 6 Gravity Well (Shift = reduce), 7 Freeze, 8 Duplicate, 9 Momentum (Shift = stop); the mouse aims.
The station solutions are in `docs/ABILITIES.md` section 8.

## 1. Git branch and commit hash
Branch `phase/p3b`. Commits reported by the developer: step 1 `8c54b87`, step 2 `4cadaac`, step 3 `c34c89d`.
Step 4 (documents only) commit: NOT RUN: developer to run `git rev-parse HEAD` after committing step 4.
(The sandbox that produced steps 3 and 4 used its own throw-away git history only to list changed files.)

## 2. All files changed in this milestone (P3B, steps 1 to 4, against the pre-P3B base)
Modified (18): `client/src/net/session.ts`, `client/src/scenes/GameScene.ts`, `client/src/scenes/LobbyScene.ts`, `client/src/sim/prediction.ts`,
`client/src/ui/StageView.ts`, `docs/ARCHITECTURE.md`, `server/src/config.ts`, `server/src/game.ts`, `server/src/gateway.ts`, `server/src/main.ts`,
`server/src/room.ts`, `server/src/systems/engine.ts`, `server/src/systems/stageDef.ts`, `server/src/systems/validate.ts`, `shared/src/index.ts`,
`shared/src/protocol.ts`, `shared/src/sim.ts`, `shared/src/systems/schemas.ts`.

Added (36):
* shared: `src/abilities/{index,labArena,public,specs,world}.ts`; tests `test/abilities.test.ts`, `test/sim.baseline.test.ts`, `test/sim.world.test.ts`, `test/helpers/simBaseline.ts`
* server: `src/abilities/{defaults,system,world}.ts`, `src/systems/stages/abilityLab.ts`; tests `test/abilities/{duplicate,fuzz.room,lab.room,lab.solvability,parity,physics.room,room,system,validate.p3b,world}.test.ts`, `test/gateway.ability.test.ts`, `test/gateway.lab.test.ts`; helpers `test/helpers/{abilityHarness,labBot,labHarness}.ts`
* client: `src/net/labParam.ts`, `src/ui/{AbilityHud,WorldView,abilityView}.ts`; tests `test/abilityView.test.ts`, `test/labParam.test.ts`
* docs: `docs/ABILITIES.md`, `docs/handoffs/P3B.md`

No pre-P3B test or helper file was modified (every file under a `test/` directory is an addition).

## 3. Commands actually run, and their results
Sandbox (Linux, Node with registry access), real results:
* `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on a clean unzip of the step 3 full-repo zip: typecheck 0 errors, 758 tests passed, build OK.
* After the step 4 document edits, in the working tree: `npm run typecheck` 0 errors (tests are inside each package's `include`, so they are type-checked);
  `npm test`: client 43, server 629, shared 86 passed; `npm run build` OK (the existing Vite chunk-size warning only).
* Step 4 changed only `docs/ABILITIES.md` (new) and `docs/ARCHITECTURE.md` and this file. No code was changed in step 4.
* Earlier steps: a smoke test of the real `main.ts` with and without `ABILITY_LAB=1` through a real socket.io client (Lab room, normal room and
  the refusal error all behaved as documented); mutation checks (change code, confirm a test fails, restore) on the baseline differential
  test, the arc period, the ledge height and the island plate weight.
Developer machine (as reported): steps 1 to 3 each verified with typecheck, tests and build; step 3: 758 tests, commit `c34c89d`.
NOT RUN: any automated real-browser test (Phaser rendering, HUD layout, mouse aiming), a multi-browser session over a real network, a load or soak test,
`git rev-parse HEAD`.

## 4. Tests passed, failed, not run
Passed: 758 of 758 (client 43, server 629, shared 86). Failed: none. Not run: the NOT RUN list above.
Test groups added by P3B: differential test of the shared step against a frozen copy of the P2 step (bit-exact over 40 bodies x 1500 ticks x 5 empty-world shapes);
zone and impulse behaviour and a fuzz (finite, in bounds, never inside a solid); server `GameSim` versus client `LocalPredictor` (bit-for-bit lockstep over 2500 ticks
with random input, zones and impulses, plus a latency and reconcile scenario); the ability engine (validation, energy, cooldown, caps, ownership, range, rate limit);
Freeze on objects and hazards; Anchor placement rules; Duplicate and plate rules; Lab solvability with 1, 2, 3 and 4 bots; "each ability required" negative runs and
bounded physics probes; Lab isolation from the rotation; gateway and config for the Lab flag; a 4-player ability fuzz; validator rules; client HUD view-models and the URL flag.

## 5. Interfaces and contracts the next phase must preserve
* Protocol (all additive and optional): `ability:use` (payload `AbilityAction`, ack `{ ok, message }`); `GameSnapshot.world?` (`zones`, `impulses`, `props`);
  `StageState.abilities?`; `StageState.hazards[].frozenUntilTick?`; entity kind `pressure_plate`; `JoinPayload.lab?`; `RoomSnapshot.lab?`.
* Shared step: `stepBody(body, input, arena = ARENA, world?: StepWorld)`. With no world data it must stay bit-exact with the P2 step
  (`shared/test/sim.baseline.test.ts` and its frozen oracle `shared/test/helpers/simBaseline.ts` must never be edited or weakened). `worldForTick(data, tick, playerId)` is
  the single bridge used by the server and by prediction. Any new physical effect must be published as data and applied through that function on both sides.
* Prediction: `LocalPredictor.start/reconcile(..., ctx?: PredictionWorldCtx)` where `ctx.tick` is the snapshot tick (the next tick the server simulates) and the i-th pending
  input replays at `tick + i`; `LocalPredictor.setArena(arena)`.
* `ABILITY_SPECS` and the other constants in `shared/src/abilities/specs.ts` are the single source of truth for limits; `docs/ABILITIES.md` section 2 mirrors them.
* `StageDef.abilities`, `StageDef.props`, `StageDef.arenaId` (arena chosen by `getArena(id)`; an unregistered id is a validation error).
* Pressure plates are controls of the existing `timed_controls` objective with `armTicks: 1` (no new objective kind was added; keep it that way unless older exhaustive switches are updated).
* `GameSim.world` (a `PhysicsWorld`), `GameSim.configure(props)`, `GameSim.loadArena(arena)`; `StageEngine.attachWorld(world)` must be called by whoever builds an engine that has props or abilities (`Room.bindWorld` does).
* `Room` 4th constructor parameter `{ lab?: boolean }`; `RoomManager.create({ lab })`; `createGameServer({ abilityLab })`; env `ABILITY_LAB`.
* Tick order in `Room.tick`: `GameSim.step()` (bodies, then `PhysicsWorld.step()`), then `StageEngine.step(pos)`.
* `ABILITIES_IN_ROTATION` (server/src/abilities/defaults.ts) is `true`.

## 6. Known bugs and incomplete work
* "Block a beam" (GAMEPLAY.md section 4, Duplicate) is not implemented; copies hold plates only.
* Implemented but NOT covered by a dedicated test (so not claimed as supported): the +15 energy for a completed CONDUIT repair (`ENERGY_PER_REPAIR.conduit`; breakpoint repairs, +30, are tested);
  Momentum's 200 px range limit on objects; the per-player "1 active" caps of Gravity Well and Freeze (unreachable by play at the default numbers because each cooldown is longer than its effect, so
  they are defence in depth). The per-player cap of Duplicate and every room-wide cap are tested.
* "Required" is shown for the intended mechanics (negative runs, bounded probes, geometry checks). It is not a proof that no exotic multi-ability chain exists, for example lifting a
  crate with a flipped well and pushing it with several Momentum shoves to avoid a Duplicate.
* The island crate reaches the island only if shoved from near its authored spot (x 340 to 378). A wrong shove needs a reset (hold R, host) or a copy of the crate.
* A player can jump from the upper-left platform to the island; the island plate ignores players, so this does not matter for the objective.
* Abilities are on for every generated stage (stage 2 and up); those stages have no props, so Duplicate has nothing to copy there, and the numbers have not been balance-tuned for the rotation.
* A teammate's new zone is unknown to a client's prediction until the next snapshot (the server corrects it); a body exactly on a zone edge can differ by one sub-step (a few px).
* Browser presentation was verified only by the developer's playtest of the Lab, not by automation.

## 7. Environment variables required (names only)
`PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL` (existing, optional), `ABILITY_LAB` (new, optional, `0` or `1`, dev only; needed only to open the Ability Lab).

## 8. Database or migration changes
None (there is no persistence yet).

## 9. The exact files the next milestone may modify
The P3B prompt did not define P3C, so this is a recommendation that follows the ownership rules in `docs/ARCHITECTURE.md`:
* May add: `shared/src/disasters/**`, `server/src/disasters/**`, new stages under `server/src/systems/stages/**` and their registration in `server/src/systems/registry.ts`,
  new tests and helpers (as new files).
* Additive-only edits: `server/src/systems/{stageDef,engine,validate}.ts`, `shared/src/systems/{tools,schemas}.ts`, `shared/src/protocol.ts`, `shared/src/index.ts`, `server/src/{room,gateway}.ts`,
  `client/src/ui/**`, `client/src/scenes/GameScene.ts`, `docs/ABILITIES.md` and `docs/ARCHITECTURE.md` (to document combinations), and a new `docs/handoffs/P3C.md`.
* Frozen unless a documented migration updates server AND client prediction together: `shared/src/sim.ts`, `shared/src/arena.ts`, `client/src/sim/prediction.ts`.
* Never touch: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, any existing test, `shared/test/helpers/simBaseline.ts`, or another phase's handoff.
* Out of scope until their phases: health and death (P4), rooms (P4B), OpenAI (P5), persistence (P6).

## 10. Acceptance criteria still outstanding
* Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on the developer's machine for the step 4 commit (expected: 758 tests, no change from step 3) and record the commit hash.
* A human multi-player playtest of the Lab and of abilities in the rotation (HUD readability, aiming, balance of cost and cooldown). Only the Lab was played, by one developer.
* Add tests for the three untested rules in section 6 (conduit +15, Momentum range on objects, the Well and Freeze per-player caps via direct world injection), or accept them as untested.
* Decide whether "block a beam" is required for P3B; if so it is a separate implementation task (beams, plates and a test that a copy blocks one).
* Decide whether abilities should stay on in the endless rotation (`ABILITIES_IN_ROTATION`) once the rotation has been playtested.
