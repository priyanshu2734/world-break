# Handoff: P3B (Reality abilities and the physics migration)

> STATUS: steps 1, 2 and 3 are implemented and verified by the commands below. **Step 4 (docs/ABILITIES.md limits table and the final
> version of this handoff) is NOT done yet.** This file is the working handoff after step 3.

## How to open the Ability Lab in your browser
The Lab is a dev-only stage. It needs a flag on the server AND a URL parameter on the client.

1. Start the server with `ABILITY_LAB=1` (its log prints `Ability Lab: ON, open /?lab=1`):
   * bash / zsh / Git Bash: `ABILITY_LAB=1 npm run dev:server`
   * PowerShell: `$env:ABILITY_LAB = "1"; npm run dev:server`
   * cmd.exe: `set ABILITY_LAB=1 && npm run dev:server`
2. Start the client as usual: `npm run dev:client`.
3. Open **http://localhost:5173/?lab=1**. This CREATES a new room as an Ability Lab room (the lobby shows `ABILITY LAB (dev)`). Press Enter to start.
4. Other players join that room with its code as usual (`http://localhost:5173/#CODE`; no `?lab=1` needed). Up to 4 players.

Rules: the flag is honoured only when a room is CREATED. If the server was not started with `ABILITY_LAB=1`, `?lab=1` shows
"The Ability Lab is not enabled on this server (start it with ABILITY_LAB=1)." and creates nothing. Without `?lab=1` you get the normal game.
The Lab is stage 1 of that room; "next stage" (host) after finishing it continues with the normal stage 2 on Relay Platform 01. Hold R (host)
resets the Lab. Controls: 1-5 tools, 6 Gravity Well (Shift = low gravity instead of flipped), 7 Freeze, 8 Duplicate, 9 Momentum (Shift = stop).
The mouse aims. These controls are untested in a real browser (see section 6).

### Solving it (spoilers; the six stations are independent)
| Station | What to do |
|---|---|
| Capacitors (o_charge) | Scanner (1), then Welder (2) on the drained capacitor on the low platform at the left. Each repair refills everyone's Reality Energy by 30. |
| Anchor console (o_anchor) | Plant an Anchor (3) next to the console on that same platform, then channel the console with E. |
| Freeze console (o_freeze) | On the floor, under the arcs. Freeze (7) the arc, then channel with E straight away (a freeze lasts 3 s, the channel needs 2.25 s). |
| Ledge plate (o_well) | Stand on the far-right platform. Put the mouse about 150 px above you and a little left (the well must contain your body), press 6, ride it up without moving, then steer left onto the ledge. |
| Island plate (o_momentum) | Climb to the upper-left platform with the crate. Stand beside it, put the mouse on the crate, hold Left (or A) and press 9. The crate flies left onto the island and slides to the wall. |
| Two heavy plates (o_dup) | Stand between the plates on the right platform, mouse on the empty plate, press 8: the copy lands there while the original holds the other plate. |

Energy: well 30 + momentum 20 + duplicate 30 + freeze 25 = 105 > 100, so at least one repair is required. Nothing else regenerates energy.

## 1. Git branch and commit hash
NOT RUN: developer to run `git rev-parse HEAD`. (Steps 1 and 2 are the developer's commits 8c54b87 and 4cadaac on `phase/p3b`; the sandbox that
produced step 3 used its own throw-away git history only to list changed files.)

## 2. Files changed in step 3
12 added, 17 modified. Modified: `docs/ARCHITECTURE.md`, `client/src/{net/session,scenes/GameScene,scenes/LobbyScene,sim/prediction,ui/StageView}.ts`,
`server/src/{config,gateway,main,room}.ts`, `server/src/systems/{engine,stageDef,validate}.ts`, `shared/src/{protocol,systems/schemas}.ts`,
`shared/src/abilities/{index,specs}.ts`. Added: `shared/src/abilities/labArena.ts`, `server/src/systems/stages/abilityLab.ts`, `client/src/net/labParam.ts`,
`docs/handoffs/P3B.md`, and tests/helpers: `server/test/abilities/{duplicate,lab.solvability,lab.room,fuzz.room,validate.p3b}.test.ts`,
`server/test/gateway.lab.test.ts`, `server/test/helpers/{labBot,labHarness}.ts`, `client/test/labParam.test.ts`.
**No existing test or helper file was modified** (`git diff --name-status` shows only `A` under any `test/` directory).

## 3. Commands actually run (in the sandbox, real results)
* `npm run typecheck`: 0 errors (shared, server, client; tests are inside each package's `include`, so they were type-checked too).
* `npm test`: client 43 passed, server 629 passed, shared 86 passed = **758 passed, 0 failed** (was 689 after step 2).
* `npm run build`: OK (the existing Vite chunk-size warning only).
* Smoke test of the real entry point: `main.ts` started with `ABILITY_LAB=1` and again without; a real socket.io client confirmed
  flag on + `lab:true` = Ability Lab room (arena `ability-lab-01`, stage "Reality Calibration", crates, five abilities); flag on, no `lab` =
  normal game ("Cold Start", `relay-platform-01`); flag off + `lab:true` = the error above.
* Mutation checks (change the code, confirm a test fails, restore): arc period 30 -> 100 (caught), ledge 140 -> 200 (caught by the
  physics probe), island plate made light (caught). Two of these first exposed weak tests (a probe with hard-coded numbers, no test for the
  island plate); both were fixed before this report.
NOT RUN: any real browser (Phaser rendering, the HUD, mouse aiming, plate/zone drawing), `git rev-parse HEAD`, a human playtest.

## 4. Tests passed / failed / not run
Passed: all of the above. Failed: none. Not run: see the NOT RUN list.
New in step 3: solvability of the Lab through Room -> GameSim -> PhysicsWorld -> StageEngine for 1, 2, 3 and 4 bots; for each ability the
other stations are solved while that one stays open; bounded exhaustive probes (~14,000 jump + impulse combinations never reach the ledge; a
control proves the probe can find it when a well exists); Duplicate and plate rules; Lab isolation from the rotation; gateway/config/URL flag;
a 4-player fuzz (random abilities, bogus targets) checking finite, in bounds, outside solids and every cap after every tick; validator rules.

## 5. Interfaces and contracts the next phase must preserve
* From steps 1-2 (unchanged): `ability:use`, `GameSnapshot.world?`, `StageState.abilities?`, `stepBody(..., world?)`, `worldForTick`, `PredictionWorldCtx`.
* Step 3: `JoinPayload.lab?: boolean` (creation only), `RoomSnapshot.lab?: true`, env `ABILITY_LAB` (`'0'|'1'`).
* `pressure_plate` entity (`activatedBy: 'any' | 'object'`), only as `timed_controls` controls with `armTicks: 1`.
* `getArena(id)`, `ABILITY_LAB_ARENA(_ID)`, `GameSim.loadArena`, `LocalPredictor.setArena`; `Room` 4th constructor parameter `{ lab?: boolean }`;
  `RoomManager.create({ lab })`; `createGameServer({ abilityLab })`.
* `StageEngine.attachWorld(world)` must be called by whoever builds an engine that has props or abilities (Room does).

## 6. Known bugs and incomplete work
* Step 4 not done: docs/ABILITIES.md, the final handoff.
* "Required" is proven for the intended mechanics only (see the tests above). It is NOT a proof that no exotic multi-ability chain exists, for
  example lifting a crate with a flipped well and pushing it with several Momentum shoves to avoid a Duplicate.
* Clones hold plates. "Block a beam" is NOT implemented (there are no beams in P3B).
* The island crate only reaches the island if shoved from near its authored spot (x 340-378 works). A wrong shove needs a reset (hold R, host)
  or a Duplicate of the crate.
* A player can jump from the upper-left platform to the island (the plate ignores players, so this does not matter for the objective).
* Abilities are ON for every generated stage (N >= 2) via `ABILITIES_IN_ROTATION` (server/src/abilities/defaults.ts); set it to false to restrict
  abilities to the Lab. Generated stages have no props, so Duplicate has nothing to copy there.
* Browser-side presentation is unverified (HUD layout, aiming, plate drawing, zone drawing).

## 7. Environment variables
`PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL` (existing), `ABILITY_LAB` (new, `0` or `1`, dev only).

## 8. Database or migration changes
None (no persistence).

## 9. Files the next milestone may modify
Step 4 only: `docs/ABILITIES.md` (new), `docs/ARCHITECTURE.md`, `docs/handoffs/P3B.md`. Code only to fix a release-blocking issue.

## 10. Acceptance criteria still outstanding
* Step 4 documents; a final full-repo run on the developer's machine.
* A human playtest of the Lab in a browser (the presentation layer and the controls above are untested).
