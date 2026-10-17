# Prompts for P3B and P3C (v2). Later phases are written when you reach them, from the previous real handoff.

How to use: new chat -> upload `p3b-base.zip` (made from the latest git tag) -> paste ONE prompt below -> paste the HANDOFF FOOTER
from `docs/PHASE_PROMPTS.md` at the end. If the session cannot run npm, tell it to deliver in the steps listed and give you a
changed-files zip after each step; you run the checks and paste errors back.

---------------------------------------------------------------------------
## P3B: REALITY ABILITIES AND THE PHYSICS MIGRATION
Read CLAUDE.md, docs/GAMEPLAY.md, docs/ARCHITECTURE.md, docs/DISASTERS.md, docs/handoffs/P2.md, docs/handoffs/P3A.md, then the real code:
shared/src/{sim,arena,protocol,phases}.ts, client/src/sim/prediction.ts, server/src/{game,room,gateway}.ts, server/src/systems/*,
server/src/disasters/*, client scenes/ui and all tests. Preserve P0 to P3A (578 tests must keep passing).

GOAL: give players five fun, bounded reality abilities that change how the world behaves, and make some of them physical.
Abilities: Gravity Well, Freeze, Duplicate, Momentum, Anchor placement (reuse the P2 Gravity Anchor tool; add placement rules only).
Shared per-player **Reality Energy** meter: capped, costs per ability, regenerates when the team completes repairs. Defaults in GAMEPLAY.md
section 4; tune them in tests. Every ability has cost, cooldown, duration, per-player and per-room caps, range, server validation
(ownership, range, cooldown, energy, rate limit). No unbounded objects. No NaN, out-of-bounds or stuck-in-solid physics states.

PHYSICS RULE (critical). The movement step in shared/src/sim.ts is shared by the server and by client prediction and must stay bit-exact.
Implement gravity zones and momentum as DATA that the server puts into the public snapshot (zone id, rectangle, gravity vector, expiry tick;
impulse events with tick) and add an OPTIONAL parameter to the shared step function (default = current behaviour). Update server AND client
prediction to apply the same function with the same data. All existing sim/prediction/interpolation tests must pass unchanged. Add parity tests
(server step vs client prediction over many ticks with random inputs and active zones), plus a documented migration note in ARCHITECTURE.md.

DELIVER IN 4 STEPS (zip after each step):
1. Ability framework: protocol additions (additive), server ability engine (validation, energy, cooldowns, caps), Anchor placement,
   Freeze (objects and hazards), HUD for energy and ability slots, tests.
2. Physics: gravity zones and momentum with the shared-step migration, prediction parity tests, bounds and sanity tests.
3. Duplicate (bounded clones that can hold pressure plates and block things), plus an hand-authored "Ability Lab" stage (not in the endless rotation;
   reachable with a dev flag or URL param) where each ability is REQUIRED at least once. Real-physics solvability bot for 1 to 4 players.
4. Docs: docs/ABILITIES.md (limits table), update ARCHITECTURE.md, handoff docs/handoffs/P3B.md. Mark an ability supported only after tests pass.
OUT OF SCOPE: new disasters, combinations (P3C), health/death (P4), rooms (P4B), OpenAI, persistence, lobby/network redesign.
Files you may modify: add under shared/src/abilities/**, server/src/abilities/**, server/src/systems/stages/** (Ability Lab), client/src/ui/**;
additive edits to protocol.ts, index.ts, room.ts, gateway.ts, game.ts, engine.ts, stageDef.ts, validate.ts, schemas.ts, session.ts, GameScene.ts;
sim.ts and arena.ts and prediction.ts ONLY via the documented additive migration. Do not touch phases.ts, difficulty.ts, loop.ts, old tests.

---------------------------------------------------------------------------
## P3C: PHYSICAL DISASTERS, SIGNATURE VERBS, DEDUCTION AND COMBINATIONS
Preconditions: P3B merged and tagged. Read CLAUDE.md, docs/GAMEPLAY.md, docs/handoffs/P3A.md, docs/handoffs/P3B.md and the real code.

GOAL: stages must stop being checklists. Rebuild the five disasters' stage generators (keep ids, versions and registry API; bump versions)
so each has its own verb from GAMEPLAY.md section 5 and uses the P3B abilities:
* Gravity inversion (Orient): scheduled gravity flips using gravity zones; switches that work only in one orientation; route planning.
* Reactor overload (Route and sacrifice): heat meter; a coolant/vent graph; venting a sector saves the core and floods that area.
* Reality fracture (Tell real from ghost): ghost copies of doors/rooms-parts; evidence identifies the real one; a wrong choice costs health-like penalty
  (health arrives in P4; use the existing score/time penalties plus a new "instability" counter now).
* Temporal storm (Cooperate with your past): a bounded record-and-replay echo of the player's last ~8 s (server-authoritative, deterministic).
* Cascading power failure (Isolate): shrinking vision and a circuit graph; cut the spreading fault in time.
DEDUCTION: replace instruction-style text. Objective text states goals only. Add an evidence model: noisy readings, contradicting clues,
at least one decoy per stage above Easy that is tempting and costs something, limited scanner charges. Add `clueClarity` (easy / intermediate / hardcore)
to the stage definition (additive); Easy may give one hint line, Intermediate cryptic, Hardcore minimal. Hidden solutions never leave the server.
COMBINATIONS: define a table of allowed pairs; support a pair only when its interaction is written and tested (example: reactor overload + gravity
inversion: coolant valve on the ceiling until gravity is flipped). Reject incompatible pairs with a reason. Max 2 simultaneous disasters now.
KEEP: determinism by seed, validateStageDef, real-physics solvability for 1 to 4 players, cleanup, bounded effects, all 578+ tests green.
TESTS: each verb solvable solo and co-op; decoys cost something; wrong guesses never solve; combos fully resolvable; determinism; no leaked hidden text;
endless loop still works at stage 1,000,000.
DELIVER IN STEPS (one disaster per step, then combinations, then docs/handoff). Update docs/DISASTERS.md. A disaster/combination is supported only after
the maintainer confirms its tests passed, plus a note from a human playtest ("was it fun, where did people get stuck").
Do not implement health/death (P4), rooms (P4B), OpenAI, persistence.
