# Rooms (P3D)

Status: P3D complete (rooms, camera, doors with locks, keypads, safes, clues, switches, exit, server-side vision, minimal HUD, and the seeded generator that builds every stage). Everything in the tables below is enforced in code and covered by tests; the source of each number is named.

## Limits (`shared/src/rooms/limits.ts`)

| Limit | Value | Why |
|---|---|---|
| Rooms per stage | 1 to 6 | GAMEPLAY.md section 4; never unbounded |
| Room width | 1600 to 3200 px | wider than the 1280 px screen, camera follows |
| Room height | 720 to 1440 px | taller rooms scroll vertically |
| Solids per room | at most 40 | bounded snapshot and layout size |
| Doors per room | at most 3 | |
| Door size | 24 to 80 wide, 80 to 140 tall | a standing doorway on a floor |
| Arrival clearance | 60 px from any door of the target room | no instant bounce |
| Door cooldown | 4 ticks (0.2 s) | backstop only; a long one lets a runner skip a door |
| Spawns per room | 4 | one per slot |

## Rules enforced by `validateRoomGraph`

Unique room ids; a room's arena id equals its room id; every spawn, door and arrival point stands on a solid inside the room; every door leads to a real, different room that has a door back; every room is reachable from the start; arrival points are clear of the doors of the target room. Physical reachability (can a body walk or jump there) is proven by the real-physics tests, extended in step 5.

## What a player is told

Per player, only the layout (walls and doorways) of the room they are in, as event `room:layout`, on stage start and on every door passage. Never where a door leads, never another room, never broadcast. `GamePlayer.roomId` is in the snapshot.

## Try it

`npm run dev:server`, `npm run dev:client`, open `http://localhost:5173/?rooms=1` (ESCAPE_STAGES must not be `0`). Three dark rooms in a row; walk east through the doors. Room 1 is taller than the screen.

## Doors and locks (step 3)

| Lock | Opens when | Solo-safe because |
|---|---|---|
| key_item | a carried `access_key` is used up (E at the door) | the key lies on the near side (often hidden in a locker) |
| code | the 4-digit code is typed at a keypad elsewhere | the clue notes on the near side spell it |
| power | a carried `battery` is used up | the battery lies on the near side |
| two_person | both switches are lit at once (each holds 6 s) | one player runs from one switch to the other in time (validator bound: 70 percent of the hold) |
| safe | the door's key, found in a safe opened with a 3-digit combination | three clue notes spell the combination |

Never the same lock type on two neighbouring doors. Decoys (a cracked key or battery) break in the lock and cost the wrong-part penalty. Two hand slots, as in P3C.

## Interaction rules

| Rule | Value |
|---|---|
| Reach for E | 70 px horizontally (+ half a door's width), `RANGE_DY` vertically |
| Door opening delay | 10 ticks (0.5 s); drifting more than 60 px cancels |
| Wrong tries before a lockout | 3 (keypad or safe), lockout 100 ticks (5 s) |
| Switch hold | 120 ticks (6 s) |
| Escape intents per player | at least 4 ticks apart (refused ones count) |
| Exit zone | 60 x 100 px; the first connected player inside clears the stage |
| Authoring bounds | at most 5 doors, 20 clues, 5 keypads, 5 safes, 10 switches, 12 hiding spots per stage (`ESCAPE_LIMITS`); at most 12 parts per stage (P3C `ITEM_LIMITS`) |

## What a refusal reveals

A locked door says what is missing (`Locked. Needs a key.`, `Locked. Needs a 4-symbol code.`, `Locked. Needs power.`, `Locked. Needs two switches held at once.`), never where it is. A key door and a safe door read the same.
A door, keypad, safe, switch or clue that is hidden, in another room or nonexistent answers `Nothing there.`, byte for byte.

## Clearing a stage

Reaching the exit alive clears the stage for the whole team (the others come back next stage): `StageEngine.clearStage` makes the engine `stabilized`, and the existing STAGE_CLEAR transition does the rest.

## Try it

`/?rooms=1`: key from the locker (the cracked key lying about is a decoy), then a 4-digit code (the note is on a high platform; the keypad is by the door). `/?rooms=2`: all five lock types in six rooms.

## Vision (step 4)

| Stage | Easy: ambient / reach | Intermediate | Hardcore |
|---|---|---|---|
| 1 | 30 % / 460 px | 20 % / 430 px | 10 % / 400 px |
| 10 | 21 % / 451 px | 11 % / 421 px | 2 % (floor) / 391 px |
| 100 | 10 % (floor) / 361 px | 5 % (floor) / 331 px | 2 % / 301 px |
| 1,000,000 | 10 % / 340 px (floor) | 5 % / 320 px (floor) | 2 % / 300 px (floor) |

Reach drops 1 px per stage to its floor. A thing is in view in the viewer's own room, inside the reach, with a clear line from the eye past every solid and every closed door. Everything not in view is not in the message the player receives
(`server/src/rooms/view.ts`). A teammate is on the team list always (name, slot, connection) but is in the snapshot only when in view, and nobody ever receives another player's hands. Refusals for things out of view equal refusals for nonexistent things.

## The generator (step 5)

`generateEscapeStage(stage, seed)` (`server/src/rooms/generate.ts`) builds EVERY stage of an escape run. It is deterministic in `(stage, seed)` (the run seed is derived per stage), so a stage can be replayed and the loop is endless: only the room count grows, and it is capped at 6.
With `ESCAPE_STAGES` on (the dev server default) `Room.buildEngine` uses it for stage 1 and for every stage after a cleared one; with `ESCAPE_STAGES=0` the previous stage 1 and generators are used and none of this code runs.

| Stage | Rooms | Doors | Lock types that may appear | Decoys | Ghost hiding spots (P3E placeholders) |
|---|---|---|---|---|---|
| 1 | 1 | 1 (a gate in a wall) | key | none | none |
| 2 | 1 | 1 (a gate) | key, code | 1 per key/battery lock, 1 decoy note per code lock | 1 per room |
| 3-5 | 2 | 1 | key, code, power | 1 | 1 per room |
| 6 | 2 | 1 | + two-person | 1 | 1 per room |
| 7-9 | 3 | 2 | key, code, power, two-person | 2 (within the 12-part cap) | 1 per room |
| 10-14 | 3 | 2 | + safe (all five) | 2 | 1 per room |
| 15-24 | 4 | 3 | all five | 2 | 2 per room |
| 25-39 | 5 | 4 | all five | 2 | 2 per room |
| 40 and up | 6 | 5 | all five | 2 | 2 per room |

(`roomCountForStage`, `locksForStage`, `decoysForStage`, `hidingSpotsForStage` in `shared/src/rooms/tables.ts`.) Never the same lock type on two neighbouring doors; stage 1 is always a key.

**Stage 1, the tutorial.** One 1920 px room, no platforms. A wall runs floor to ceiling at x 1380 with a gate set into it (two doors of the same room, one on each side). The only lock is a key. The key is hidden in a locker that is always within sight of every spawn slot (x at most 700); the exit is in the alcove behind the wall. The ambient is never below 45 percent (`TUTORIAL_AMBIENT_MIN`, `StageDef.ambientMin`), brighter than any stage 1 of the ambient table. No decoys, clues, switches or hiding spots: one thing at a time.

**Every other stage.** Rooms 1920, 2240 or 2560 px wide and 720 px high, a floor and 0 to 3 platforms in an ascending staircase (each step 90 px higher, 60 to 95 px gap: every platform is one jump from the one before). A door pair joins each pair of rooms at the floor ends. Everything a lock needs lies on its near side: keys, batteries, keypads, safes and switches in the door's own room, clue notes in that room or the one before (a short walk back), a safe's key inside the safe, switches 260 to 800 px apart so one player can run between them inside the 6 s hold. Clue digits spell the code exactly (`validateEscape` checks it).

| Tuning knob | Where | Value |
|---|---|---|
| Ambient | `shared/src/rooms/ambient.ts` | 30/20/10 percent at stage 1 (Easy/Intermediate/Hardcore), minus 1 point per stage, floors 10/5/2 |
| Vision and flashlight reach | `shared/src/rooms/vision.ts` | 460/430/400 px at stage 1, minus 1 px per stage, floors 340/320/300 |
| Rooms, locks, decoys, hiding spots by stage | `shared/src/rooms/tables.ts` | table above |
| Room size and doors | `shared/src/rooms/limits.ts` | see the limits table |
| Lockout, hold times, reach, delays | `shared/src/rooms/escape.ts` (`ESCAPE_LIMITS`) | see the interaction table |
| Stage time | `generate.ts` | (5 + 3 x rooms) minutes |

## How solvability is shown

1. By construction (above), then `validateStageDef` (which runs `validateRoomGraph` and `validateEscape`) must pass before a stage is returned; an attempt that fails is replaced by the next derived attempt, and the tests assert the first attempt is always valid (840 stage and seed pairs over 21 stage numbers, 5,700 in a wider scan during development).
2. By play: `server/test/rooms/solver.ts` reads the private definition and plays the stage through the public Room API with the REAL movement function (walking, falling, hopping platform to platform by look-ahead, lockers, notes, codes, switches, E on doors), asserting at most 2 hand slots. `solve.test.ts` plays 240 early stages (40 run seeds x stages 1 to 6), 96 stages across the table up to stage 1,000,000, and 81 co-op stages with 2, 3 and 4 players, and requires all five lock types to be solved alone and the two-person lock to be lit by two different players.
