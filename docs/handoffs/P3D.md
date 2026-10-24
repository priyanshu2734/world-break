# Handoff: P3D, the escape-room foundation

Phase: P3D (rooms, doors and locks, exit, darkness, server-side vision, minimal HUD, seeded generator). Baseline: tag `p3c-complete` (924 tests). Written at the end of step 5.
Nothing below is marked supported unless a test that passed backs it; what only a human or a browser run checked is labelled that way.

## 1. Git branch and commit hash

Branch: `phase/p3d` (as reported by the maintainer after each step). Commit hash: **NOT RUN: developer to run `git rev-parse HEAD`** (the working copy this was built in is not a git repository).

## 2. All files changed in this milestone

Modified (18): `docs/ARCHITECTURE.md`; client `net/session.ts`, `scenes/GameScene.ts`, `scenes/LobbyScene.ts`, `ui/StageHud.ts`; server `config.ts`, `game.ts`, `gateway.ts`, `main.ts`, `room.ts`, `salvage/system.ts`, `systems/engine.ts`, `systems/stageDef.ts`, `systems/validate.ts`; shared `index.ts`, `protocol.ts`, `salvage/public.ts`, `systems/schemas.ts`.

Added, source (22):
* shared `src/rooms/`: `ambient.ts`, `escape.ts`, `graph.ts`, `index.ts`, `limits.ts`, `schemas.ts`, `tables.ts`, `vision.ts`
* server `src/rooms/`: `demoStage.ts`, `escape.ts`, `escapeSpec.ts`, `escapeValidate.ts`, `generate.ts`, `stageBase.ts`, `view.ts`
* client `src/ui/`: `CodePad.ts`, `Darkness.ts`, `DoorView.ts`, `EscapeView.ts`, `darkParam.ts`, `escapeUse.ts`, `roomMath.ts`

Added, tests and test helpers (21): shared `test/ambient.test.ts`, `rooms.test.ts`, `tables.test.ts`, `vision.test.ts`; server `test/gateway.rooms.test.ts`, `test/rooms/{bot,flows,solver}.ts` (helpers) and `test/rooms/{darkness,escape,generate,graph,room,sim,solve,view}.test.ts`; client `test/{darkParam,darkness,escape,hud,rooms}.test.ts`.
Added, docs (2): `docs/ROOMS.md`, this file.

No old test file was edited. `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts` and client `prediction.ts` were not touched.

## 3. Commands actually run and their results

| Command | Result |
|---|---|
| `npm ci` | succeeded (the registry was reachable) |
| `npm run typecheck` (all three packages) | 0 errors |
| `npm test` | client 115, server 861, shared 127 passed, 0 failed |
| `npm run build` | succeeded |
| Headless Chromium (Playwright, canvas renderer) scripted sessions against `npm run dev:server` and `npm run dev:client` | the 3-room mini escape played to the end with real keys (locker, key, door, wrong then right code on the pad, second door, exit, stage cleared); the 6-room sampler through its first rooms; the DEFAULT start (no flags) played the generated tutorial (locker, key, gate, alcove, exit) and the next stage was a generated stage 2; two tabs: the far player leaves the other's screen and stays on the team list; the ordinary hunt stage was checked in a browser at step 4 (before the generator became the default stage 1) and looked and behaved as before, but was NOT re-checked in a browser with `ESCAPE_STAGES=0` at step 5 |

## 4. Tests passed, failed, not run

Passed: 1,103 of 1,103 (baseline 924, +179). Failed: none. Each claim below names its tests.

| Feature | Supported? | Evidence |
|---|---|---|
| Stage-driven ambient (table, published by the server, tutorial floor) | yes | shared `ambient`, `tables`; server `rooms/darkness`, `rooms/generate` (stages 1, 10, 100, 1,000,000 in all modes); client `darkness`, `darkParam` |
| Darkness view (cone, radius light, in-light assist, dev keys behind `dev=1`) | yes for the pure parameters; rendering checked by headless screenshots only | client `darkParam`, `darkness`, `hud` |
| Rooms: graph, per-room arena, camera, transitions, room id in the snapshot | yes | server `rooms/graph`, `rooms/sim` (parity with `stepBody` across a door), `rooms/room`, `gateway.rooms`; client `rooms` (predictor parity per room arena); shared `rooms`, `tables` (gates) |
| Doors open with E after a delay, drift cancels, not by touch | yes | server `rooms/escape` |
| Five lock types (key, code, power, two-person, safe) incl. decoys, 2 slots, lockouts | yes | server `rooms/escape`, `rooms/solve` (every type solved alone and co-op on GENERATED stages) |
| Exit and clear rule through the existing STAGE_CLEAR transition | yes | server `rooms/escape`, `rooms/solve` (the rest of the team continues; real `nextStage`) |
| Server-side visibility (radius, line of sight, closed doors; per-player snapshot and stage state) | yes | server `rooms/view` (hidden part, other rooms, radius, platform LOS, teammates, inventories, feed by room, spectator view, closed-door fixture), `gateway.rooms` (per-socket views, rising `rev`, no flooding); shared `vision` |
| Refusals byte-identical for hidden, out-of-view and nonexistent things | yes | server `rooms/view`, `rooms/escape` |
| Minimal HUD (no objectives, tool bar, ability bar; goal line, hands, notes, keys) | pure parts yes (`goalLine`, keys, notes, per-room state); the drawn result was checked by headless screenshots only | client `hud`, `escape` |
| Seeded generator for every stage, tables, endless loop | yes | server `rooms/generate` (840 stage/seed pairs valid on the FIRST attempt, determinism, tutorial shape, no repeated lock type, decoys, hiding spots, 1,000,000), `rooms/solve` (endless loop through real `nextStage`) |
| Solvable by 1 player within 2 slots, and by 2 to 4 players, over many seeds, real physics | yes | server `rooms/solve`: 240 early stages, 96 table stages up to 1,000,000, 81 co-op stages (2, 3, 4 players) |
| `ESCAPE_STAGES` on by default for the dev server, `0` restores the old behaviour | yes at Room and gateway level; the env variable path through `main.ts` was only run in the ON (default) state | server `rooms/solve` ("ESCAPE_STAGES off" block), `gateway.rooms` (refusal when off) |

Not run: see section 10.

## 5. Interfaces and contracts the next phase must preserve

* **Room id is its arena id**, unique per stage (generated ids contain the stage number and a seed hash). The client keys layouts by it.
* **Protocol (all additive and optional):** event `room:layout` (to ONE player: walls and doorways of their room, never destinations), event `escape:action` (`use_door`, `enter_code`, `press`, `read`), join flag `rooms` (true or 2, dev only, creation only), `GamePlayer.roomId`, `GameSnapshot.team`, `StageState.darkness`, `StageState.escape`, feed `room`, `ItemsPublic` `roomId`.
* **The visibility invariant:** on an escape stage a client is sent only what is in its view; nothing hidden is merely not drawn. All of it goes through `restrictedView(source, { eyes, self })` (`server/src/rooms/view.ts`); spectating (P4) is another `eyes` with `self: null`. Any new entity (the ghost, pings) must be added to that function and to `POINT_HEIGHT` and gets a test that it is absent when not in view.
* **Refusal uniformity:** anything hidden, out of view, in another room or nonexistent answers `Nothing there.`; only a visible thing out of reach answers `Too far away.` (`ItemHost.canSee`, `EscapeHost.canSee`).
* **Per-player stage state:** the gateway re-sends a player's stage state when THEIR view differs (compared without `tick` and `rev`); `rev` is kept strictly rising per player.
* **The generator is deterministic in `(stage, seed)`** and its first attempt must stay valid; `generateEscapeStage` is the only producer of escape stages in the loop. Tables live in shared `tables.ts`, `ambient.ts`, `vision.ts`, `limits.ts`; change numbers there and in `docs/ROOMS.md` together.
* **`GameSim` rooms API:** `loadRooms`, `sendThrough`, `doorGate`, `touchDoors`, `drainTransitions`, `roomOf`; a player is in one room; the physical world (props, zones) belongs to the start room.
* **`EscapeRuntime` / `EscapeHost`** is the seam for door, lock and exit rules; `StageEngine.clearStage` is how a non-objective rule clears a stage (the existing STAGE_CLEAR path; `phases.ts` stays frozen).
* **Items:** `ItemDef.room` and `StashDef.room`, `ItemSystem.consumeCarried`, 2 hand slots, decoys destroyed by locks.
* **Never the same lock type twice in a row; clue digits spell their codes; everything a lock needs is on its near side** (`validateEscape`).
* The Ability Lab and every pre-P3D stage still work with `ESCAPE_STAGES=0` and in every pre-existing test.

## 6. Known bugs and incomplete work

* The server does not know where the flashlight points (aim is client-side), so it publishes everything within the vision radius with line of sight, not only the lit cone. Sending the aim angle with input would narrow it. Documented, not done.
* Breather and Major Breach stages (GAMEPLAY.md section 4) are not implemented; the generator follows only the room, lock, decoy and ambient tables.
* The hiding spots for the ghost are placeholders: stored in the spec, validated to stand on a floor, never published, never read by anything.
* Escape stages have no failure state: running out of time only drains score (the old expiry rules), because death, the ghost and revive are later phases. The deadline is (5 + 3 x rooms) minutes.
* Clue text is kept as notes on the reader's client only; a page reload loses the notes (rejoining a running game is not supported anyway).
* The old "HANDS 0/2" slots in the bottom right can overlap a world object there (seen once over the tutorial exit). Layout polish, no art pass was done.
* Touching a door opens it only in the step-2 `GameSim` mode (`touchDoors` true), which no generated or dev stage uses; it remains because its tests (and a possible future mode) exist.
* The solver proves reachability by one scripted strategy plus structural validation; it is not an exhaustive search. Platform geometry assumptions it relies on: steps of 90 px up with gaps of at most 95 px.
* `HUNT_STAGE` and the old stage 2+ generator are ignored while `ESCAPE_STAGES` is on.
* The bottom hint in escape stages marks Q (ping) and Tab (team panel) as "soon": placeholders.

## 7. Environment variables required (names only)

`PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL` (existing, optional), `ABILITY_LAB` (existing), `HUNT_STAGE` (existing, `0` to disable), **`ESCAPE_STAGES`** (new: unset or `1` = on, `0` = previous behaviour).

## 8. Database or migration changes

None. No persistence exists. The shared schema changes are all optional additions (see section 5); the migration notes for arena-per-room are in `docs/ARCHITECTURE.md` ("P3D migration").

## 9. The exact files the next milestone (P3E, the ghost) may modify

New: `shared/src/ghost/**`, `server/src/ghost/**`, `client/src/ui/ghost/**`, and tests for them.
Additive edits only, with their tests extended (not changed): `server/src/room.ts` (a tick hook and the drain of ghost events), `server/src/rooms/view.ts` (ghost visibility, using `POINT_HEIGHT`), `server/src/rooms/escape.ts` (the host seam, e.g. a stun or a hide), `server/src/rooms/generate.ts` and `escapeSpec.ts` (consume `hidingSpots`, ghost spawn), `server/src/systems/engine.ts`, `stageDef.ts`, `validate.ts` (additive fields and checks), `server/src/game.ts`, `gateway.ts`, `shared/src/protocol.ts`, `shared/src/systems/schemas.ts`, `shared/src/index.ts`, `shared/src/rooms/limits.ts` and `tables.ts` (new limits), `client/src/scenes/GameScene.ts`, `client/src/ui/EscapeView.ts`, `client/src/ui/StageHud.ts`, `client/src/net/session.ts`.
Do not edit: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, shared `sim.ts`, `arena.ts`, client `prediction.ts`, or any existing test.

## 10. Acceptance criteria still outstanding

* **Not run (nothing here was verified, say so before relying on it):** the WebGL renderer and any real GPU (every browser run used the canvas renderer in headless Chromium); Firefox, Safari and mobile browsers; real network latency and more than four simultaneous clients; a long real-time soak of many stages in one room; `npm audit` fixes; the server process started with `ESCAPE_STAGES=0` from the environment, and the old hunt stage in a browser with it (the option is tested at Room and gateway level; `main.ts` and the browser only ran in the default ON state at step 5); the commit hash.
* **Needs a human:** the feel of the numbers (ambient, vision radius, stage times, lockout length), the look of the dark view and the HUD, and whether stage 1 teaches well; these are tuned by playtest, in the tables named in `docs/ROOMS.md`.
* **Belongs to later phases:** the ghost and stun gun (P3E), disasters inside escape stages (P3F), death, revive and spectating (P4), chat and ping, OpenAI direction, persistence, art.
