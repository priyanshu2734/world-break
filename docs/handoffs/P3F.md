# P3F handoff: variety and hook (STEPS 1 TO 4 of 6 delivered: room templates and height; the puzzle pool; identify the ghost; curriculum, second ghost, draft pick, loot)

Baseline: `p4-complete` plus the step 6 playtest fixes (the uploaded `p5-base.zip`). Step 1: commit `927d8be` (verified: 1578 tests, client 198, server 1204, shared 176). Step 2: commit `3c632c0`. Step 3: commit `48a78f5` (your message had unfilled placeholders `<clean>`, `<OK>`, `<all passed>`, so I treated it as a pass but have no real totals). Steps 5 and 6 are not started; this file is rewritten at each step.

## 1. Git branch and commit
Branch `phase/p3f`. Step 4: NOT RUN: developer to run `git rev-parse HEAD`. (No `.git` in my sandbox.)

## 2. Files changed (step 4)
Added: `shared/src/variety/curriculum.ts`, `shared/src/draft/index.ts`, `shared/src/rooms/loot.ts`, `server/src/rooms/variety.ts`, `client/src/ui/{draftLogic,DraftView}.ts`; tests `shared/test/{curriculum,draft}.test.ts`, `server/test/rooms/{curriculum.generate,loot}.test.ts`, `server/test/ghost/second.test.ts`, `server/test/death/draft.room.test.ts`, `client/test/draftLogic.test.ts`.
Modified (shared): `ghost/index.ts`, `rooms/{escape,index,puzzles,tables}.ts`, `variety/{index,pick}.ts`, `index.ts`, `protocol.ts`. (server): `room.ts`, `gateway.ts`, `ghost/{system,types}.ts`, `death/revive.ts`, `rooms/{generate,escape,escapeSpec,escapeValidate,puzzleBuild,view}.ts`, `salvage/system.ts`, `systems/engine.ts`. (client): `net/session.ts`, `scenes/GameScene.ts`, `ui/{escapeUse,EscapeView,JournalView,journalLogic}.ts`. Docs: `VARIETY.md`, `ARCHITECTURE.md`, `GHOST.md`, this file.
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`.

## 3. Commands run (my sandbox; no registry, so `npm ci` cannot run; stand-in test runner)
* Baseline before step 4 (reported at step 3): shared 187, client 202, server 1236 without gateway (about 1283 with the 47 gateway tests), about 1672 in all.
* Now: shared **203** (+16), client **206** (+4), server **1265** without gateway (+29), all 0 failed, run file by file. Expected on your machine: about **1721** (203 + 206 + 1265 + 47 gateway).
* Typecheck: shared, server and client: 0 errors apart from the stand-in artefacts (TS7006 on `it.each` callbacks, `test/disasters/runtime.test.ts` TS7053, gateway/`socket.io`, client Phaser and `vite/client` types missing here). Your real typecheck is the judge.
* Generation sweep: 1500 stages over many seeds and both ghost settings, 0 failures; `death/solve` (every stage on the grid, every difficulty) green; `death/revive.gen` green. Whole server suite takes about 5 minutes per file in 4 parallel streams here (slowest: `death/solve` 213 s, `rooms/generate` 97 s, `curriculum.generate` 88 s).
* NOT RUN: `npm ci`, `npm run build`, the 8 gateway test files (including the new `draft:vote` handler), the real client typecheck, any play in a browser (the draft screen, the loot cache drawing, the journal teaching banner were never seen), `git rev-parse HEAD`.

## 4. What is supported, and the tests behind it
| Claim | Tests |
|---|---|
| The curriculum rows 1 to 15 are pinned; each stage features its lock; stage 1,000,000 is generated | `shared/curriculum`, `rooms/curriculum.generate` |
| Newness: no lock type repeats across stages (stage 3 and the tutorial boundary exempt), no template or theme repeats, ghost types rotate; empty history = the old draws | `shared/curriculum`, `rooms/curriculum.generate` |
| Two ghosts from stage 20, never a third, own warning each, never overlapping; warning never under 60 ticks; hearing share | `ghost/second` |
| Draft: 3 distinct offers, votes, tie and no-vote rules, host settles, bounds, strict vote schema, stage 1,000,000 | `shared/draft`, `death/draft.room`, `client/draftLogic` |
| After a wipe: upgrades kept on Easy, newest lost on Hardcore, none on a new run | `death/draft.room` |
| Loot: stage 13 always has one cache, none before, never in the start room, outcome by seed and hidden, once, reach/light refusals | `rooms/loot` |
| A dead body does not keep a plate lit | `rooms/loot` |
| The teaching line reaches a player with little connected time since stage 7 | `death/draft.room` |
| Plates must lie on one unbroken surface (no gap between them) | `rooms/puzzles.generate`, `death/solve` |

## 5. Deliberately changed existing tests and helpers
* `server/test/rooms/puzzles.generate.test.ts`: stages 1 to 6 have no puzzles, `puzzlesForStage(7)` is `['breaker_panel']`, wiring joins at 15; a stage whose curriculum lock is a puzzle has no puzzle-free twin, so the legacy comparison skips it.
* `shared/test/puzzles.test.ts`: `PUZZLE_FROM_STAGE >= 7`.
* Test helpers `server/test/rooms/solver.ts`, `test/ghost/{gun.room,gun.solve}.test.ts`, `test/death/drill.ts`: the stage definition now comes from `room.stageDef` (a later stage depends on the run history and cannot be regenerated from stage and seed alone); the fallback is the old call.

## 6. Interfaces to preserve
Step 3 list, plus: `CURRICULUM`, `featuredLock`, `VarietyHistory`, `GenerateOptions.history`, `newnessPick`, `UPGRADES`, `UPGRADE_BOUNDS`, `effectsOf`, `draftOffer`, `RoomSnapshot.draft/upgrades`, the client event `draft:vote`, intent `loot`, `EscapePublic.loot`, `Room.stageDef`, `Room.effects`, hooks `GhostHost.warningShift/hearingShare`, `ReviveHost.holdShare`, `ItemSystem` opt `extraSlots`. The draft lives inside `stage_complete` (the phase machine is unchanged). New draws always come after the old ones.

## 7. Known issues and limits
* Stages 1 and 2 are exempt from the curriculum (they keep their original draws so old seeds keep their stage); stage 2 may therefore end on `code` and stage 3 must show `code` again: the no-repeat rule is not applied to stage 3.
* From the fifth attempt of a stage that cannot be built, the lock and template newness is dropped (the stage is still built); the record may then differ slightly.
* Loot is a cache in an existing room, not a room of its own. The upgrade outcome takes the first offer.
* Not built in P3F (docs/HOOK.md rows for other milestones): gravity pickup, lights-out room and flare, mini-boss, spark hazard, disaster layer.
* The teaching line is counted per player by connected ticks; late joining is only possible in the lobby, so this covers reconnects.
* The draft needs the host to press go on if somebody is away; the host's go-on settles it.
* Nothing played in a browser; the second ghost's look and the draft screen layout are unseen.
* A single cache can pay a hazard noise that a ghost in the room hears; there is no warning on the cache.

## 8. Env vars, DB changes
None.

## 9. Files the next step may modify
Step 5 (themes, ghost look tiers, unnamed ghost and evidence look): client `ui/*` and `ui/ghost/*`, `scenes/GameScene.ts`, new theme data under `shared/src/variety/` (data only, `THEME_IDS` exists), `docs/polish/VISUAL_ISSUES.md`. Step 6 (solver, drills, docs): `server/test/rooms/solver.ts`, `test/death/drill.ts`, docs. Do not touch the frozen files.

## 10. Outstanding acceptance criteria
Steps 5 and 6. For step 4 the open items are your own `npm ci`, typecheck, test and build run, and a look at the draft screen (keys 1 to 3, N), the loot cache (E) and the journal teaching line in the browser.
