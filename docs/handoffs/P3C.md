# Handoff: P3C (Salvage, carrying, requirements and a real stage 1)

STATUS: delivered, with one specified item NOT implemented (generator items, section 6) and no human playtest findings recorded (section 6).
Read `docs/SALVAGE.md` (limits, keys, rules, how to play) and the P3C section of `docs/ARCHITECTURE.md` first.

## Feature support status (supported only if its tests passed)
Full suite on the developer's machine after step 3: client 68, server 757, shared 99 = **924 passed, 0 failed**, typecheck clean, build OK. Step 4 changed documents only (no code), so these numbers are unchanged.

| Feature | Status | Main tests |
|---|---|---|
| Carry slots (2), heavy parts (2 slots), drop, swap, hand over, rate gap and cooldowns | **Supported** | `server/test/salvage/items.test.ts`, `shared/test/salvage.test.ts` |
| Fit a part (install), multiset needs, wrong kind refused, spent-target refusal | **Supported** | `items.test.ts`, `needs.test.ts` |
| Needs exposed per clue clarity (easy / intermediate / hardcore), discovery by proximity | **Supported** | `needs.test.ts`, `shared/test/salvage.step2.test.ts` |
| Welder and interact gating on unmet needs | **Supported** | `needs.test.ts` |
| Hidden parts: revealed by the Scanner | **Supported** (engine level) | `needs.test.ts` |
| Hidden parts: revealed by opening a stash (locker, crate) | **Supported** | `needs.test.ts`, `hunt.solvability.test.ts` (real physics) |
| Stash kinds `panel` and `ceiling`, and `container` values other than the locker | **Schema and validator only**; no stage uses them and no test opens one | `validate.salvage.test.ts` (structure only) |
| Non-disclosure: hidden, destroyed and nonexistent ids give identical refusals; hidden items, decoy flag and rules never published | **Supported** | `items.test.ts`, `needs.test.ts` |
| Decoys: shatter with a score cost, `tell` shows `cracked` (not in hardcore) | **Supported** | `items.test.ts`, `needs.test.ts`, `hunt.solvability.test.ts` |
| Hazards destroy one carried part, grace period, shield stops it, fitted parts immune | **Supported** (engine level; the hunt never carries parts through its arc) | `needs.test.ts` |
| Disconnect and leave drop parts at the last safe footing | **Supported** | `items.test.ts` |
| Ability-gated spots (`gate`) | **Validator only**: accept/reject rules tested; no stage uses a gate and no bot run crosses one | `validate.salvage.test.ts` |
| Solo-safe validator (reachability by real physics, matching, trips) | **Supported** | `validate.salvage.test.ts`, `validate.items.test.ts` |
| Stage 1 hunt solvable by one player with 1, 2, 3 and 4 players in the room, within 2 slots | **Supported** | `server/test/salvage/hunt.solvability.test.ts` |
| Hunt: refusals, forced choice, cracked-coil penalty, co-op faster, not a checklist | **Supported** | `hunt.solvability.test.ts` |
| Opt-in stage-1 mapping (registry, `Room`, `RoomManager`); default stays the tutorial | **Supported** | `hunt.solvability.test.ts`, `hunt.loop.test.ts` |
| `createGameServer({ huntStage })` and env `HUNT_STAGE` | **Implemented, NOT tested** (no test builds the server with the option; the `RoomManager` it feeds is tested) | none |
| Endless loop after the hunt (stage 2 generated, validates, is cleared; stage 3 follows) | **Supported** | `hunt.loop.test.ts` |
| `item:action` protocol (Zod, errors) | **Supported** | `gateway.item.test.ts`, `room.item.test.ts`, `shared/test/salvage.test.ts` |
| Client view-model: slots, "Needs:" prompts, tones and shapes, key to intent, hand-over feedback | **Supported** | `client/test/itemView.test.ts` |
| Client drawing and key wiring (`ItemHud`, `ItemMarkers`, `itemDraw`, `GameScene`) | **NOT covered by automation**; played by the developer (see section 6) | none |
| Hand over between real players through the real simulation | **Engine level only**: no real-physics bot run hands a part over (the co-op test uses two players but no hand-over) | `items.test.ts` |
| Items in generated stages (generator items) | **NOT supported, not implemented** | none |
| Revive Cell, Coolant Cell, Valve Wheel, Access Key behaviour | **NOT supported**: the kinds exist, nothing uses them | none |

## 1. Git branch and commit hash
Branch `phase/p3c` (developer-reported). Step commits reported by the developer: step 1 not recorded here, step 2 `e01c7b8`; step 3 on `phase/p3c`.
Step 4 (documents only) commit: NOT RUN: developer to run `git rev-parse HEAD` after committing.

## 2. All files changed in this milestone (P3C, steps 1 to 4, against the pre-P3C base)
Modified (15): `docs/ARCHITECTURE.md`, `client/src/net/session.ts`, `client/src/palette.ts`, `client/src/scenes/GameScene.ts`, `server/src/config.ts`, `server/src/gateway.ts`, `server/src/main.ts`,
`server/src/room.ts`, `server/src/systems/{engine,registry,stageDef,validate}.ts`, `shared/src/index.ts`, `shared/src/protocol.ts`, `shared/src/systems/schemas.ts`.

Added (27):
* shared: `src/salvage/{index,public,specs}.ts`; tests `test/salvage.test.ts`, `test/salvage.step2.test.ts`
* server: `src/salvage/{reach,rest,system,validate}.ts`, `src/systems/stages/hunt.ts`; tests `test/gateway.item.test.ts`, `test/room.item.test.ts`,
  `test/salvage/{hunt.loop,hunt.solvability,items,needs,validate.items,validate.salvage}.test.ts`; helpers `test/helpers/{huntPlan,itemHarness}.ts`
* client: `src/ui/{ItemHud,ItemMarkers,itemDraw,itemView}.ts`; test `test/itemView.test.ts`
* docs: `docs/SALVAGE.md`, `docs/handoffs/P3C.md`

No file under `systems/tutorial.ts`, `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `shared/src/sim.ts`, `shared/src/arena.ts` or `client/src/sim/prediction.ts` was changed. No pre-P3C test or helper was modified.
Deliberately changed assertions: **none** in any pre-P3C test. (One assertion in a P3C step-1 test, "parts cannot be handled while channelling a repair" in `items.test.ts`, was changed inside P3C itself when the Welder became gated.)

## 3. Commands actually run, and their results
Developer's machine (as reported after each step): `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. Step 3: typecheck clean, **924 tests passed (client 68, server 757, shared 99)**, build OK, all earlier tests unchanged and green.
Earlier: step 1 825 tests; step 2 882 tests (commit `e01c7b8`), 758 older tests unchanged.
The Claude sandbox had no npm registry access. It used a local TypeScript 6.0.3, `tsx` and a minimal stand-in for vitest to run the new tests and to check typing of the shared and server packages (the only remaining errors were the missing `socket.io` and stand-in gaps, identical on the baseline),
and 8 + 13 + 10 deliberate mutations (change the code, confirm a test fails, restore) across steps 1 to 3. These sandbox runs are not a substitute for the developer's runs above.
Step 4: only `docs/SALVAGE.md`, `docs/ARCHITECTURE.md` and this file were written or edited. **NOT RUN** for step 4: `npm ci`, `npm run typecheck`, `npm test`, `npm run build` (nothing executable changed; the developer should still run them once on the commit).
**NOT RUN, ever:** an automated real-browser test (Phaser drawing, HUD layout, key wiring); real-GPU WebGL rendering; a session with 3 to 4 real browser tabs over a network; a load or soak test; the `gateway.*` tests in the Claude sandbox (they need `socket.io`; they ran on the developer's machine).

## 4. Tests passed, failed, not run
Passed: 924 of 924 on the developer's machine after step 3. Failed: none. Not run: the NOT RUN list in section 3 and every row marked NOT covered above.
Test groups added by P3C: item model and schemas; pick-up, drop, swap, hand-over, install rules and limits; byte-identical refusals for hidden, destroyed and nonexistent ids; needs per clarity; hiding and stashes; decoys and the score cost;
hazard loss; disconnect drops; validator (platform reachability by real physics, ability gates, matching, trips); the hunt through real physics for 1 to 4 players; the endless loop after the hunt; the client view-model.

## 5. Interfaces and contracts the next phase must preserve
* Protocol (additive, optional): client to server `item:action` (payload `ItemAction`, ack `{ ok, message }`); `StageState.items?: ItemsPublic` (`carrySlots`, `items`, `players`, optional `stashes`, optional `needs`).
  Item `state` is only `in_world | carried | installed`; `cracked?` is the only mark of a bad part; hidden, consumed and destroyed parts, the decoy flag and hidden rules are never published.
* Non-disclosure invariant: a hidden, destroyed or nonexistent part id, and an unrevealed or unknown target, get BYTE-IDENTICAL refusals (`NOTHING_THERE`, `NOT_CARRYING`, `NO_INSTALL_TARGET`). Gates (`gateMessage`) run only after the visibility and range checks.
* `ITEM_LIMITS` and `ITEM_KIND_SPECS` (`shared/src/salvage/specs.ts`) are the single source of truth for limits; `docs/SALVAGE.md` section 1 mirrors them.
* `StageDef.items`, `StageDef.needs`, `StageDef.stashes` (optional); `validateSalvage` is called from `validateStageDef`. A stage with none of them behaves exactly as before.
* `StageEngine` opts `{ revBase, arena, difficulty }` (difficulty drives clue clarity); `StageEngine.itemAction(playerId, action, pos)`; `ItemSystem` is owned by the engine and has a narrow host interface (like `AbilitySystem`).
* Tick order: `GameSim.step()` then `StageEngine.step(pos)`; the item system tracks the last safe footing in the engine step.
* `getStageDef(stage, seed, opts?: { hunt?: boolean })`, `HUNT_REGISTRY`, `STAGE_REGISTRY` (unchanged, `{1: tutorial}`); `Room` 4th parameter `{ lab?, hunt? }` (`lab` wins); `RoomManager({ briefingTicks, huntStage })` and `create({ lab, hunt })`;
  `createGameServer({ ..., huntStage })`; env `HUNT_STAGE` (`main.ts`: on unless `0`).
* Needs are on the target (breakpoint, conduit or entity); there is no objective-level gate and no new objective kind. Only the Flux Welder can be a required tool.
* Client: `Session.itemAction(action)`; `ui/itemView.ts` is the pure view-model (keep logic there, keep drawing in `ItemHud`, `ItemMarkers`, `itemDraw`). Keys E, G, F, H are in use; `GameScene` hint text lists the existing ones.
* The tutorial (`systems/tutorial.ts`) and `disasters/fallback.ts` (which clones it) must not gain items: the older tests rely on stage 1 being the tutorial by default.
* Frozen unless a documented migration updates server AND client prediction together: `shared/src/sim.ts`, `shared/src/arena.ts`, `client/src/sim/prediction.ts`, and `shared/test/helpers/simBaseline.ts` must never be edited.

## 6. Known bugs and incomplete work
* **Generator items are not implemented** (item 7 of the P3C prompt: items in one disaster generator). Stage 2 and later have no parts, needs or stashes. Adding them risks the generator solvability and determinism tests, so it was left for a deliberate change.
* **No human playtest findings are recorded.** The developer reported playing the new stage 1 after step 3, but the playtest notes field in that report was left as the unfilled template text ("what you liked, what felt confusing, whether it was too easy"), so this handoff records no findings about difficulty, clarity or readability. Treat the stage's balance and the HUD placement (carry slots bottom right, prompt above the tool row) as unverified.
* The hunt is solved in the tests by one player in a fixed order; how long a first-time human takes, and whether the hidden locker is findable without the easy-mode hint, is unknown.
* The Phaser drawing and key wiring have no automated test. `ItemMarkers` text labels and the bottom prompt could overlap other HUD text on some screens; not checked.
* `createGameServer({ huntStage })` and `HUNT_STAGE` are untested (see the table).
* Parts do not cross stages: a stage change builds a fresh item state (tested for the hunt to stage 2).
* Hand-over, hazard loss and ability gates are proven by engine and validator tests, not by a real-physics bot run, because no authored stage exercises them.
* A decoy without a tell is indistinguishable by design; at hardcore even a tell is hidden, so a hardcore player can lose a part only by trying it.
* Real-GPU WebGL rendering and 3 to 4 browser tabs were never exercised.

## 7. Environment variables required (names only)
`PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `ABILITY_LAB` (existing, optional); `HUNT_STAGE` (new, optional, `0` or `1`; the dev server defaults to the hunt, `0` restores the tutorial as stage 1).

## 8. Database or migration changes
None (there is no persistence yet).

## 9. The exact files the next milestone (P3D: physical disasters, deduction and combinations) may modify
* May add: `shared/src/disasters/**`, `server/src/disasters/**`, new stages under `server/src/systems/stages/**` and their registration in `server/src/systems/registry.ts` (additively; keep `STAGE_REGISTRY` and `HUNT_REGISTRY` entries), new tests and helpers as new files.
* May extend additively (optional fields, defaults keep old behaviour): `server/src/systems/{stageDef,engine,validate}.ts`, `shared/src/systems/{tools,schemas}.ts`, `shared/src/protocol.ts`, `shared/src/index.ts`, `server/src/{room,gateway}.ts`,
  `server/src/salvage/**`, `shared/src/salvage/**` (new kinds, new needs rules; never change an existing limit's meaning), `client/src/ui/**`, `client/src/scenes/GameScene.ts`, `docs/SALVAGE.md`, `docs/ABILITIES.md`, `docs/ARCHITECTURE.md`, and a new `docs/handoffs/P3D.md`.
* To add items to generated stages it must also extend the generator tests rather than edit them, and re-prove every generated stage with the real-physics bot for 1 to 4 players.
* Never touch: `phases.ts`, `difficulty.ts`, `loop.ts`, `interpolation.ts`, `tutorial.ts`, any existing test, `shared/test/helpers/simBaseline.ts`, or another phase's handoff.
* Frozen unless a documented migration updates server AND client prediction together: `shared/src/sim.ts`, `shared/src/arena.ts`, `client/src/sim/prediction.ts`.
* Out of scope until their phases: health and death (P4), rooms (P4B), OpenAI (P5), persistence (P6).

## 10. Acceptance criteria still outstanding
* Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on the developer's machine for the step 4 commit (expected: 924 tests, no change from step 3) and record the commit hash with `git rev-parse HEAD`.
* Decide whether generator items (item 7) are required for P3C; if so it is a separate task with its own solvability proof.
* A written human playtest of the hunt (findings were not provided) and a multi-tab session with 2 to 4 real players: hand-over, the cracked-part tell, HUD readability, and whether the stage is too easy.
* Add tests for `createGameServer({ huntStage })` / `HUNT_STAGE`, or accept it as untested.
* Decide whether to keep the hunt as the dev default for stage 1 or make it the real stage 1 (which would require deliberate changes to the older tests that expect the tutorial).
