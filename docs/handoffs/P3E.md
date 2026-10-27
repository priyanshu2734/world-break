# Handoff: P3E, the ghost

Phase: P3E (steps 1 to 5). Baseline: step 4 commit af965d4 on `phase/p3e` (1291 tests as verified by the maintainer). Written at the end of step 5.
Nothing below is marked supported unless a test that passed backs it. Where only a human or a browser could check, it says so.

## 1. Git branch and commit hash
Branch `phase/p3e`. Step 5 commit: **NOT RUN: developer to commit and run `git rev-parse HEAD`** (the working copy here is not a git repository).

## 2. All files changed in step 5
Source: shared `ghost/index.ts`, `protocol.ts`, `rooms/escape.ts`, `rooms/tables.ts`; server `gateway.ts`, `room.ts`, `ghost/{catch,gun,system,types}.ts`, `rooms/{escapeSpec,escapeValidate,generate}.ts`; client `net/session.ts`, `scenes/GameScene.ts`, `ui/ghost/{GhostAudio,GhostView,GunView,cueMath,flicker,ghostLook,gunLogic,soundScheduler}.ts`.
New tests: shared `ghostTypes.test.ts`; server `ghost/{types,ghostLevel}.test.ts`, `ghost/hideTeam.ts` (helper); client `ghostTypes.test.ts`.
Docs: `docs/GHOST.md`, `docs/ARCHITECTURE.md`, this file.
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`. The step-3 fixes are kept (the work started from the maintainer's zip).

## 3. Commands actually run and results
| Command | Result |
|---|---|
| `bun test` shared | 165 pass, 0 fail |
| `bun test` client | 163 pass, 0 fail |
| `bun test` server | 972 pass, 9 fail: the 9 `gateway.*` files cannot import `socket.io-client` in this sandbox (not a code failure) |
| stub `tsc` on the pure client modules and client tests; full `tsc` on server and shared | no TS2729, duplicate-identifier, missing-name or import errors; the remaining errors come from missing zod and socket.io types in the sandbox and also occur in untouched files |
| Mutation checks (Shade freeze, Howler crouch, destroy timer, spot capacity, ghost count) | each mutation made at least one test fail; code restored and diffed |

## 4. What is supported (each backed by tests)
| Feature | Evidence |
|---|---|
| Gun v2: reusable, recharge 30 s +1 s per stage (mode scaled, cap 90 s), hit destroys, loud shot | server `ghost/gun.unit`, `gun.room`; shared `ghostTypes` (stages 1, 2, 7, 12, 100, 1,000,000) |
| Respawn 150 s, -2 s per stage, floor 45 s, far random spot, warning first | server `ghost/types`, `gun.room`; shared `ghostTypes` |
| Hiding spots random per seed, 2 occupants, validator keeps a spot in every room | server `ghost/ghostLevel`, `catch` |
| Wisp (stage 2), Shade (7, frozen in a flashlight cone), Howler (12, scream breaks lights, alerts, counter: crouch) | server `ghost/types`; client `ghostTypes` |
| Look tiers by stage, per-type look, sound, warning | client `ghostTypes` (pure shapes and text); drawing NOT run |
| Evidence per type (data only) | server `ghost/ghostLevel`; shared `ghostTypes` |
| At most 2 types, 2 ghosts from stage 20 | shared `ghostTypes`; server `ghost/types` |
| Generator integration from stage 2, solver: 1 player within 2 slots with the ghost; 2 to 4 players | server `gun.solve` (statistical thresholds, see 6) |

**Not built:** Mimic, Phantom, Warden, Twins.

## 5. Contracts to preserve
Additive only: event `ghost:fx` (`GhostFx`), cue fields `warnKinds`, `gun`, `lightsOut`, sound `screaming`, `GhostPublic.lit`, `GenerateOptions { ghost, difficulty }`, `escape.ghostEvidence` and `ESCAPE_LIMITS.maxEvidence`, `GhostHost.occupantsOf/onScream`, `GunHost.destroy`. `fire` and item kind `pulse_gun` are unchanged. All ghost numbers live in `GHOST_TABLE` / `ghostTuning`. Generation without the ghost option is byte-identical to before.

**The catch/capture rule from step 3 is INTERIM.** P4 replaces it with touch = death; `CatchSystem` is the seam.

## 6. Known issues
* The solver bot does not recover carried parts dropped when caught, so multi-player and late-stage solves are statistical (stage 20 easy 10/10; stage 29 easy at least 7/10; hardcore stage 12 at least 8/10; co-op n=2 at least 4/5, n=3 or 4 at least 2/5), not guaranteed.
* In very small rooms a spawn 700 px from every player can be impossible; it falls back to the 520 px rule.
* "Quieter together if both sneak" is not built.
* Evidence is data only; players never see it (P3F).
* A single ghost before stage 20 even on two-type stages (seed picks the type).
* `stun()` and `stunTicks` remain, unused by the gun.

## 7. Environment variables
No new ones (`GHOST_STAGES=1` as before).

## 8. Database or migration changes
None.

## 9. Files the next phases may modify
* **P4 (death, revive, spectating):** `server/src/ghost/catch.ts` (replace capture with touch = death), `server/src/ghost/system.ts` (the catch callback only), `server/src/rooms/view.ts` (spectator `eyes`), `server/src/room.ts`, `server/src/gateway.ts`, client `ui/ghost/HideView.ts`, `hideLogic.ts`, `scenes/GameScene.ts`.
* **P3F (identify the ghost, disasters in escape stages):** read `escape.ghostEvidence`; `server/src/rooms/generate.ts`, `escapeSpec.ts`, `escapeValidate.ts`, new files under `server/src/ghost/` and `client/src/ui/ghost/` for evidence display.
* **P3I:** client `ui/ghost/**`, `scenes/GameScene.ts`, and look/sound tuning in `ghostLook.ts` and `GhostAudio.ts`.
Do not edit: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`, or existing tests except deliberately changed assertions.

## 10. Not run, and test edits
**NOT RUN:** browser play of step 5 (look tiers, dissolve, scream ring, recharge bar, sounds); WebAudio; Phaser drawing (`GhostView`, `GunView`, `GameScene` not type-checked against Phaser here); real `npm ci`, `npm run typecheck`, `npm run build`; the 9 `gateway.*` test files; real network play; a tunnel session with friends.
**Existing tests deliberately changed:** `server/test/ghost/catch.test.ts` ("a spot holds TWO players"); `server/test/ghost/room.test.ts` (stage 8 now one ghost, type by seed); my own step-4 tests `gun.unit`, `gun.room`, `gun.solve` (v2 rules). `server/test/rooms/solver.ts` gained an additive `opts.team` factory.
Gun cooldown and respawn were previously "stun"; client `gunLogic` prompt text changed to READY / recharging.
