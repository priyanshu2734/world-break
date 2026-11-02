# VARIETY (P3F): limits and tuning tables

Status: **step 1 (room templates and height) is done**. Steps 2 to 6 append their sections here.

## 1. Room templates (step 1)

Code: `shared/src/variety/{templates,pick,index}.ts` (pure data, no engine change), used by `server/src/rooms/generate.ts`.
A template turns `(width, rng)` into the solids of ONE room (the arena's only primitive: a fixed rectangle), the **surfaces** where things may stand
(`floor` kind: lockers, safes, keypads, switches, hiding spots; `ledge` kind: ledges and crate tops for small things), the two door sites, the arrival points and the exit.

| Id | Pool | From stage | Height | Widths | Character |
|---|---|---|---|---|---|
| tutorial | odd | 1 | 720 | 1920 | stage 1: the single room with the gate (original plan) |
| hall | even | 2 | 720 | 1920 to 2560 | the original staircase slab (stage 2; the classic option of every even stage) |
| corridor | odd | 3 | 720 | 2560, 3200 | crates break the line of sight; a shelf above the middle one |
| split_level | odd | 3 | 720 | 2240, 2560 | a raised deck (180 px) holds the east door and the exit |
| tower | odd | 5 | 960 | 2560, 3200 | stepped pyramid, summit deck, crown ledge (475 px up) |
| pit | odd | 5 | 960 | 2560, 3200 | the floor drops 140 px; climb out the other side |
| islands | odd | 7 | 960 | 3200 | floating platforms between 95 and 380 px |
| vent_crawl | odd | 7 | 960 | 3200 | a 140 px tunnel with a ceiling, 285 px up |
| hub | odd | 7 | 960 | 2560, 3200 | a plaza one flight up, satellites to 380 px |
| mezzanine | even | 4 | 720 | 2560, 3200 | a long gallery 190 px up |
| catwalk | even | 4 | 960 | 3200 | a catwalk at 285 px with stairs at both ends |
| warehouse | even | 4 | 720 | 3200 | two shelves at 285 px, crates in the aisle |
| terrace | even | 6 | 960 | 3200 | four terraces climbing 95 px each |
| shaft | even | 6 | 1040 | 1920, 2240 | a switchback to a gallery 760 px up |
| bridge | even | 8 | 960 | 3200 | stairs, a bridge of planks, stairs down |

13 templates are built from data; with the tutorial room and the hall there are 15 ids. **There are no moving platforms** (the shared sim has only fixed rectangles
and `sim.ts` is frozen): `islands` and `bridge` give the careful-jumping feel with fixed platforms.

### Rules every template obeys (tested)
1. Every ledge is one jump from another (rise at most 95 px, gap at most about 70 px); the real jump is 128 px (`stepBody`, `sim.ts`, untouched).
2. Anything touching the floor is at most 95 px high (the floor stays walkable); taller things float or form a second level.
3. The spawn row (x 300 to 450), both arrival points and both doors stand on clear floor.
4. At most 40 solids, a height of 720 to 1440, a width of 1600 to 3200 (`ROOM_LIMITS`).
5. Every spot a player must reach is proven reachable with the REAL movement function (below).

### Which template a stage uses
`templatePool(stage)` splits the templates into an ODD and an EVEN pool: odd stages draw from one, even stages from the other, so **no stage uses the previous stage's template
by construction** (tested for stages 2 to 300 and on the generated geometry of stages 2 to 60). Stage 1 is the tutorial, stage 2 the hall. Inside a stage the rooms get different
templates while the pool has enough. `templateRoomFor(stage, seed, index, id)` builds a room from its OWN derived generator, so no draw of the stage generator is spent on it.
Step 4 replaces the pick with the newness-weighted one and keeps the no-repeat rule.

### Spots and height
A floor-kind span holds a thing every 130 px (centred), a ledge one in its middle. A spot more than 60 px above the room's ground counts **three times** in the uniform pick
(`RAISED_WEIGHT`), still ONE draw per spot, so about 1/3 to 1/2 of notes, parts, evidence and 1/4 to 1/3 of containers and hiding spots are 90 px or more up
(measured over stages 3 to 30: clues 53%, items 52%, evidence 49%, containers 35%, hiding spots 31%; the highest thing is 760 px up). The two switches of a two-person lock
stand on ONE surface (one height) so a lone player can run between them inside the hold time. The generator's draw order is kept: the original room plan is still drawn (its draws
are spent and its result used by `hall`); every later draw of a stage keeps its place. Layouts of stages 3 and up change (templates); stages 1 and 2 are unchanged.

## 2. Reachability: the strict graph and `requireReachable`
* `server/src/rooms/reachStrict.ts`: the platform graph of `salvage/reach.ts`, but a start point whose body box overlaps another solid is not a start. (The old graph samples the very
  end of a platform; next to a deck or a wall that start is inside the solid and the physics pushes the body up onto it: a jump nobody can make.) Pruned (no sample where nothing can be
  landed on), cached per room (`rooms/arenaKey.ts` gives equal rooms one shared instance, bounded at 600). It only ever holds moves a player can really make (lower bound).
* `requireReachable(def)` (`escapeValidate.ts`, called by the generator for EVERY stage): in every room every start (spawn slots and the arrival point of every door into the room)
  stands on a platform; in a room without a gate every start reaches every other start; every item, stash, clue, keypad, safe, switch, hiding spot, evidence, door and the exit
  stands on a platform a lone player reaches. A failed attempt is thrown away and the next derived attempt is used.

## 3. `dropRest` knows walls and gates
`salvage/dropRest.ts` (additive; `reachablePlatforms` keeps its meaning). A platform is cut into **pieces** where a solid stands on it and reaches past a body's head (a gate wall, a crate,
a deck). Pieces stop 15 px short of the cutter. Only the pieces a lone player reaches from the spawn slots count, so a floor with a closed gate wall across it is two floors and a part
is never left on, in, over or beyond the wall of a closed gate. A point inside a wall, crate or deck (a solid at least 60 px thick) is not a resting place. A part released over a piece
that a wall cut off (the alcove behind an OPEN gate) stays there: whoever released it is in the alcove, so the way is open. Items never change rooms (a drop keeps its room), so a closed
DOOR between rooms cannot be crossed by construction.

## 4. Tests added in step 1
`shared/test/variety.test.ts` (11), `server/test/rooms/templates.test.ts` (every template, width and 24 seeds walked with real physics), `server/test/rooms/variety.generate.test.ts`
(generator uses the templates, no repeat on generated geometry, stage 1,000,000, verticality shares, `requireReachable` refuses an unreachable note),
`server/test/death/dropRest.walls.test.ts` (walls, gates, crates, a real Room disconnect beside the gate wall).

---

# Puzzle pool (P3F step 2)

Thirteen lock types: the five originals (`key_item`, `code`, `power`, `two_person`, `safe`, unchanged, still chosen by `locksForStage`) and **eight new puzzles**. A door's lock is one of the
13. Words live in `shared/src/rooms/puzzles.ts` (the generator writes them, the validator and the solver read them back, so they cannot disagree). Build code: `server/src/rooms/puzzleBuild.ts`.
Rules of play: `server/src/rooms/escape.ts` (`pressPuzzle`, `stepPuzzles`). Validator rules: `server/src/rooms/escapeValidate.ts`.

## The eight new puzzles
| Type | From stage | What the team meets | Solo-safe route | Decoy | Validator rule (it refuses the stage if broken) |
|---|---|---|---|---|---|
| `breaker_panel` | 6 | 3 or 4 breakers in a row, some on. A fuse chart says which circuits must be on | one player toggles the wrong ones; too many presses (breakers + 3) trip the panel (reset, 5 s lockout) | a SUPERSEDED chart with the opposite circuits | row at one height, 110 px apart; start differs from target; chart parses to the target |
| `timed_switch` | 7 | a switch unlocks the door for 8 s; it locks again if nobody went through. Going through in time keeps it open for good | press, run, use the door: the switch is 200 to 700 px from the door, on the door's height, nothing to hop over | a noise note | same room and height as the door, 200 to 700 px, clear run, walking time + door delay below 60% of the window |
| `pressure_plates` | 8 | two plates; a body standing on one lights it, and it stays lit 3 s after the body left | step on the first, walk to the second inside the 3 s (a second player can stand on one) | a noise note | one height, 200 to 520 px apart, clear run, walking time below 70% of the hold |
| `wiring` | 9 | 3 or 4 terminals in a row; a wiring plan names the live one | one player; a wrong wire sparks and locks the panel out 5 s (brute force costs at least 3 waits) | a SUPERSEDED plan naming another post | row rules; plan parses to the live terminal |
| `flashlight_sensor` | 9 | 2 or 3 sensors; only one still works; it must stay in a player's light for 2 s in a row (with the ghost option: inside the lit cone) | one player lights each in turn; the working one glows while lit | the dead sensors (never glow) and a noise note | sensors in one room, the working one among them, 110 px apart |
| `lever_sequence` | 11 | 3 or 4 levers; a valve log gives the order they go down, counted from the left. A wrong lever puts them all back; 3 wrong sequences lock it out 5 s | one player reads and pulls | a SUPERSEDED log with another order | row rules; order is a permutation; log parses to it |
| `tool_key` | 12 | the door needs a key that lies in a JAMMED locker; it opens only for a carried valve wheel (not used up) | pick up the wheel, open the locker, take the key (wheel + key = 2 slots; the solver puts the wheel down) | cracked wheels (snap in the bolt, as cracked keys do) | the locker needs the tool, holds a genuine key, a genuine loose wheel on the near side |
| `symbol_match` | 14 | a keypad whose code is written in symbols: a picture of glyphs in ONE room, a legend (symbol to digit, 8 symbols for 4 used) in ANOTHER (players must talk) | one player walks between the two rooms (both are on the near side) | the 4 unused symbols of the legend, a noise note | picture and legend in two different rooms, both on the near side, keypad in one of them, together they spell the code |

Every note states a fact or the goal, never an action (`METHOD_WORDS` has 30 verbs; no clue or refusal of any generated stage contains one: tested). A refusal says WHAT is missing and never
where (`needText`; a tool key reads exactly like a key door). A SUPERSEDED note starts with that word and no parser accepts it.

## How a puzzle replaces a lock (draw order kept)
`attemptEscapeStage` still draws everything it drew before (rooms, lock types, original resources, hiding spots, gun, evidence, Revive Cell). **After all of that**, one extra pass walks the doors
from first to last: with chance `puzzleChance(stage)` (0 before stage 6, 40 percent at stage 6, +1.25 points per stage, 75 percent from stage 34 on) the door's original lock is replaced by a
puzzle type that the stage table allows, differs from the type of the door before it, and fits the door (`symbol_match` needs a room behind the door). The original lock's parts (every id that starts
with its tag) are removed and their spots freed; the puzzle's parts are placed on the near side. If it does not fit (no free spot, a stage cap) the door keeps its original lock. A stage in which
nothing is replaced is **identical** to the stage the original draws make (`generateEscapeStage(stage, seed, { puzzles: false })` is that stage: tested equal for every link that kept its lock,
and for the rooms, the exit and the hiding spots), so `test/death/revive.gen` and every older stage keep their place. Stages 1 to 5 never change.

## Limits and tuning (all in `ESCAPE_LIMITS` and `puzzles.ts`)
| Name | Value |
|---|---|
| plate lit radius, hold | 36 px, 60 ticks (3 s) |
| timed door window | 160 ticks (8 s) |
| sensor light time | 40 ticks (2 s) |
| breaker slack before a trip | 3 presses over the number of breakers |
| lever or wire lockout | 100 ticks (5 s) after 3 wrong sequences / after each wrong wire |
| switches per stage (was 10) | 24 |
| row spacing | 110 px (spots are 130 apart) |
| puzzle chance | 0 / 40 percent at stage 6 / 75 percent cap |

Brute force is bounded the same way as keypads: a lever panel locks after 3 wrong sequences, a wire panel after every wrong wire, a breaker panel trips, a symbol keypad is a keypad. Honest
limits: with the ghost option OFF the flashlight has no cone (`aim` is null), so the sensor lights whenever it is in view; the breaker panel has 16 states at most, bounded by the trip rule;
nothing here has been played in a browser.

## Tests added in step 2
`shared/test/puzzles.test.ts` (tables, words, parsers), `server/test/rooms/puzzles.runtime.test.ts` (17 rule tests with a fake host), `puzzles.generate.test.ts` (19: pool, gating, never the same
type twice in a row on 1,000+ doors, draw order kept, no method words, decoys, mandatory safes, a validator mutation per type), `puzzles.solve.test.ts` (the real-physics solver plays every type
alone and with 2 players, a sweep of 144 solo stages and 54 co-op stages, and the jammed locker in a real Room).
