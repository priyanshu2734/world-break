# Prompts for P3C (Salvage) and P3D (physical disasters). Paste with the HANDOFF FOOTER and the EXECUTION NOTE used for P3B.

---------------------------------------------------------------------------
## P3C: SALVAGE, CARRYING, REQUIREMENTS AND A REAL STAGE 1
Preconditions: P3B merged and tagged. Read CLAUDE.md, docs/GAMEPLAY.md (especially section 4b), docs/ARCHITECTURE.md, docs/DISASTERS.md,
docs/ABILITIES.md, docs/handoffs/P2.md, P3A.md, P3B.md and the real code (server systems/engine, abilities, room/gateway/game, shared protocol and
schemas, client GameScene and ui). Preserve everything (all existing tests unchanged and green).

GOAL: turn repairs from "press 1 to 5" into a hunt. Players find hidden parts, carry at most 2 slots, and install the right part on the
right target. The game shows WHAT a target needs, never WHERE the part is.
BUILD (server-authoritative, extend the existing StageDef, engine, protocol and schemas additively; no second object framework):
1. Item model: id, kind, slots (1 or 2), state (hidden, in_world, carried, installed, consumed, destroyed), position, container/hidden-by rule,
   decoy flag. Items rest on platforms deterministically (computed from the arena; no browser physics). Bounded counts per stage.
2. Actions with full server validation (range, ownership, slot capacity, cooldown, rate limit): pick up, drop, swap, hand over to a teammate in
   range, install on a target. Disconnect drops the player's items at their last safe position.
3. Requirements: repair targets and objectives may declare `needs` (items and tools). When a discovered target is near, the public state exposes
   its needs (names per `clueClarity`: easy names + a hint line, intermediate silhouettes, hardcore nothing until tried). Hidden items and
   undiscovered targets are never exposed (keep the P2 invariant: refusals for hidden and nonexistent things are byte-identical).
4. Hiding and revealing: items inside crates or behind panels revealed by the Scanner or by interacting; some reachable only with a P3B ability
   (gravity well to a ceiling crate, freeze across a hazard, duplicate to hold a plate). Decoy or cracked parts that fail with a visible cost.
   Arc discharge or similar hazards may destroy a carried item (bounded and telegraphed).
5. Client: slot HUD (2 slots), "Needs: ..." prompt near a target, pick up and drop feedback (keys: E use, G drop or swap), item markers with
   distinct shapes and the color language from GAMEPLAY.md. Keep it readable. No visual polish pass (P3E).
6. REBUILD STAGE 1 as a real, gentle hunt (new stage file; do NOT edit systems/tutorial.ts, keep the old one for existing tests; map stage 1 to the
   new tutorial in the registry additively). Teach one thing at a time: the Welder needs a Flux Coil you do not have; the coil is hidden; one decoy
   coil is cracked; the carry limit forces a choice. Objective text states goals only. Solvable solo.
7. Stages from the endless generator may use items; at minimum add items to ONE existing disaster generator as proof, without breaking
   determinism or validateStageDef (extend the validator: every mandatory need must have a reachable, carryable, correct item for 1 player).
TESTS: pick up and drop limits, 2-slot enforcement and heavy items, hand over, install requirements, wrong or decoy item cost, hidden item
non-disclosure (byte-identical refusals), disconnect drop, determinism by seed, solvability through the real-physics bot with 1 to 4 players,
carry-limit solvability (the planner must respect 2 slots), stage 1 solvable and not a checklist, endless loop still works.
DELIVER IN 4 STEPS: (1) item model + actions + protocol + tests; (2) requirements, hiding, decoys, validator + tests; (3) client HUD and prompts + the
new stage 1 + solvability; (4) docs (docs/SALVAGE.md limits table), ARCHITECTURE.md, handoff docs/handoffs/P3C.md.
OUT OF SCOPE: health and death (P4), rooms (P4B), OpenAI, persistence, visual polish.

---------------------------------------------------------------------------
## P3D: PHYSICAL DISASTERS, SIGNATURE VERBS, DEDUCTION AND COMBINATIONS
This is the old "P3C" prompt in docs/PHASE_PROMPTS_V2.md, unchanged except: it must also USE salvage items (for example reactor overload needs a coolant
cell carried to the right vent; reality fracture hides the real part in one copy of a room) and must keep stage 1 as the P3C hunt tutorial.
