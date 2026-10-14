# Phase prompts P3 to P7 (upgraded)

How to use: start a session in the repo (Claude Code is best; with chat, upload a zip of the latest tag). Give it:
(1) `CLAUDE.md` rules, (2) the previous phase handoff, (3) ONE prompt below, (4) the HANDOFF FOOTER at the bottom of this file.
Run phases in order. Do not start a phase until the previous one is merged and tagged.

---------------------------------------------------------------------------
## P3A: DISASTER REGISTRY AND SEEDING
Read CLAUDE.md, README.md, docs/ARCHITECTURE.md, docs/DESIGN.md, docs/P1_HANDOFF.md and docs/handoffs/P2.md (or docs/P2_HANDOFF.md),
then the real code: `shared/src/protocol.ts`, `phases.ts`, `server/src/game.ts`, `room.ts`, the P2 systems folders and all tests.
Use P2's actual repair-graph, objective, tool and timer types. Do not create competing ones.

SCOPE: a modular server-authoritative disaster registry plus deterministic seeding.
Registry entries (new code under `shared/src/disasters/**` and `server/src/disasters/**`), each with: stable ID, version, parameters (Zod),
lifecycle (WARNING -> ACTIVE -> ESCALATED -> RESOLVED | FAILED -> CLEANUP), affected world systems, root causes and breakpoints expressed
in P2's repair graph, required tools and countermeasures, compatibility metadata, resolution/failure conditions, bounded effects, cleanup.
Initial disasters: gravity inversion, reactor overload, reality fracture, temporal storm, cascading power failure.
Seeding: a small seeded PRNG in shared (no Math.random in authoritative code). Same seed + same initial state => identical disaster
configuration and event schedule. Escalation is driven by sim ticks, never wall-clock.
Disaster effects reach players through the existing `game:snapshot` (additive public fields only: active hazards, warnings, phase, countdown).
Hidden solutions stay server-side.
DO NOT: change `sim.ts` physics here, add abilities (P3B), call OpenAI, persist anything, or redesign networking.
Every active hazard needs a readable warning, a valid countermeasure and a repair path.
TESTS: each lifecycle, escalation timing, cleanup (no leftover effects), determinism (same seed twice, different seed differs), snapshot shape,
solo solvability with every disaster alone, multi-client snapshot equality.
Mark a disaster as supported only if its lifecycle test passes.

---------------------------------------------------------------------------
## P3B: REALITY ABILITIES AND COMPATIBLE COMBINATIONS
Preconditions: P3A merged. Read CLAUDE.md, docs/handoffs/P3A.md and the real code first.
SCOPE: abilities gravity manipulation, temporary object freeze, bounded object duplication, momentum manipulation, Gravity Anchor placement
(reuse P2's Gravity Anchor tool; P3B only adds placement/limits).
Each ability: explicit cost or cooldown, max charges, duration, per-player and per-room caps, server validation (range, ownership, cooldown).
Prevent unbounded object creation and invalid physics states (NaN, out-of-bounds, stuck-in-solid).
CRITICAL: `shared/src/sim.ts` and `client/src/sim/prediction.ts` must stay bit-exact. If gravity/momentum need to change movement, add an
OPTIONAL parameter to the shared step function (default = current behavior), update server AND client prediction together, add parity tests,
and document the migration. All existing sim tests must pass unchanged.
Combinations: support a pair only if its interaction is written down and tested (e.g. reactor overload + gravity inversion makes the stabilizer
unreachable until gravity is controlled). Incompatible pairs must be rejected by the registry with a clear reason.
TESTS: ability limits, cooldowns, cap enforcement, invalid inputs, incompatible pairs rejected, each supported combination fully resolvable
solo and with 4 players, cleanup. Real two-client smoke test: both clients see the same hazards.
Document the supported-combination table in docs/DISASTERS.md. Untested combos are listed as NOT SUPPORTED.

---------------------------------------------------------------------------
## P4: DOWNED, REVIVAL, SPECTATING, TEAM WIPE, DEATH REVIEW
Read CLAUDE.md and the real code first. Reuse what exists; do not rebuild it:
- `PlayerLife` machine in `shared/src/phases.ts` is `alive -> downed -> (REVIVE) alive | (BLEED_OUT) eliminated`. Keep these names.
  Spectating is added additively (a flag/field on eliminated players, or a documented extension of the machine). Do not rename `alive`.
- `RoomPhase` already has `team_wiped`, `death_review`, `RETRY`, `RETURN_LOBBY`. Drive them; do not add another room machine.
SCOPE: configurable rescue window, revival requirements and cost, damage/elimination rules, spectator target selection (and auto-switch when a
target dies or disconnects), eliminated players cannot control the live world, team-wipe detection (existing `isTeamWiped`), attempt result,
retry with a NEW validated scenario seed at the SAME stage (never reset to stage 1), death review built only from recorded server events.
Death review: damage and cause, warnings shown, breakpoints found, repairs attempted/failed, missed prerequisites, tools/resources used, cascade
leading to elimination, rescues, outcome. Never invent causes. Spectators get only public information (no hidden solutions, no control).
Solo: death and retry must work without a second player.
TESTS: every legal and illegal transition, revival expiry, spectator restrictions, team wipe, retry seed differs and stage unchanged, event-log
accuracy, disconnect handling.

---------------------------------------------------------------------------
## P5A: SCENARIO MODEL, VALIDATOR AND DETERMINISTIC FALLBACK (no OpenAI yet)
Read CLAUDE.md and the real code first.
SCOPE: one Zod `ScenarioSchema` (ID, version, seed, disaster IDs and params, arena config using existing layout primitives, failure points and
dependency graph, clues and warnings, objectives and tool requirements, resources, timers, optional objectives, briefing) built on the existing
registry and repair graph. Validation pipeline: parse -> schema -> disaster compatibility -> reachability and dependencies -> every mandatory
objective has a countermeasure -> spawn safety and tool access -> timing and complexity bounds -> solo AND 2/3/4-player solvability via a
deterministic solver. A deterministic fallback generator (seeded) that always passes the validator. Variety tracker for recent disasters,
combinations, layouts and repair patterns (bounded history). Stage-aware: scenario difficulty depends on stage and difficulty, the stage number
is unbounded (works for stage 1 and stage 100000).
TESTS: invalid scenarios rejected (impossible graph, unreachable tool, bad combo, over budget), fallback always valid over 1000 seeds,
repeat reduction, determinism.

## P5B: OPENAI SCENARIO GENERATION
Preconditions: P5A merged.
Use the official OpenAI SDK only, with Structured Outputs where supported. Server-side `OPENAI_API_KEY` (and `OPENAI_MODEL`, default to a low-cost model);
never in client, logs or Git; `.env.example` placeholders only. The model returns data, never code. Every response goes through the full P5A
validator; invalid or failed generation falls back to the deterministic generator, so the game always starts. Add timeout, bounded retries,
rate limit, per-hour call cap, a kill-switch env var (`AI_SCENARIOS_ENABLED`), caching, safe error messages. The seed is fixed per attempt so all
clients share one world.
TESTS: mocked OpenAI only (malformed output, refusal, timeout, missing key, incompatible combos, impossible graphs, fallback, repeat reduction).
A live test is optional and gated by an env var; report honestly whether a live call was verified.

---------------------------------------------------------------------------
## P6: PERSISTENT, ENDLESS PROGRESSION
Read CLAUDE.md, docs/DESIGN.md and the real code first (existing `DIFFICULTY_UNLOCK_STAGE`, `isDifficultyUnlocked`, room `stage`).
RULES: stage is an unbounded integer; there is NO final stage and NO ending. Easy from 1, Intermediate unlocks at 10, Hardcore at 20. Players may choose
any unlocked mode for the current stage. Success -> stage + 1. Failure -> same stage, new validated scenario. Milestone stages (multiples of 10)
give a celebration, rewards and a new mechanic/map family, then continue. Difficulty rises through mechanics and complexity, not infinite damage;
include periodic recovery stages and optional objectives.
PERSISTENCE: put a small `ProgressStore` interface behind the server and use the project's existing decision if any; otherwise choose the smallest
maintainable option that works on the target host (consider Windows install friction and ephemeral disks) and document why. Store: team/player
progress, unlocked difficulties, completed-stage results, rewards, schema version and migrations. Never trust client stage numbers, scores or unlocks.
Define how host/joiners get stage and difficulty, handle reconnects and storage failures explicitly (the game must still be playable if storage is down).
TESTS: stages 9/10/11 and 19/20/21, a very large stage number (for example 1,000,000), mode selection, fail/success, persistence recovery, concurrent
updates, repeat avoidance, no code path that treats any stage as the last.

---------------------------------------------------------------------------
## P7A: VISUAL AND AUDIO POLISH
Read CLAUDE.md and the real scenes first. Improve the Phaser client only: readable hazard telegraphs; symptoms vs hidden breakpoints vs scenery clearly
distinct; tool and repair feedback; gravity transitions; procedural audio cues (discovery, danger, rescue, repair, failure); responsive HUD with tools,
stage, teammate status; short disaster intro and stage-complete sequences; milestone celebration for stages 10/20/30...; onboarding and controls;
death-review and replay flow. There is NO ending sequence anywhere: every completion leads to "Next stage". Effects must never hide hazards.
Original or procedural assets only. Do not change server logic.

## P7B: E2E, SECURITY, PERFORMANCE, DEPLOYMENT, SUBMISSION
Use `@playwright/test` with independent browser contexts: create/join, 2 and 4 players, synced movement and hazards, tool repairs, down/revive/spectate,
team wipe and retry, stage completion and unlocks, reconnect and stale room, OpenAI-unavailable fallback. Review server authority, validation, rate limits
(including `game:input`, flagged in P1), private-data isolation, API key protection, bounded objects, timers, room cleanup. Measure performance for real;
do not invent numbers. Prepare production frontend build and a persistent WebSocket-capable Node server, CORS and env config, DB setup and migrations.
Report a live URL only if deployed and tested. Submission pack: title, description, cover-image brief, architecture summary, setup/play instructions and a
checklist against the OFFICIAL Handshake AI Skills Studio instructions (I will paste them into the session; do not guess them). Never submit automatically.

---------------------------------------------------------------------------
## HANDOFF FOOTER (paste at the end of EVERY phase prompt)
Prepare a precise handoff for the next independent developer/Claude session. Do not change the implementation unless required to fix a release-blocking issue.
Report:
1. Git branch and commit hash. If you cannot run git, write "NOT RUN: developer to run `git rev-parse HEAD`".
2. All files changed in this milestone.
3. Commands actually run and their results (mark NOT RUN where applicable).
4. Tests passed, failed, not run.
5. Interfaces and contracts the next phase must preserve.
6. Known bugs and incomplete work.
7. Environment variables required (names only, no secrets).
8. Database or migration changes.
9. The exact files the next milestone may modify.
10. Acceptance criteria still outstanding.
Update docs/ARCHITECTURE.md truthfully. Output the handoff as Markdown for `docs/handoffs/<Phase>.md`; never overwrite another phase's handoff.
A milestone is complete only when its acceptance criteria are verified.
