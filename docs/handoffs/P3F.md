# P3F handoff: variety and hook (STEPS 1 AND 2 of 6 delivered: room templates and height; the puzzle pool)

Baseline: `p4-complete` plus the step 6 playtest fixes (the uploaded `p5-base.zip`). Step 1 was verified by the developer: commit `927d8be` on `phase/p3f`, typecheck clean, 1578 tests (client 198, server 1204, shared 176), build OK. Steps 3 to 6 are not started; this file is rewritten at each step.

## 1. Git branch and commit
Branch `phase/p3f`. Step 1: `927d8be` (reported by the developer). Step 2: NOT RUN: developer to run `git rev-parse HEAD`. (No `.git` in my sandbox.)

## 2. Files changed
### Step 2 (this delivery)
Added: `packages/shared/src/rooms/puzzles.ts`, `packages/server/src/rooms/puzzleBuild.ts`; tests `packages/shared/test/puzzles.test.ts`, `packages/server/test/rooms/{puzzles.runtime,puzzles.generate,puzzles.solve}.test.ts`.
Modified: `packages/shared/src/rooms/{escape,index}.ts` (13 lock types, `needText`, new limits, `maxSwitches` 10 to 24); `packages/server/src/rooms/{escape,escapeSpec,escapeValidate,generate}.ts`; `packages/server/src/salvage/system.ts` (a jammed container needs a tool); `packages/server/src/systems/stageDef.ts` (optional `needs` on a stash); `docs/{VARIETY,ARCHITECTURE}.md`; this file.
Test files changed on purpose: `test/rooms/{generate,solve}.test.ts` (see section 5) and the solver `test/rooms/solver.ts` (plays the 8 new types).
Not touched: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`. No client file changed: the public state keeps its shape (levers, breakers, plates and sensors are `switches`, pictures and legends are `clues`).
### Step 1 (verified by the developer)
See the step 1 list in git (templates, `reachStrict`, `arenaKey`, `dropRest` pieces, `requireReachable`, their tests).

## 3. Commands run (my sandbox; no registry, so `npm ci` cannot run and I use a stand-in test runner)
* Typecheck (`tsc`, shared and server): 0 errors except one in `test/disasters/runtime.test.ts` (TS7053), a file nobody touched, which I believe is an artefact of my stand-in; your real `npm run typecheck` is the judge.
* Shared: 20 files, **181** passed (176 + 5).
* Server: 77 files, **1212** passed, 0 failed (gateway files excluded; your 1204 includes 47 gateway tests, so expect about **1259** with my 55 new ones).
* Client: **198** passed (no client change).
* Expected total on your machine: 181 + 1259 + 198 = **1638** (was 1578).
* NOT RUN: `npm ci`, `npm run build`, the 8 gateway test files, the client typecheck, any play in a browser or Phaser.

## 4. What is supported, and the tests behind it
| Claim | Tests |
|---|---|
| 13 lock types: the five originals unchanged, eight new (lever sequence, symbol match across two rooms, flashlight sensor, pressure plates, timed switch, breaker panel, wiring, tool key with a jammed locker) | `shared/test/puzzles`, `puzzles.generate` |
| Rules of each puzzle (order, reset, lockout, trip, hold, window, sensor light time, decoy sensors, jammed locker, cracked tool) | `puzzles.runtime` (17), `puzzles.solve` (jammed locker in a real Room) |
| Every type is SOLVED by the real-physics solver reading the notes, alone and with 2 players; sweeps of 144 solo and 54 co-op stages (stages 6 to 1,000,000, 2 to 4 players) | `puzzles.solve` |
| Never the same lock type twice in a row (neighbouring doors) on 1,000+ doors of 25 stages x 20 seeds, with and without the ghost, stage 1,000,000 included | `puzzles.generate` |
| Clue text states the goal and never the method (30 instruction verbs banned in every note and refusal of every generated stage); superseded decoy notes are never accepted; sensors have dead twins; tool lockers have cracked tools | `puzzles.generate`, `shared/test/puzzles` |
| A mandatory safe keeps all its code pages in its own room (kept, re-checked over the new pool) | `puzzles.generate`, `rooms/safes` |
| Draw order kept: the stage with `puzzles: false` is the stage the original draws make; every link that kept its lock, the rooms, the exit and the hiding spots are equal; stages 1 to 5 never change; `death/revive.gen` green | `puzzles.generate`, `death/revive.gen` |
| Every lock has a validator rule that refuses a broken instance (a mutation per type, an orphan switch, a shared switch) | `puzzles.generate` |
| Ghost runs (hiding reflex, two ghosts, strict death drills) still clear stages that hold the new puzzles | `ghost/gun.solve`, `death/solve` |

## 5. Deliberately changed existing assertions and helpers (step 2)
* `test/rooms/generate.test.ts`: the lock types allowed on a stage are now `locksForStage` plus `puzzlesForStage`; "all five originals occur" replaces "exactly these five occur"; a decoy part may also be a `valve_wheel` (a cracked tool).
* `test/rooms/solve.test.ts`: the "every one of the five lock types" loop runs until the FIVE ORIGINAL types were solved (`Set<string>`), since a door may now hold a puzzle.
* `test/rooms/solver.ts`: new branches for the eight puzzles (it reads the notes as a player does); the lone player drops the valve wheel before taking the key (a player who also carries the Pulse Gun has only two hands) and waits out the 10-tick hand cooldown.
* Step 1's list (hiding spacing at one height only, STRICT 4a/4b, STRICT 2 threshold 80) is unchanged.

## 6. Interfaces to preserve
`LOCK_TYPES` (the five, unchanged), `locksForStage`, `PUZZLE_TYPES`, `ANY_LOCK_TYPES`, `puzzlesForStage`, `puzzleChance`, `needText` (all 13), the `Lock` union, `StashDef.needs`, `GenerateOptions.puzzles`, `buildPuzzle`, `switchIdsOf`, `clearRun`, `EscapeRuntime.pressPuzzle/stepPuzzles`. The generator draws the puzzle pass AFTER every earlier draw: a later step must append its own draws after it. Revive Cell rule, `heard`/`inspect` events, `canKill`/`contactTicks`/`satiatedTicks` untouched.

## 7. Known issues and limits
* The "same lock type twice in a row" rule is tested for NEIGHBOURING DOORS of one stage. The HOOK rule "no stage repeats the previous stage's lock type" needs the newness weighting of step 4 (the early stages have only 3 to 5 types available) and is not implemented.
* The stage table is a first cut (breaker 6, timed 7, plates 8, wiring and sensor 9, levers 11, tool key 12, symbols 14, chance 40 to 75 percent). Step 4 replaces it with the curriculum in docs/HOOK.md.
* Without the ghost option the flashlight has no cone, so a sensor lights whenever it is in view. With it, the player's aim counts, but my bots never aim, so the cone itself is not exercised by the solver.
* A body lying on a plate keeps it lit (a dead teammate can hold a plate).
* A breaker panel has at most 16 states; brute force is bounded only by the trip rule.
* Nothing is verified in a browser. Rooms of the early stages (1 to 5) are unchanged; the hall rooms of even stages keep the flat layout.
* Test time: `death/solve` about 190 s and `rooms/generate` about 100 s in my sandbox.

## 8. Env vars, DB changes
None.

## 9. Files the next step may modify
Step 3 (identify-the-ghost): `death/review.ts` (hide the ghost type only), the ghost evidence modules, shared protocol additions for the journal, new tests. Step 4 (curriculum, second ghost, draft, loot): `packages/server/src/rooms/generate.ts` (append draws after the puzzle pass), `shared/src/rooms/{puzzles,tables}.ts`, `shared/src/variety/*`, new draft and loot modules. Do not touch the frozen files above.

## 10. Outstanding acceptance criteria
Steps 3 to 6. For step 2 the only open item is your own `npm ci`, typecheck, test and build run.
