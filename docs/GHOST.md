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

## Step 3: hiding places and the catch

### How to try it
Same as step 2 (`http://localhost:5173/?ghost=1&dark=1`). Open a second tab with the room code in the hash (`#ABCD`) to play with a teammate; a lone player can hide but cannot be rescued (they are released after 45 s).
- **Hide:** stand next to a closet or vent (a dark box in the wall; one or two per room) and press **E** ("E hide in the closet"). You stop, nobody sees you and you make no noise. **E** again comes out. You cannot hide while a ghost is hunting you and has just seen you.
- **Be caught:** let the ghost touch you, or hide where it checks. You are caught where you stand, drop what you carry and cannot move; a red "CAUGHT" mark and a timer show.
- **Rescue:** a teammate stands next to you and **holds E** for 4 s ("Hold E to free Ada  60%"). Letting go loses progress.
- **Release:** if nobody frees you within 45 s you are put at your room's entry and the team loses 40 points. Nobody is eliminated (P4 replaces this).
- **Noise:** running and dropping a part (G) are loud; walking is quieter; Shift-sneaking is nearly silent; standing still and hiding are silent. After it hears a noise the ghost may check a hiding place within 260 px of where the noise stopped. It stands at the spot for 2 s (you hear slow knocking and the text cue says "it is checking a hiding place"), then opens it. It does not know whether anyone is inside. You may step out during the 2 s, but then it can see you.
- The first time a warning plays, the line "The lights flicker. Something is near." is shown once (remembered in your browser).

### Rules (all server side, `server/src/ghost/catch.ts`, constants `CATCH_LIMITS` in `shared/src/ghost`)
- Hiding and capture are held by `CatchSystem`, one per stage, owned by the Room; the ghost keeps its own state machine. A hidden or caught player is frozen in the simulation (`GameSim.setFrozen`): the server ignores their move input, and the client sends none, so prediction stays exact.
- A hidden player is in nobody's snapshot but their own (`restrictedView(... hidden)`). Hiding spots are furniture and are sent only when in view; who hides in one is never sent.
- A caught player: carried parts drop where they stand (one per few ticks, through the normal item drop), their task is cancelled, they are shown to teammates in view as caught with the rescue progress.
- Hide, leave, item, stage, ability and escape actions are refused while hiding (except leave) or caught.
- Release puts the player on the start room's spawn slot, or at the arrival point of the door into their room, and re-sends the layout so the client restarts its prediction there.
- Noise: a dropped or swapped part calls `GhostSystem.makeNoise` (loudness 1.1). Movement noise is unchanged (gait from the applied axis).
- The ghost's inspection is part of the ghost machine (`a.inspect`): chosen by the ghost's seeded generator on arriving at a noise, logged as `inspect` events (start, found, empty), and every catch carries a `because` chain ("Heard Ada running ...; Opened the closet and found Ada ...").

### Contract changes (all additive)
- `game:input` gains optional `use` (E held). `ghost:action` event (`hide` or `leave`, acked). `ghost:cue` gains an optional `status` (`spots`, `hiddenIn`, `caught`, `captives`) and each sound an optional `inspecting`.
- Deliberate change to one of my own step-1 tests: `server/test/ghost/room.test.ts`, "a ghost visible to one player is absent for a teammate who cannot see it": a catch used to do nothing; now it freezes the player, so the ghost is placed after the teammate walked away.

### NOT RUN
Browser play, WebAudio, Phaser drawing of the spots, the E hold in a real keyboard, the gateway handler for `ghost:action` and the gateway tests, real `tsc`/`npm`.

## Step 4: the Pulse Gun and the safe it lives in

### How to try it
Same URL as before (`?ghost=1&dark=1`), from stage 2 on (use the dev `startStage`, or play on). In the **start room** find a locker (stages 2 to 4) or a safe (stage 5 and later: three torn pages in the start room spell its 3-digit combination). Open it with **E**, pick up the **Pulse Gun** (a lightning-bolt marker; it takes one hand slot). While you hold it a faint cyan line shows the range and a crosshair the aim. **Left click** fires. There is ONE charge: a shot spends the gun, hit or miss. A hit **stuns** the ghost (it never dies): it freezes, grey and tagged STUNNED, for about 150 s at the lowest stages, shorter on later stages, never under 45 s (`ghostTuning().stunTicks`). It then respawns. A ghost in its WARNING (not in the room) cannot be hit. The crack of the shot is loud: a ghost within hearing comes to look.

### Rules (all server side: `server/src/ghost/gun.ts`, `GUN_LIMITS` in `shared/src/ghost`)
- The direction is the aim the server already holds for the player (never a client vector). Range 640 px, 48 px per tick, so a bolt lives at most 14 ticks; it stops at walls and closed doors (`GhostSystem.trace`) and stuns the first ghost within 30 px of its path via `GhostSystem.stun`, which refuses anything but ROAMING or HUNTING.
- A hidden or caught player cannot fire (the same `blocked()` check as every other action). No gun, no aim yet, or an unknown player: refused, and the gun is not spent.
- Placement (`generateEscapeStage(stage, seed, { ghost: true })`): exactly one genuine `pulse_gun` in the START room, in a locker (stage below 5) or in a combination safe whose notes are in the start room (stage 5 and later, falling back to a locker when the limits are full). One item slot is reserved, so the 12-part cap still holds. The extra draws come last, so a stage generated without the option is byte for byte what it was. `Room` passes `ghost` through.
- The validator (`escapeValidate.ts`, `requireGun`) proves: one gun, not a decoy, in the start room (no door needed), locked in a start-room locker or safe, clues spell the combination and lie in the start room, one hand (fits next to another part within 2 slots). The old rule "a safe must hold a door's part" is relaxed for the gun's safe only.
- Everything is a function of the tick and the inputs: no clock, no `Math.random`.

### Contract changes (additive)
- Item kind `pulse_gun` (`shared/src/salvage/specs.ts`, outside the P3D section-9 list; needed to reuse the item system) and its marker shape `bolt` (`client/src/ui/itemView.ts`, `itemDraw.ts`).
- `ghost:action` gains `{ action: 'fire' }` (strict, no payload). New server event `ghost:shot` (`GhostShotSchema`: origin, angle, range, speed, tick, room), sent only to players who can see where it was fired. `GUN_LIMITS`; noise kind `shot` (`NOISE_KIND_LOUDNESS`). `GenerateOptions { ghost }` on the generator.

### Tests
`server/test/ghost/{gun.unit,gun.room,gunPlacement,gun.solve}.test.ts`, `shared/test/gun.test.ts`, `client/test/gunLogic.test.ts`: shot, miss, wall, range, one charge, no aim, no gun, stun timer and floor, never in WARNING, determinism, placement over many stages and seeds, unchanged stages without the option, generated stages cleared with the gun in hand by 1 player (2 slots) and by 2 to 4. Mutation checks (wall, spend, stun state guard, stage-1 guard, start-room rule) each make tests fail.

### NOT RUN
Browser play, Phaser drawing (aim line, bolt, STUNNED tag), WebAudio zap, the gateway emission of `ghost:shot` and the gateway tests (`socket.io-client` is not installed in my checker), real `npm ci`/`tsc`/`npm run build`.
