# The Ghost (P3E)

Status: **P3E step 1 of 5 (ghost core, server side).** Steps 2 to 5 (sound and look, hiding and the catch, the Pulse Gun, Shade and Howler, generator and solver) extend this file. Everything below is enforced in code and by tests named in `docs/handoffs/P3E.md` when it is written; what is not built yet is marked **LATER**.

## Where it lives

| What | Where |
|---|---|
| The ONE tuning table and `ghostTuning(difficulty, stage)` | `shared/src/rooms/tables.ts` (`GHOST_TABLE`, `GHOST_MODE_RATE`, `ghostProgress`, `ghostPresentOnStage`) |
| Types, states, legal transitions, fixed rules (`GHOST_LIMITS`), senses, aim, lit region, public schema | `shared/src/ghost/index.ts` |
| The ghost (state machine, senses, waves, movement, doors, event log) | `server/src/ghost/system.ts`, navigation `nav.ts`, event types `types.ts` |
| Wiring into a run | `server/src/room.ts` (`bindGhost`, `tick`, `viewFor`), `game.ts` (`senses`, aim, sneak), `gateway.ts` (input fields) |
| What a player is told | `server/src/rooms/view.ts` (`restrictedView`, `ghosts`, lit-region cut) |

The ghost exists only on an **escape stage from stage 2**, and only when the room is created with the ghost option: server env `GHOST_STAGES=1` (read in `gateway.ts`; off by default so every earlier test and room is unchanged), or `createGameServer({ ghostStages: true })`. A `Room` option `startStage` (dev and tests) begins a run at a later stage so a type can be met without playing the stages before it.

## States (all transitions server-side, logged, and checked against `GHOST_TRANSITIONS`)

```
DORMANT -> WARNING -> ROAMING <-> HUNTING -> RESPAWN -> WARNING -> ...
                         \            \
                          +-> STUNNED -+-> RESPAWN
```

* **DORMANT**: only before the first appearance. The first warning comes after 60 to 100 percent of the appearance interval (seeded), the second ghost type half an interval later.
* **WARNING**: the ghost is not there. It lasts at least 3 s (`GHOST_LIMITS.warningTicks` is 80 ticks, never below `minWarningTicks` 60). Every appearance, including every later one, goes through it (`RESPAWN -> WARNING`, never `RESPAWN -> ROAMING`). It cannot be stunned: it is not there (and `stun` refuses outside ROAMING and HUNTING). If no fair spawn point exists when the warning ends, the warning simply goes on 1 s more (logged once as `spawn_blocked`).
* **ROAMING**: investigates the last noise it heard (or one made in the room in the last 10 s before it appeared), looks around on arrival (3 s), then patrols to seeded waypoints in its region. It fades (RESPAWN) after 60 s of roaming that was not a hunt or an investigation.
* **HUNTING**: it has SEEN a player. It goes to where it last saw them. After 4 s without sight it gives up, walks to the last place it saw them and searches (ROAMING again).
* **STUNNED**: immobile for `stunTicks` (table below), then RESPAWN. (The Pulse Gun is step 4; `GhostSystem.stun` is the seam it will call.)
* **RESPAWN**: absent for the appearance interval, then WARNING.
* A **catch** is logged with its reasons, then the ghost goes to RESPAWN. In step 1 the catch has no effect on the player (the host gets `onCatch`); the interim capture rule is step 3 (see below).

## Senses

**Sight**: a cone in front of the ghost (half-angle 35 degrees, 50 while hunting; range 340 px), blocked by every solid and every CLOSED door (the same `occluders` the players' vision uses). A player inside a hiding spot (**LATER**, step 3) and a captured player are never seen. The ghost turns at most 0.3 rad per tick, so a cone can be walked around.

**Noise**: how loud a move is comes from the **move axis the server applied** (never from what the client says about itself):

| Gait (`gaitOf`) | Move axis | Share of the hearing range |
|---|---|---|
| still | 0 | 0 (silent) |
| sneak | up to 0.4 | 0.15 |
| walk | up to 0.7 | 0.4 |
| run | above 0.7 | 1.0 |
| dropping an item | | 1.1 (step 3 calls `makeNoise`) |
| a door used by a player | | 0.8, and the noise carries the door id: a ghost that reaches it follows through if the door is open |

Crouching (Shift held while standing or at sneak speed) is silent. Sound reaches only ghosts in the same room; a wall in the way muffles it to 65 percent. On a keyboard there are two gaits: normal movement is a run (loud), Shift is a sneak (the client sends a reduced move axis, **step 2**). Hearing range comes from the table.

**Aim**: the client sends the aim angle with every input, quantised to 256 steps (`quantiseAim`, optional `aim` field of `game:input`, validated 0 to 255) and `sneak`. The server keeps the last valid aim. With the ghost option on, what a player is told is cut to their **lit region** (the 120 px small light plus the 62 degree cone, scaled by the stage's vision radius, as the client draws it) once their aim is known; the same predicate answers the refusals, so a thing out of the light still answers "Nothing there." Without an aim (an old or modified client) the P3D radius view applies, and the Shade and the Pulse Gun use the player's facing. Known limit, documented: a client that never sends an aim sees the whole vision radius instead of the cone.

## Fairness rules and the tests that prove them (`server/test/ghost/core.test.ts`, `room.test.ts`)

| Rule | Where it is enforced | Test |
|---|---|---|
| No ghost on stage 1 | `ghostPresentOnStage`, `ghostTypesForStage(1) = []`, `Room.bindGhost` | "no ghost on stage 1" (system and Room) |
| Warning of at least 3 s before every appearance | state machine, `GHOST_LIMITS.warningTicks` | "every appearance is preceded by a warning of at least 3 seconds" (6 stage and seed pairs, 20 minutes each) |
| Never spawns in a player's view, within 520 px of a player, or within 150 px of an arrival point or spawn slot of the room; always on the players' side of any wall | `pickSpawn` | "never inside a player's view ..." (48 runs, every spawn audited from the recorded positions) |
| Speed never above 95 percent of the sprint | `ghostTuning`, `walk` | "never moves more than 95 percent ..." (every mode, stages 2, 12, 60, 1,000,000) |
| Doors take time; a locked door is never passed | `beginDoor` (2 s), `planDoor` uses open doors only | "doors take time ...", "through a CLOSED gate it never passes" |
| A hidden player is not seen | `sees` | "a hidden, silent player is never sighted or caught, while the same player in the open is" |
| Every catch is explainable | `GhostCatchEvent.because`, `explainCatch` | "each catch carries a chain of reasons with ticks" |
| Max 2 ghosts, bounded log | `MAX_GHOSTS`, `maxLogEvents` | "only two ghosts exist", "the log is a bounded ring" |
| Deterministic in (stage, seed, tick) | per-ghost seeded generator, no clock | "same (stage, seed) and same inputs give the same events" (system and Room) |
| Absent from a snapshot unless in view | `restrictedView` (`POINT_HEIGHT.ghost`) | `room.test.ts`, "a ghost that is not in your view is not in your message" |
| Every room keeps a reachable hiding spot | **LATER** (step 3 and 5: generator and validator) | |

## Movement

A ghost **floats**: solids stop it, gravity does not. `server/src/ghost/nav.ts` cuts each room into 40 px cells (blocked if a solid overlaps), finds paths with A* over free cell centres (8 directions, no corner cutting, ties broken by index), and labels connected free regions. Doors are not obstacles; between regions (the two sides of a gate wall, or two rooms) the only way is an **open** door: the ghost walks to it, spends `doorTicks` (2 s) opening it and appears at the door's arrival point. A closed (locked) door is never passed, so a ghost never reaches a room the team has not opened.

## The tuning table (`shared/src/rooms/tables.ts`, mode: Easy)

Progress is `max(0, stage - 2) x modeRate` (Easy 1, Intermediate 1.5, Hardcore 2): stages 1 and 2 sit on the starting values. Each curve is linear and stops at its cap.

| Parameter | Start | Per progress point | Cap or floor |
|---|---|---|---|
| Speed (share of sprint) | 70 % | +0.5 % | 95 % |
| Appearance interval | 120 s | -1.5 s | 40 s |
| Stun after a Pulse Gun hit | 150 s | -2 s | 45 s |
| Hearing range of a runner | 300 px | +5 px | 560 px |
| Hiding spots per room (read by the generator in step 5) | 4 | -1 per 8 points | 1 |

| Stage | Speed | Interval | Stun | Hearing | Hiding spots |
|---|---|---|---|---|---|
| 1 and 2 | 70.0 % | 120 s | 150 s | 300 px | 4 |
| 7 | 72.5 % | 112.5 s | 140 s | 325 px | 4 |
| 12 | 75.0 % | 105 s | 130 s | 350 px | 3 |
| 100 | 95.0 % | 40 s | 45 s | 560 px | 1 |
| 1,000,000 | 95.0 % | 40 s | 45 s | 560 px | 1 |

(Hardcore at stage 12: 80 %, 90 s, 110 s, 400 px, 2 spots.) Tested at stages 1, 2, 7, 12, 100 and 1,000,000 in every mode (`shared/test/ghost.test.ts`).

## Types (`ghostTypesForStage`)

Wisp from stage 2, Shade ALONE at stage 7, Howler ALONE at stage 12; stages 8 to 11 mix Wisp and Shade; from 13 a seeded pair (Wisp and Howler, or Shade and Howler). At most 2 types, one ghost per type. **In step 1 every type behaves as the Wisp** (noise chaser); the Shade and the Howler powers, looks and sounds are step 5 (and step 2 for the look and sound). Mimic, Phantom, Warden and Twins are later phases and are not built.

## The interim catch rule (step 3, P4 replaces it)

A caught player is CAPTURED where they stand, drops carried items and cannot move; a teammate frees them by holding E next to them for a few seconds; if not freed within about 45 s they are released at their room's entry with a score penalty. Nobody is eliminated in P3E. **LATER** (step 3).

## Step 2: sound and look (client)

### How to try it in a browser
1. `npm run dev:server` (:3001) and `npm run dev:client` (:5173). Escape stages are on by default, no env var needed.
2. Open `http://localhost:5173/?ghost=1`. This creates a ghost-enabled run that starts at stage 2 (the first stage that can have a ghost). `?ghost=7` starts at stage 7 (the Shade, once built), `?ghost=N` at stage N. The flag only applies to the tab that creates the room; a second tab joins with `#CODE` as usual.
3. Click the page or press any key once: browsers only start audio after a gesture. Add `&dark=1` to see the flashlight view the ghost is designed for.
4. Wait. The first appearance is after about 72 to 120 s of play. You get the WARNING first (a whisper every ~1.8 s, the light flickers, "Something is coming..." shows), then the Wisp roams. Walk or run to make noise; hold Shift to sneak; stand still to be silent.
5. Keys: Shift = sneak (escape stages), M = mute or unmute the ghost sounds. Flags: `&reduceflash=1` (no flicker, only a slow gentle dim), `&mute=1` (start muted).
6. The debug hook `__WB_DEBUG__.state().ghost` (dev build) shows how many ghosts are drawn, the last cue, whether audio is running, and the aim and sneak being sent.

### What the client receives
- `ghost:cue` (server to client, per player, only while playing): `{ tick, warning, sounds: [{ id, kind, band 1..3, dir -1|0|1, state, moving }] }`. Sent when it changes (at most every 4 ticks) and at least once a second as a keepalive. THIS IS THE DOCUMENTED EXCEPTION TO THE VISION INVARIANT: it is sent through walls, but it holds only a distance bucket (250/500/800 px), a left/ahead/right direction (60 px deadzone), the type, the state and whether it moves. No coordinates. A ghost beyond the last bucket, or in another room, gives no sound. `warning` is true for everyone while a ghost is about to appear.
- `GameSnapshot.ghosts`: the ghost itself, only when the player's restricted view includes it. The client draws only what is in this list.
- Input: `game:input` carries optional `aim` (0..255) and `sneak`. Shift scales the move axis to 0.35 BEFORE prediction and sending, so prediction and server step the same value; the server derives the gait (and noise) from the axis it applied, never from the `sneak` flag.

### Look and sound (all procedural, no assets)
- The Wisp: pale glow image plus a teardrop body with a wavy tail and two eyes, drawn at depth 11 (under the dark layer, so the flashlight hides it like everything else). Tint: roaming pale blue, hunting warm with red eyes and a faster pulse, stunned dim grey and still.
- Footsteps: noise ticks, volume by band (1, 0.5, 0.2), stereo pan by direction, period by type, faster when hunting; none when stunned or still. Heartbeat: two low sine thumps for the nearest ghost, faster and louder as it nears and while it hunts. Whisper: filtered, wobbling noise during WARNING.
- Flicker (WARNING only): the light reach and ambient dip to 35% to 65% in slots of at least 160 ms. It never goes dark, never flashes bright, never exceeds the server's radius. `?reduceflash=1` replaces it with a slow sine between 70% and 100%.
- Deaf or muted players: a text cue above the hint line says what the audio says ("footsteps near ▶", "HUNTING very close", "Something is coming...").
