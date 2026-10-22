# Rooms (P3D)

Status: steps 2 and 3 (room graph, per-room arenas, camera, doors with locks, keypads, safes, clues, switches, exit). Server-side vision and the seeded generator arrive in steps 4 and 5; this file is extended then.

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
| Authoring bounds | at most 5 doors, 12 clues, 5 keypads, 5 safes, 10 switches per stage |

## What a refusal reveals

A locked door says what is missing (`Locked. Needs a key.`, `Locked. Needs a 4-symbol code.`, `Locked. Needs power.`, `Locked. Needs two switches held at once.`), never where it is. A key door and a safe door read the same.
A door, keypad, safe, switch or clue that is hidden, in another room or nonexistent answers `Nothing there.`, byte for byte.

## Clearing a stage

Reaching the exit alive clears the stage for the whole team (the others come back next stage): `StageEngine.clearStage` makes the engine `stabilized`, and the existing STAGE_CLEAR transition does the rest.

## Try it

`/?rooms=1`: key from the locker (the cracked key lying about is a decoy), then a 4-digit code (the note is on a high platform; the keypad is by the door). `/?rooms=2`: all five lock types in six rooms.
