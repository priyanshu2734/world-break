# P3F handoff (FINAL): variety and hook. All 6 steps delivered.

Steps: 1 templates and height; 2 puzzle pool; 3 identify the ghost; 4 curriculum, second ghost, draft, loot; 5 themes and look; 6 solver, determinism, docs, this handoff.
Baseline: `p4-complete` plus the playtest fixes (the uploaded `p5-base.zip`). Commits (yours): step 1 `927d8be`, 2 `3c632c0`, 3 `48a78f5`, 4 `b659d96`, 5 `a6ec500`. Your messages for steps 4 and 5 contained unfilled template placeholders (`<clean>`, `<OK>`, `<all passed>`, `<what you saw…>`); I treated them as passes. The browser result is therefore unknown: **nothing visual was ever confirmed by me or in my sandbox.**

## 1. Git branch and commit
Branch `phase/p3f`. Step 6: NOT RUN: developer to run `git rev-parse HEAD`. (No `.git` in my sandbox.)

## 2. Baseline test counts (before step 6)
After step 5, as run in my sandbox: shared 212, client 225, server 1269 without the 8 gateway files (about 1316 with their 47 tests), about 1753 in all. Your own step 4 figures: shared 203, client 206, server 1312, 1721 in all.
After step 6: see section 4.

## 3. Files changed (step 6)
Added: `shared/src/variety/save.ts`; tests `shared/test/varietySave.test.ts`, `server/test/rooms/variety.solve.test.ts`, `server/test/rooms/variety.save.test.ts`; helper `server/test/rooms/runSolve.ts`.
Modified: `shared/src/variety/index.ts` (exports `save`); `server/src/room.ts` (`varietyRecords`, `restoreVariety`; no rule changed); `server/test/rooms/solver.ts` (`SolveExtras`, side visits, three new `SolveStats` fields); `server/test/death/drill.ts` (`extras`, three new `DrillResult` fields; all callers use the optional parameter); `docs/{VARIETY,ARCHITECTURE}.md`; this file.
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`, the generator, validators, any rule. Your earlier fixes are kept (`usePrompt(.., 0)` in `client/test/draftLogic.test.ts`). No two files differ only by case.

## 4. Commands run and results (my sandbox; no registry, stand-in test runner)
* Now: shared **216** (+4), client **225** (+0), server **1284** without the gateway files (+15), all 0 failed, run file by file. Expected on your machine: server about **1331** (1284 + 47 gateway), total about **1772**.
* `death/solve` (11 tests) and `death/revive.gen` (10) are green. Slowest files: `death/solve` 128 s, `rooms/generate` 95 s, `rooms/curriculum.generate` 88 s, `rooms/puzzles.solve` and `gun.solve` about 57 s, `variety.solve` 34 s. The whole server suite ran in about 5 minutes wall (4 files in parallel).
* Typecheck: shared and server 0 errors apart from the stand-in artefacts (TS7006 on `it.each` callbacks, `test/disasters/runtime.test.ts`, gateway/`socket.io`). Client: only the missing-Phaser errors (the real client typecheck is yours).
* Fixed while writing the step 6 tests: a narrowing error in `runSolve.ts`, wrong ghost names and a wrong link field in `variety.save.test.ts` (caught by typecheck, then fixed).

## 5. What is supported, and the tests behind it (whole phase)
| Claim | Tests |
|---|---|
| 13 lock types, 8 new puzzles, each solvable solo and with a team, bounded against brute force | `shared/puzzles`, `server/rooms/{puzzles.runtime,puzzles.generate,puzzles.solve}` |
| Room templates: no repeat in a row, reachable, height used | `server/rooms/{templates,variety.generate}`, `shared/variety` |
| Ghost identity hidden from stage 7; evidence, journal, one entry per ghost line, bonuses bounded | `shared/identify`, `server/rooms/identify.runtime`, `server/ghost/identify`, `server/death/identify.room` |
| Curriculum rows 1 to 15, newness, no repeated lock or template, endless (stage 1,000,000) | `shared/curriculum`, `server/rooms/curriculum.generate` |
| Second ghost from stage 20 (never more), staggered warnings | `server/ghost/second`, `rooms/variety.solve` |
| Draft: 3 offers, votes, bounded effects, retry rules | `shared/draft`, `server/death/draft.room`, `client/draftLogic` |
| Loot cache from stage 13, outcome by seed, never public | `server/rooms/loot`, `rooms/variety.solve` |
| Themes as data, never read by rules; colour language; ghost tiers; evidence glyphs (logic only) | `shared/themes`, `server/rooms/theme.room`, `client/{theme,evidenceArt,ghostTiers}` |
| A RUN of stages (1 to 16 solo, 3 and 4 players 3 to 14, two-ghost stages 18 to 25, all upgrades at max, side visits) is cleared within two slots (three with Extra hand) | `server/rooms/variety.solve` |
| The variety history is saved, validated, restored; same input gives the same stage | `shared/varietySave`, `server/rooms/variety.save` |
| Death rules, revive, solver band | `server/death/{solve,revive.gen}` (unchanged, green) |

## 6. Deliberately changed existing assertions (whole phase)
* `shared/test/curriculum.test.ts`: row 2 featured lock is `null` (stage 2 keeps its original draws) and the server pin counts 13 non-null rows.
* `client/test/draftLogic.test.ts`: `usePrompt(.., 0)` (your fix).
* Test helpers (not assertions): the four helpers that rebuilt a stage from (stage, seed) now use `room.stageDef`. `solver.ts` and `drill.ts` gained optional extras.

## 7. Interfaces to preserve
`ESCAPE_LIMITS`, `LOCK_TYPES` vs `PUZZLE_TYPES` vs `ANY_LOCK_TYPES`, `GenerateOptions.history`, `Room.stageDef`, `Room.varietyRecords`, `Room.restoreVariety`, `VarietyRecordSchema`, `VarietyHistorySchema`, `normaliseHistory`, `HISTORY_KEEP`, the `examine`/`mark`/`loot` intents, `heard`/`inspect` events, `canKill`/`contactTicks`/`satiatedTicks`, `UPGRADE_BOUNDS`, `effectsOf`, `THEMES` (data only), `RoomSnapshot.theme` (optional), the generator draw order (new draws after old ones), the Revive Cell rule, `lookFlags`, the `calm` parameters.
**Determinism:** a stage is a function of (stage, seed, last 3 variety records). P6 must save `Room.varietyRecords`; P5 may use an empty history for a stage on its own.

## 8. Known issues and limits
* **Nothing visual was seen in a browser** (themes, props, hum, ghost tiers, veiled ghost, glyphs, draft screen, journal, loot): Phaser could not be installed here and the placeholders in your reports leave it unknown.
* The strict solver tests make the ghost unable to kill; whether a bot survives a lethal ghost is the statistical band in `death/solve`, a property of the bot and not of the stage.
* The solver reaches evidence and the cache only after the doors are open (no cross-room teleport); their placement is validated by the generator, not by a first-visit route.
* Stage 2 and 3 are exempt from some newness rules; the cache is not its own room; props ignore the room template; theme hum is a single oscillator; Lab and demo stages have no theme.
* Not built (other milestones): gravity pickup, lights-out room and flare, mini-boss, spark hazard, disasters inside escape stages.
* VISUAL_ISSUES.md items outside P3F files remain (ability slot overflow, message log overlap, disaster panel, stacked labels). Stage 1 container hint belongs to P3G.
* Suite time: about 5 minutes wall in my sandbox, file by file, 4 in parallel (variety.solve about 30 s, variety.save about 1 s).

## 9. NOT RUN
`npm ci`; `npm run build`; the 8 gateway test files; the real client typecheck (checked with a temporary config without Phaser and vite types); any play in a browser; `git rev-parse HEAD`.

## 10. Env vars, DB changes
None. URL flag `?reducemotion=1` (client only).

## 11. Files later milestones may modify
* **P3I (stealth toolkit, ghost memory, AI director):** `server/src/ghost/**`, `server/src/systems/hiding*`, `shared/src/ghost/**` (new members only; keep `heard`/`inspect`, `canKill`/`contactTicks`/`satiatedTicks`), `server/test/ghost/**`, `server/test/death/drill.ts` and `server/test/rooms/solver.ts` (additive options), `docs/GHOST.md`. Ghost counts and the journal's evidence rules stay in `shared/ghost` constants.
* **P3H (ping wheel, chat, roles):** `shared/src/protocol.ts` (new optional messages only), `server/src/gateway/**`, new `server/src/social/**`, `client/src/ui/**` (new files), `client/src/scenes/GameScene.ts` (hook points only), `room.ts` (new handlers; do not touch `varietyRecords`, `restoreVariety`, the draft or the phase machine).
* **P5 (scenario generation):** `server/src/rooms/generate.ts` and `puzzleBuild.ts` (new draws AFTER existing ones only), `shared/src/variety/{curriculum,save}.ts`, `shared/src/rooms/escape.ts` (new lock types need `needText`, a validator rule and a solver case), `server/test/rooms/{solver,runSolve}.ts`. Use `history` explicitly; an empty history is the stage alone.
Nobody may touch: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`.

## 12. Outstanding acceptance criteria
Your own `npm ci`, typecheck, tests and build, including the gateway files and the client; and a look in the browser at: the draft screen, the loot cache, each of the four themes, the veiled ghost (stage 7+), a stage 25 ghost against stage 2, evidence markers before and after examining, the journal (J), reduced motion (`?reducemotion=1`) and the brightness assist (B).
