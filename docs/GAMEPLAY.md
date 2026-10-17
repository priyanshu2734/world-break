# WORLD//BREAK: GAMEPLAY BIBLE (v2)

This file overrides any earlier, softer description of the game. Every phase prompt must obey it.
Stages are **endless**. There is no ending, no credits, no final stage.

## 1. The promise
> Start a stage, get hooked, fail once, say "one more try", and look up three hours later.

You are a crew of 1 to 4 **Relay Operators** on a failing reality relay station. Reality breaks in strange, physical ways
(gravity flips, time loops, rooms fracture, power cascades). You must **investigate, deduce, improvise with reality
abilities, and survive**. Success feels like "I figured that out". Failure feels like "I know what I did wrong".

## 2. Design pillars (every stage must pass these)
1. **Deduce, don't follow.** The game shows symptoms and contradicting evidence, never "do step 1, then step 2".
   Objective text states the GOAL ("Restore the core"), not the method.
2. **Every disaster has its own verb.** No two disasters may be solved with the same sequence of actions.
3. **Reality is physical.** Disasters change movement, rooms and objects. They are not just text and score penalties.
4. **Decoys and misdirection.** Every stage above Easy has at least one tempting wrong answer with a visible cost.
5. **Real stakes, fair stakes.** Mistakes cost health, time, resources or rooms. Deaths are always explainable
   (death review) and never random. A player must always be able to say what they should have done.
6. **Co-op by design.** 1 to 4 players can always solve it, but with 2+ players there are roles, information that only
   one player can see, and actions that are faster or safer together. Solo is a real way to play (never "impossible").
7. **Learn one thing at a time.** New concept first in isolation, then combined, then under pressure.
8. **Short loops, strong hook.** A stage takes 4 to 12 minutes. Restart is instant. Rewards come every stage.
9. **Bounded complexity.** Difficulty rises by smarter combinations, never by unbounded counts (see section 6).
10. **Readable always.** Hazards, hidden things and scenery must be visually distinct. Effects never hide danger.

## 3. Core loop of one stage
1. **Arrive:** short disaster intro (2 to 4 seconds), warning phase with a countdown.
2. **Investigate:** scan, read gauges, compare contradicting readings, find clues in different rooms.
3. **Hypothesise:** the evidence board (a simple in-game panel) shows what you know, never what to do.
4. **Act:** use tools and reality abilities on the suspected cause. Wrong guess = a consequence (damage, a cascade, a
   lost resource, a room sealing), not just a number.
5. **Escalate:** the disaster gets worse on a deterministic server schedule. The pressure rises.
6. **Stabilise or escape:** final objective under maximum pressure.
7. **Reward:** score, a **draft pick** (choose 1 of 3 upgrades), progress toward unlocks, then "Next stage".

## 4. Reality abilities (P3B) and tools (P2)
Shared **Reality Energy** meter (per player, regenerates when the team repairs things; bounded, no infinite loops).
| Ability | Effect | Limits (defaults, tune in tests) |
|---|---|---|
| Gravity Well | local gravity zone (flip or reduce) | radius ~160, ~6 s, cooldown ~15 s, max 2 active per room |
| Freeze | stops one object or hazard | ~3 s, cooldown ~12 s |
| Duplicate | clone of a light object (hold a plate, block a beam) | max 2 per player, ~8 s life, cost energy |
| Momentum | add or cancel an object's velocity | bounded impulse, cooldown ~8 s |
| Anchor | pins an area stable (existing P2 tool) | existing limits |
Abilities are puzzle pieces: stages must REQUIRE them in different ways (hold two pressure plates with a duplicate,
freeze a hazard to cross it, flip gravity to reach a ceiling switch).

## 5. Disaster verbs (signature mechanics)
| Disaster | Core verb | Example puzzle |
|---|---|---|
| Gravity inversion | **Orient** | Gravity flips on a schedule; some switches only work upside down; plan routes across flips. |
| Reactor overload | **Route and sacrifice** | Heat rises; route coolant/vents through a pipe graph; venting one sector saves the core and floods that room. |
| Reality fracture | **Tell real from ghost** | Duplicate rooms and doors; one copy is real. Evidence reveals which. A wrong door costs health. |
| Temporal storm | **Cooperate with your past** | Record 8 s; your echo replays it. Solve with yourself (solo-safe) or teammates' echoes. |
| Cascading power failure | **Isolate** | Lights die, vision shrinks; cut the failing circuit before it spreads through the graph. |
Combinations (P3C) must be explicitly written and tested. Example: reactor overload + gravity inversion = the coolant valve
is on the ceiling until you flip gravity.

## 6. Difficulty model (what rises, and what must NOT)
Two independent knobs:
* **Stage number = complexity** (how many ideas, how deep the dependency chain, how many rooms).
* **Mode = severity** (damage, clue clarity, repair windows, resource scarcity). Easy from stage 1, Intermediate at 10, Hardcore at 20.

### Rooms (sectors) per stage, bounded
| Stage | Rooms | Notes |
|---|---|---|
| 1 | 1 | tutorial |
| 2 to 5 | 1 to 2 | first two-room puzzle at stage 4 |
| 6 to 14 | 2 to 3 | |
| 15 to 29 | 3 to 4 | |
| 30+ | 4 to 5, **hard cap 6** | stage 100 does NOT have 100 rooms |
After the cap, variety and depth come from: new mechanics, combined disasters (cap 3 at once), modifiers, new layouts, hidden
cross-room dependencies, and "Major Breach" stages. A stage never exceeds its solver-verified complexity budget and human-time budget.

### Rhythm (repeats forever, 10-stage "acts")
x1 to x3: introduce a mechanic or twist. x4 to x6: combine. x7: **breather** (calmer, extra resources, optional objectives).
x8 to x9: pressure. x10: **Major Breach** (milestone): multi-room, multi-disaster, big reward, short celebration, then continue.
Act 1 uses one disaster at a time. Act 2 introduces pairs. Act 3 adds modifiers. Later acts recombine with caps.

### Risk and death (rises with level, always fair)
* Player **health**. Damage sources are telegraphed. Easy damage is small. Intermediate and Hardcore hurt more, with tighter windows.
* Lifecycle: ACTIVE, DOWNED (rescue window), REVIVED or ELIMINATED, SPECTATING. Team shares a limited **Reserve** (revive cells).
* Team wipe: the stage restarts with a NEW validated seed. Drafted upgrades and progress are kept. Stage number never resets.
* Optional **Risk Contracts** before a stage ("Lights flicker", "double damage", "one fewer revive") for extra reward. The player chooses risk.
* Death review shows the real cause from recorded events (no invented explanations).

## 7. Hooks that keep people playing
* **Draft pick** after every stage: 1 of 3 upgrades (for example Scanner range, faster Welder, longer Anchor, cheaper Freeze) that
  last for the run, some with trade-offs. Builds make every run different.
* **Streak and "close call" moments** (cleared with 1 HP, saved a teammate), shown on the results screen.
* **Workshop (meta progression, account only):** permanent unlocks, cosmetics, new draft options.
* **Optional objectives** and **Risk Contracts** for mastery players.
* **Daily Breach** (later): same seed for everyone, best stage reached. Only if time allows; not required.
* Fast restart, short loops, constant small rewards, new idea every few stages.

## 8. Accounts and saving
* **Guest:** play instantly, nothing is saved server-side. Guest progress lives only in that browser session or device and may be lost.
  A banner invites sign-in to keep progress.
* **Account:** sign in with a managed provider (Google and/or email magic link; never store passwords ourselves). Server stores:
  highest stage, unlocked modes, Workshop unlocks, completed stage results, schema version.
* Team rule (confirm in P6): the room runs the **host's** save slot for the stage; every account earns personal records and unlocks.
  The server validates everything; clients never submit stage numbers, scores or unlock flags.
* Persistence and auth are one P6 decision, documented. Guests must always still be able to play if storage is down.

## 9. Look, feel and dimension (2D, polished)
**Decision: stay 2D (Phaser).** Going 3D would rewrite the client, the movement code, networking parity and all assets. For a solo student
project that risks never finishing. A polished 2D game can look stunning and plays well in a browser.
Target look: clean dark sci-fi, strong neon accents, clear silhouettes, parallax backgrounds, dynamic lighting, particles, screen shake,
glow on interactables, distinct color language: **red = danger, cyan = interactive, amber = hidden clue, green = repaired**.
Audio: procedural cues for discovery, danger, repair, rescue, failure; layered ambient track that intensifies with escalation.
Accessibility: color-blind-safe shapes, reduced-motion option, scalable text.

## 10. Hard rules for AI sessions
1. Never write a stage whose objective text spells out the solution steps (Easy may give one hint line; Intermediate cryptic; Hardcore minimal).
2. Every disaster needs its own signature mechanic and at least one decoy.
3. Every mandatory objective must be solvable by 1 player; co-op must add speed, safety or information.
4. Every generated stage must pass the validator and the real-physics solvability bot for 1 to 4 players.
5. No unbounded counts (rooms, objects, hazards, clones). All caps documented in `docs/DISASTERS.md` or `docs/LIMITS.md`.
6. Never claim "supported" or "fun" without tests and a human playtest note.
