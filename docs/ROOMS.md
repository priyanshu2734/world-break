# Rooms (P3D)

Status: step 2 (room graph, per-room arenas, camera, doors without locks). Locks, the exit, server-side vision and the generator arrive in steps 3 to 5; this file is extended then.

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
