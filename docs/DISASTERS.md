# Disaster library (P3A)

Status of each disaster. **Supported** means: its generator, lifecycle tests and real-physics solvability tests (1-4 players)
have been run **by the maintainer** and passed. Only supported disasters are ever picked by the game. All five are supported.

| Disaster | id | Status |
|---|---|---|
| Reactor overload | `reactor_overload` | **Supported**. Tests confirmed on the maintainer's machine (P3A step 2, commit `e2667e5`). |
| Gravity inversion | `gravity_inversion` | **Supported**. Generator, lifecycle and solvability (1-4 players) tests confirmed on the maintainer's machine (P3A step 3). |
| Reality fracture | `reality_fracture` | **Supported**. Same confirmation (step 3). |
| Temporal storm | `temporal_storm` | **Supported**. Same confirmation (step 3). |
| Cascading power failure | `cascading_power_failure` | **Supported**. Same confirmation (step 3). |

The registry pool is `SUPPORTED` (all five) and `CANDIDATES` (empty). The game picks among the supported disasters by seed:
`createRng(deriveSeed(stageSeed, 'pick', stage)).pick(disastersForStage(stage))`.

**Promoting a candidate** (only after its tests pass on the maintainer's machine): in `packages/server/src/disasters/registry.ts`
move the disaster from `CANDIDATES` to `SUPPORTED`. `registry.test.ts` and `candidates.generate.test.ts` assert the supported set equals
`DISASTER_IDS` and that `CANDIDATES` is empty; a future sixth disaster starts in `CANDIDATES` and the gate assertions change in the promoting commit.
Tests that are about one specific disaster pin the generator with `withDisasterPool([id], ...)` (a test-only seam) because the pool now holds several.

## What a disaster is

A generated stage (stage number >= 2, endless: there is no maximum) that carries a lifecycle in `StageDef.disaster`
(private `DisasterMeta`). The stage is a normal P2 `StageDef`: every disaster is built **only** from existing P2 mechanics
(hidden breakpoints and the scanner, the welder, power routing, timed controls, decoy panels, the core console, `arc_discharge`
and `gravity_flux` hazards, the five tools). **No disaster in P3A changes movement physics** (`sim.ts` and `arena.ts` are untouched):
"gravity", "reality" and "time" are expressed through objectives and hazards, not through the simulation of the player body.

### Lifecycle (tick-driven, `DisasterRuntime`)

```
WARNING --ACTIVATE--> ACTIVE --ESCALATE--> ESCALATED --FAIL--> FAILED --CLEAN--> CLEANUP
   |                    |                      |
   +-------RESOLVE------+----------RESOLVE-----+            RESOLVED --CLEAN--> CLEANUP
```

| Phase | When | Effect |
|---|---|---|
| WARNING | from tick 0 | Public message and the list of threats. Hazards of the disaster are held disarmed. |
| ACTIVE | `schedule.activateAtTick` | Hazards with `armedFrom: 'active'` may arm (still subject to their own `armedWhenObjective`). |
| ESCALATED | `schedule.escalateAtTick` | Escalated period/radius apply (bounded: period >= 20 ticks, radius <= 1.5x base). Hazards with `armedFrom: 'escalated'` may arm. Bounded heat drain: `heat.perSecond` per second, at most `heat.cap` points in total. |
| FAILED | `schedule.failAtTick` | **Soft failure**: one-time `failPenalty`, escalated effects stay for `failedHoldTicks`, the stage stays completable. A hard failure / retry is P4. |
| RESOLVED | every `resolveObjectives` objective complete | Effects removed. |
| CLEANUP | 2 s after RESOLVED, after the FAILED hold, or the same tick the stage is stabilised (the stage ends when its last objective completes, so this is the usual path) | Nothing armed, no pending pulse, displayed hazards back to base. Terminal. |

Every effect is a pure function of the phase (`hazardMod`) plus the capped heat drain, so reaching CLEANUP removes all of them.
Escalation is driven by simulation ticks only: no wall-clock time and no `Math.random` anywhere.

### Fairness bounds (`DISASTER_LIMITS`, enforced by `validateDisasterMeta`; a stage with any violation does not launch)

* escalation no earlier than tick 1200 (60 s), failure at least 1200 ticks after escalation, failed hold <= 3600 ticks;
* heat <= 20 points/s and <= 1000 in total; failure penalty <= 500;
* every hazard has exactly one threat entry: readable warning + a tool that really counters it + a repair path;
* every arc hazard is controlled by the lifecycle;
* public text never contains a hidden breakpoint id or label;
* scan gates cannot deadlock (a breakpoint cannot require its own repair before it can be scanned);
* more repairs than the welder holds (3) are only allowed when a supply cache exists.

Difficulty scales with the stage number through a **capped tier** (1..5): `tier = 1 + min(4, floor(log2(stage)))`.
Stage 2 is tier 2; stage 16 and every later stage is tier 5. Only timings, window sizes and the chain length move with the tier,
all inside the bounds above.

### Determinism

`stage seed = deriveSeed(runSeed, 'stage', stage)`; the disaster is picked with `createRng(deriveSeed(seed, 'pick', stage))`; the
parameters come from `createRng(deriveSeed(seed, id, version, 'params'))` forks. Same `(runSeed, stage)` => byte-identical `StageDef`
(tested). The Room keeps a server-side `StageRecord { stage, seed, defId, fallback }`. Seed and parameters are never sent to clients.

### What the public sees (`StageState.disaster`, optional, additive)

`{ id, name, version, phase, message, escalatesAtTick, failsAtTick, threats[] }` only. Never the seed, parameters, hidden breakpoints
or the solution. A hidden breakpoint and a nonexistent target still produce byte-identical refusals (P2 invariant (a), tested for every disaster).

## The five disasters

All five use the tutorial's known-reachable geometry, optionally mirrored left/right (the arena is mirror symmetric about x = 640),
so there are 8 layout variants each (mirror x first breakpoint spot). Players: 1-4 (a solo player can finish every stage; teammates only make it faster).

### Reactor overload (`reactor_overload`)
Seized coolant valve (hidden breakpoint) + slagged pump feed (route power, generator capacity 1) + core console on a Power Cell under
`arc_discharge`. Arcs armed from ACTIVE; escalated arcs are 0.6x the period and 1.2x the radius. Tools: scanner, welder, power cell, shield.

### Gravity inversion (`gravity_inversion`)
Inverted gravity coil (hidden breakpoint) -> three gravity pylons armed inside one window (`timed_controls`, 300-420 ticks) -> core console
held inside a `gravity_flux` field (needs the Gravity Anchor) on a Power Cell. The flux field is a threat from the start. **Escalation adds a second
threat**: `arc_discharge` (`armedFrom: 'escalated'`, Shield Projector) and enlarges the displayed field (1.2x). Tools: all five.

### Reality fracture (`reality_fracture`)
Three reality anchors armed inside one window come first; only then can the scanner find the hidden seam (`scanRequires: ['o_sync']`), which
is then welded. Two decoy panels calm a symptom for a while and then it relapses. Core console on a Power Cell under `arc_discharge`
(armed from ACTIVE; escalated 0.6x period, 1.2x radius). Tools: scanner, welder, power cell, shield.

### Temporal storm (`temporal_storm`)
Hidden desynchronised chronometer (weld), then **two timed-control objectives back to back**: three clocks across the hall (300-420 ticks), then
three relays on the right-hand side in a **shorter** window (140-260 ticks). A relay that is not joined by the others in time slips out of phase.
Core console on a Power Cell under `arc_discharge` (armed from ACTIVE; escalated 0.6x, 1.2x). Tools: scanner, welder, power cell, shield.

### Cascading power failure (`cascading_power_failure`)
A **chain of 2-4 hidden breakpoints** (tripped relays; 2 at tiers 1-2, 3 at tiers 3-4, 4 at tier 5). Each relay can only be found by the scanner after the
previous one is mended. A four-relay chain exceeds the welder's three charges, so the team must visit the supply cache once (score cost 50). Plus the tutorial
grid (route power to the pump through the breakers) and the core console on a Power Cell under `arc_discharge` (armed from ACTIVE; escalated 0.6x, 1.2x).
Tools: scanner, welder, power cell, shield.

## Adding a disaster
1. Add the id to `DisasterIdSchema` (shared) if it is not one of the five.
2. Write the generator with `defineDisaster<P>` (`server/src/disasters/framework.ts`): a Zod params schema, `deriveParams(stage, rng)` (pure, bounded),
   `generate({stage, seed, params})` (pure; set `def.disaster`). Reuse `kit.ts`.
3. Register it in `CANDIDATES` (`registry.ts`). It is not selectable yet (`getCandidateDisaster` finds it; `withDisasterPool` can pin it in tests).
4. Tests, using `helpers/candidates.ts` and `helpers/planner.ts`: generator (determinism, validation across stages x seeds, bounded scaling), lifecycle through the real Room,
   solvability through the real simulation with 1-4 players for all 8 layout variants, cleanup, next stage, end-to-end determinism.
5. Only after the maintainer has run them and confirmed they pass: move it to `SUPPORTED` (as was done for the four disasters of step 3).

Combinations of disasters (`compat.combinableWith`) are P3B and are empty for every disaster.
