# P3F handoff: variety and hook (STEPS 1 TO 3 of 6 delivered: room templates and height; the puzzle pool; identify the ghost)

Baseline: `p4-complete` plus the step 6 playtest fixes (the uploaded `p5-base.zip`). Step 1: commit `927d8be` (verified by the developer: 1578 tests, client 198, server 1204, shared 176). Step 2: commit `3c632c0` on `phase/p3f` (reported verified; the totals line of that message was an unfilled template, so I have no real step-2 totals). Steps 4 to 6 are not started; this file is rewritten at each step.

## 1. Git branch and commit
Branch `phase/p3f`. Step 3: NOT RUN: developer to run `git rev-parse HEAD`. (No `.git` in my sandbox.)

## 2. Files changed (step 3)
Added: `packages/client/src/ui/{journalLogic,JournalView}.ts`; tests `packages/shared/test/identify.test.ts`, `packages/server/test/rooms/identify.runtime.test.ts`, `packages/server/test/ghost/identify.test.ts`, `packages/server/test/death/identify.room.test.ts`, `packages/client/test/journalLogic.test.ts`.
Modified: `packages/shared/src/ghost/index.ts` (identify constants, `'unknown'` public kind, `JOURNAL`, `gunCooldown`, field guide), `packages/shared/src/rooms/escape.ts` (intents `examine`, `mark`; public `evidence`, `journal`); `packages/server/src/{room.ts,ghost/system.ts,ghost/types.ts,death/review.ts,rooms/escape.ts,rooms/view.ts,systems/engine.ts}`; `packages/client/src/{scenes/GameScene.ts,ui/EscapeView.ts,ui/escapeUse.ts,ui/ghost/{ghostLook,soundScheduler,cueMath}.ts,ui/death/flyLogic.ts}`; `packages/server/test/death/review.test.ts` (one test ADDED at the end, no old assertion changed); `docs/{VARIETY,ARCHITECTURE,GHOST}.md`; this file.
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`, the generator (no new random draw), the revive code. No old test assertion was changed in step 3.

## 3. Commands run (my sandbox; no registry, so `npm ci` cannot run; stand-in test runner)
* Typecheck: shared 0 errors; server 0 errors except `test/disasters/runtime.test.ts` (TS7053, an untouched file, a stand-in artefact; gateway errors are only the missing `socket.io` module here). Client: only checked with Phaser and vite types missing, so only type errors not caused by that were read: none.
* Shared: **187** passed (181 + 6). Client: **202** passed (198 + 4). Server: **1236** passed excluding the gateway files (1212 + 24).
* Expected on your machine: shared 187, server about **1283** (1236 + the 47 gateway tests), client 202, total about **1672** (was 1638 expected after step 2).
* NOT RUN: `npm ci`, `npm run build`, the 8 gateway test files, the real client typecheck, any play in a browser or Phaser (the journal screen, the traces and the unnamed ghost look were never seen on a screen).

## 4. What is supported, and the tests behind it
| Claim | Tests |
|---|---|
| From stage 7 the type is `unknown` in public ghosts, cue sounds, warning kinds, fx (stages 7, 8, 50, 1,000,000, all three types); named before 7 | `ghost/identify` |
| The death review never names the type from stage 7 (`unknown` is worded "ghost", once); cause kind null | `death/review` (new case), `Room.causeOf` |
| Evidence: markers in view, examine by E, same refusal for another room or a nonexistent piece, reach, rate limit, shared journal by kind (never by type) | `rooms/identify.runtime` |
| Entries: need an examined piece, one line per ghost, final, wrong costs 20 once, a right one is identified, the reply never says which | `rooms/identify.runtime` |
| Right entry: that type's warning +40 ticks exactly, never shortened; gun recharge x0.75, no stacking | `ghost/identify`, `shared/identify` |
| Teaching line once per run at the first stage from 7; journal on a ghost stage (also stage 1,000,000); mark refused before any examine | `death/identify.room` |
| A living player gets the journal and only traces in view; a spectator's stage has neither | `death/identify.room`, `rooms/view` |
| Schemas accept `unknown`, intents are strict, the public journal has no field for the true type | `shared/identify` |
| Journal screen logic and the E prompt for traces | `client/journalLogic` |
| Earlier suites unchanged and green, including `death/solve`, `ghost/gun.solve`, `death/revive.gen`, `rooms/generate` | full server per-file run |

## 5. Deliberately changed existing assertions
None. (The old `GhostType` parameters on client `ghostShape` and `soundScheduler` became `PublicGhostKind`, a widening.)

## 6. Interfaces to preserve
`IDENTIFY_FROM_STAGE`, `PUBLIC_GHOST_KINDS`, `shownKind`, `JOURNAL`, `gunCooldown`, `EscapeRuntime.identified()`, `StageEngine.identifiedGhosts()`, `GhostHost.warningBonus`, the intents `examine` and `mark`, `EscapePublic.evidence/journal`. The five lock types, the 13-type pool, the draw order, the Revive Cell rule, `heard`/`inspect` events and `canKill`/`contactTicks`/`satiatedTicks` are untouched.

## 7. Known issues and limits
* The journal is one shared line per ghost and final, so a wrong guess on a one-ghost stage costs 20 points and gives up the bonus for that stage; the point drop itself tells a team it was wrong. With two ghosts (stage 20+) a team has two lines for three types.
* The evidence is learned only by examining; the field guide on the client is static lore (all types, all kinds), the same every stage.
* A dead (spectating) player sees no journal. The evidence markers are drawn plain; the look was not seen.
* An unnamed ghost uses one neutral footstep pace and timbre and a grey silhouette on the client; a Shade freezing in the light and a Howler's scream still tell the type.
* The teaching line is announced to everyone at the start of the first stage from 7 (once per Room object); a team that joins later would not see it again.
* The `mark` intent gives the bonus for any correct type; there is no way to take an entry back.
* Step 2's limits (stage table first cut, no newness weighting, nothing played in a browser) still stand.

## 8. Env vars, DB changes
None.

## 9. Files the next step may modify
Step 4 (curriculum, second ghost from stage 20, draft pick, loot room): `packages/server/src/rooms/generate.ts` (append draws after the puzzle pass), `shared/src/rooms/{puzzles,tables}.ts`, `shared/src/variety/*`, new draft and loot modules, the ghost lineup tables. Do not touch the frozen files above.

## 10. Outstanding acceptance criteria
Steps 4 to 6. For step 3 the open items are your own `npm ci`, typecheck, test and build run, and a look at the journal (J), the traces and the unnamed ghost in the browser.
