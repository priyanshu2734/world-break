# P3A Handoff: Endless Stage Loop, Disaster Registry, Seeding and Public Warnings

Baseline: P2 handoff (`docs/handoffs/P2.md`, unchanged). Branch `phase/p3a`. `docs/P1_HANDOFF.md` and `docs/handoffs/P2.md` are unchanged.
**How this milestone was produced.** The author's sandbox had no npm registry (HTTP 403), so `npm ci`, `npm run typecheck`, `npm test` and
`npm run build` could **not** be run by the author. The maintainer ran them on their machine after delivery steps 1-3 and pasted the real results;
every error they found was fixed. Step 4 (promotion of the four disasters) was **not** run by the maintainer yet. Everything below separates *maintainer-verified*,
*sandbox-only spot checks* and *NOT RUN*.

## 1. Git state
Branch `phase/p3a`.
* Step 1 (seeded PRNG + `NEXT_STAGE` endless loop): commit `afeb8f8`, maintainer-verified.
* Step 2 (disaster registry + reactor overload): commit `e2667e5`, maintainer-verified.
* Step 3 (four more disasters, candidate registration, docs): committed on `phase/p3a`, maintainer-verified. Commit hash: **`<step 3 hash: to be filled in by the maintainer once pushed>`**.
* Step 4 (promote the four disasters to SUPPORTED, update the gate tests, docs): delivered as a zip; **not yet committed or verified**. Its hash is whatever the maintainer's commit becomes
  (a file cannot contain its own hash).

## 2. Files changed
**Shared (`@wb/shared`)** added: `src/disasters/{rng,lifecycle,public,index}.ts`; modified (additive): `src/index.ts`, `src/protocol.ts`, `src/systems/schemas.ts`.
**Server** added: `src/disasters/{fallback,generate,framework,meta,runtime,validate,registry,reactorOverload}.ts` (steps 1-2) and, in step 3,
`src/disasters/{kit,gravityInversion,realityFracture,temporalStorm,cascadingPowerFailure}.ts`; modified (additive): `src/room.ts`, `src/gateway.ts`,
`src/systems/{registry,stageDef,validate,engine}.ts`. Step 3 also edited `src/disasters/{registry,validate}.ts` (candidate pool, three new validator checks).
Step 4 edits only `src/disasters/registry.ts` (all five in `SUPPORTED`, `CANDIDATES` empty) plus tests and docs.
**Client** modified/added: `src/net/session.ts`, `src/ui/{StageHud,StageView,disasterText}.ts`, `src/scenes/GameScene.ts`.
**Tests added** (no existing test was edited): shared `rng`, `disasters.lifecycle`; server `room.nextstage`, `gateway.nextstage`, `no-final-stage`, `gateway.disaster`,
`disasters/{runtime,registry,validate,engine.disaster,reactorOverload.generate,reactorOverload.solvability}`, and in step 3
`disasters/{candidates.generate,candidates.solvability,candidates.lifecycle}.test.ts`; client `disasterText`. Helpers: `test/helpers/{tutorialPlan,planner,disasterFixtures,candidates}.ts`.
**Step 4 test edits** (the intentional gate and the tests that assumed a reactor-only pool; no test was weakened): `test/disasters/registry.test.ts` (supported set = all five, no candidate, pick is deterministic and reaches every disaster),
`test/disasters/candidates.generate.test.ts` (gate block rewritten the same way), `test/disasters/reactorOverload.{generate,solvability}.test.ts` and `test/disasters/engine.disaster.test.ts`
(generator pinned to reactor overload with `withDisasterPool`), `test/gateway.disaster.test.ts` (asserts against whichever disaster the random run seed picked instead of hard-coding reactor overload),
`test/helpers/candidates.ts` (looks disasters up with `getDisaster`).
**Docs:** `docs/DISASTERS.md` (new), `docs/handoffs/P3A.md` (this file), `docs/ARCHITECTURE.md` (updated).
The maintainer fixed two type errors in `test/helpers/disasterFixtures.ts` after step 2 (`armedFrom: 'active' as 'active' | 'escalated'`;
`fixtureMeta(overrides: Record<string, unknown>)`); the step-3 zip contains that fixed file and nothing else changes it.

## 3. Commands
| Command | Result |
|---|---|
| Step 1: `npm ci`, `npm run typecheck`, `npm test`, `npm run build` | maintainer ran: typecheck clean, 237 tests (client 26, server 171, shared 40), build OK |
| Step 2: same four commands | maintainer ran: typecheck clean, 370 tests (client 32, server 281, shared 57), build OK |
| Step 3: same four commands | maintainer ran: typecheck clean, **577 tests passing (client 32, server 488, shared 57)**, build OK. The four candidates passed their generator, lifecycle and solvability (1-4 players) tests |
| Step 4: `npm ci` | **NOT RUN** |
| Step 4: `npm run typecheck` | **NOT RUN** |
| Step 4: `npm test` | **NOT RUN** (expected, unverified: 578 = 577 + 1 new registry test; server 489) |
| Step 4: `npm run build` | **NOT RUN** |
| Step 4: gateway tests (real sockets, including the edited `gateway.disaster.test.ts`), `loop.test.ts` | **NOT RUN** |

Step 4 sandbox-only spot checks (not an official run; a hand-written minimal vitest stand-in, `tsx`, a locally copied zod, and `tsc` with stubs for the vitest and socket types):
every non-gateway, non-loop server test file passed (the tests that assume a reactor-only pool were fixed first, see section 2), and `tsc` reported no error in any edited file except
the unavailable `socket.io-client` types and one already-verified shared test that trips on the stub's loose `it.each` typing. The stand-in is not vitest: treat this as a hint, not as verification.

## 4. Tests
**Maintainer-verified (steps 1-3):** PRNG vectors; `NEXT_STAGE` loop and gateway; lifecycle table; runtime; validator; engine integration; reactor overload
generator, 32 solvability runs with 1-4 players through the real physics, lifecycle and cleanup; client disaster text; and, for each of `gravity_inversion`, `reality_fracture`,
`temporal_storm`, `cascading_power_failure`: generator (metadata, determinism, schema, validation over 8 stages x 25 seeds, different seeds differ, bounded scaling, one threat per hazard,
no leaked hidden text); 8 layout variants x 1/2/3/4 players solved through the real `Room -> GameSim -> StageEngine` path; lifecycle with an idle team (all phases, bounded heat and penalty,
soft failure, still completable); escalation changes bounded and removed by cleanup; solving while ESCALATED and right after FAILED; cleanup freezes the state; the next stage starts clean;
end-to-end determinism; hidden refusal byte-identical; wrong targets never win; and each disaster's signature mechanic (anchor needed and arcs only from escalation;
scan gated by the anchors; locked clocks and a relay that slips out of its short window; the relay chain and the supply-cache trip).
**Step 4, awaiting the maintainer's run:** the edited gate and pinned tests listed in section 2 (notably the real-socket `gateway.disaster.test.ts`, which now runs against a random one of the five disasters on every run).
**Not covered:** human playtest; browser/WebGL run; load; live OpenAI (not part of P3A); anything involving combinations or abilities.

## 5. Interfaces and contracts P3B must preserve
**Protocol (additive):** `room:nextStage` (client -> server, host only, `(payload: unknown, ack)`); errors `Only the host can start the next stage`, `There is no completed stage to advance from`.
**Public state (additive, optional):** `StageState.disaster?: DisasterPublic` = `{ id, name, version, phase, message, escalatesAtTick, failsAtTick, threats[] }`.
**Server-private (additive, optional):** `StageDef.disaster?: DisasterMeta`.
**Shared exports:** `Rng`, `createRng`, `deriveSeed`, `DisasterPhaseSchema`, `DISASTER_PHASES`, `DisasterEvent`, `nextDisasterPhase`, `isDisasterLive`, `DisasterIdSchema`, `DISASTER_IDS`,
`DisasterThreatSchema`, `DisasterPublicSchema`.
**Server:** `Room` constructor `(code, briefingTicks, runSeed)`; `Room.stageRecord`, `Room.nextStage(id)`; `getStageDef(stage, seed = 0)`; `generateStageDef(stage, seed)`;
`defineDisaster`, `RegisteredDisaster`; registry: `listDisasters`, `getDisaster`, `disastersForStage`, `generateDisasterStage`, plus step 3's `listCandidateDisasters`, `getCandidateDisaster`,
`withDisasterPool` (**test seam only**); `CANDIDATES` is empty and is the gate for any future disaster; `validateDisasterMeta`, `DISASTER_LIMITS`; `DisasterRuntime`.
**Invariants (extending P2's):** (c) the engine step order is now expiries -> hazards -> channels -> objectives -> **disaster** -> deadline;
(j) the disaster lifecycle is driven by ticks only and every effect is a pure function of the phase, so CLEANUP removes everything and a stabilised stage is cleaned up in the same tick;
(k) FAILED is a soft failure (bounded penalty, stage still completable); (l) stage N >= 2 never fails to exist: generation or validation failure falls back to the tested tutorial clone;
(m) seeds, parameters and hidden breakpoints never leave the server; (n) the game is endless: no final stage, no maximum stage in any `compat`;
(o) a disaster is selectable only when it is in `SUPPORTED` (maintainer-confirmed tests); all five are.

## 6. Known bugs and incomplete work
* All five disasters are selectable from step 4 on (maintainer-confirmed tests for each in step 3). Until the maintainer runs step 4 this promotion itself is unverified.
* The run seed is random per room, so a live game now meets any of the five at stage 2. There is no per-disaster difficulty ordering yet; the tier cap bounds difficulty by stage number only.
* A pulse can land while a player walks up to the core console before shielding (cost 75). Same as P2; the solvability tests allow at most two hits.
* "Gravity", "reality" and "time" are gameplay expressions only; no disaster changes how the player body moves (needs a documented `sim.ts` migration, not in P3A).
* No death/revive (P4), no abilities (P3B), no disaster combinations (P3B), no persistence (P6), no OpenAI (P5).
* Fixed before step 2 shipped (and verified by the maintainer with it): a stale hazard telegraph (`nextPulse`) survived a stage that ended while its arc was armed; the engine clears it when the stage stabilises.
* The planner (`test/helpers/planner.ts`) solves with ONE player; it does not exercise cooperation, only that teammates are not required.
* `kit.ts` repeats `tierFor` from `reactorOverload.ts` (the verified file was left untouched on purpose); merge them when convenient.

## 7. Environment variables
None added. `PORT` as before; `OPENAI_API_KEY` / `OPENAI_MODEL` remain declared and unused (P5).

## 8. Database / migrations
None.

## 9. Files P3B may modify
**Add:** `packages/shared/src/disasters/**`, `packages/server/src/disasters/**`, `packages/server/src/systems/stages/**`, `packages/client/src/ui/**`, matching tests.
**Additive edits only:** `packages/server/src/systems/{stageDef,engine,registry,validate}.ts`, `packages/server/src/disasters/{registry,framework,meta,runtime,validate}.ts`,
`packages/shared/src/systems/{tools,schemas}.ts`, `packages/shared/src/{protocol,index}.ts`, `packages/server/src/{room,gateway,game}.ts`, `packages/client/src/{net/session.ts,scenes/GameScene.ts}`.
**Only with a documented migration updating server and client prediction together:** `packages/shared/src/{sim,arena}.ts`.
**Do not modify:** `shared/src/phases.ts`, `shared/src/difficulty.ts`, `server/src/loop.ts`, `client/src/sim/prediction.ts`, `client/src/net/interpolation.ts`,
`systems/tutorial.ts`, existing tests (add new ones), `docs/P1_HANDOFF.md`, `docs/handoffs/P2.md`.

## 10. Acceptance criteria still outstanding
1. Maintainer runs `npm ci`, `npm run typecheck`, `npm test`, `npm run build` on step 4 (expected 578 tests) and confirms, then records the step 3 and step 4 commit hashes in section 1.
2. A human playtest of generated stages (any disaster) on a machine with working WebGL; the P2 residual items (see `P2.md`, section 10) are still open.
3. P3B: abilities, disaster combinations, and (only with a documented `sim.ts` migration) movement-affecting effects.
