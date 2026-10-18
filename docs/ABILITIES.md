# Reality abilities (P3B)

Five bounded abilities that change how the world behaves. The server is authoritative for every rule on this page; the client only
draws the HUD and fills in convenient targets. Single source of truth for the numbers:
`packages/shared/src/abilities/specs.ts` (`ABILITY_SPECS`, `ANCHOR_RULES`, `ENERGY_*`, `MOMENTUM_*`, `WELL_*`, `MAX_*`, `PLATE_*`).
Time: the server ticks at 20 Hz, so 20 ticks = 1 s.

## 1. Support status

An ability is marked **Supported** only when the tests named next to it exist and pass (full suite: client 43, server 629, shared 86 =
758 passed, 0 failed, on the developer's machine and in the sandbox). "Supported" means server rules, physics, public state and at
least one end-to-end test through the real `Room` pass. It does not mean balance-tuned by playtest.

| Ability | Status | Evidence (paths relative to `packages/`) |
|---|---|---|
| Gravity Well (flip / reduce) | **Supported** | `server/test/abilities/physics.room.test.ts` (flip lifts, reduce jumps higher, expiry, caps, range, arena bounds); `shared/test/sim.world.test.ts`; `server/test/abilities/parity.test.ts`; `server/test/abilities/lab.solvability.test.ts` (ledge needs it) |
| Freeze (objects and hazards) | **Supported** | `server/test/abilities/system.test.ts` (Freeze: objects / hazards); `server/test/abilities/lab.solvability.test.ts` (arc console needs it) |
| Duplicate (copies that hold plates) | **Supported for holding pressure plates** | `server/test/abilities/duplicate.test.ts`; `server/test/abilities/lab.solvability.test.ts` (two heavy plates need it) |
| Duplicate: "block a beam" | **NOT supported (not implemented)** | There are no beams in P3B. A copy occupies space and presses plates; it blocks nothing else. |
| Momentum (self and objects) | **Supported** | `server/test/abilities/physics.room.test.ts`; `shared/test/sim.world.test.ts`; `server/test/abilities/duplicate.test.ts` (thrown crate); `server/test/abilities/lab.solvability.test.ts` (island plate needs it) |
| Anchor placement rules | **Supported** | `server/test/abilities/system.test.ts` (Anchor placement rules); `server/test/abilities/physics.room.test.ts` (Anchor pins an area stable) |
| Reality Energy: cap, costs, regeneration by BREAKPOINT repairs | **Supported** | `server/test/abilities/system.test.ts`; `server/test/abilities/lab.solvability.test.ts` (economy) |
| Reality Energy: regeneration by CONDUIT repairs (+15) | **Implemented, NOT tested** (no test repairs a conduit; treat as unsupported until one passes) | none |
| Physics migration (shared step, prediction parity) | **Supported** | `shared/test/sim.baseline.test.ts` (bit-exact against the P2 step); `shared/test/sim.world.test.ts` (fuzz); `server/test/abilities/parity.test.ts` |
| Ability Lab (hand-authored, outside the rotation) | **Supported** | `server/test/abilities/lab.solvability.test.ts` (1, 2, 3, 4 bots), `lab.room.test.ts`, `server/test/gateway.lab.test.ts`, `fuzz.room.test.ts` |

Reported by the developer, not automated: the Lab was played in a real browser after step 3 and all abilities worked. Nothing in the
automated suite renders Phaser, so HUD layout, mouse aiming and the drawing of zones, plates and props rest on that report.

## 2. Limits table

| | Gravity Well | Freeze | Duplicate | Momentum | Anchor (P2 tool + P3B rules) |
|---|---|---|---|---|---|
| Key (client) | 6 (Shift = reduce) | 7 | 8 | 9 (Shift = cancel) | 3 |
| Energy cost | 30 | 25 | 30 | 20 | 0 |
| Cooldown (per player) | 300 ticks (15 s) | 240 (12 s) | 80 (4 s) | 160 (8 s) | 100 (5 s) |
| Duration | 120 ticks (6 s) | 60 (3 s) | copy lives 160 (8 s) | instant | 400 (20 s) |
| Range | 260 px, body centre to the point | 240 px to an object, 240 px + its radius to a hazard | 260 px to the source AND to the placement point | 200 px to an object; self needs none | 0 (planted where you stand) |
| Per-player cap | 1 active | 1 active | 2 copies alive | none | 2 charges (P2) |
| Per-room cap | 2 active | 3 active | 4 copies alive | none | 2 active |
| Effect size | zone 320 x 320 px (clamped inside the arena) | one object or one hazard | one 32 x 32 px crate | 600 px/s per axis, lateral part fades over 8 ticks | radius 140 px (P2) |
| Targets | a point | a prop or an arc discharge (never gravity flux) | a light, original prop you may affect | `self` or a prop | none |

Shared by all: Reality Energy cap **100**, everyone starts a stage at **100**; **+30** to every player when the team completes a
breakpoint repair (tested), **+15** for a conduit repair (implemented, not tested); nothing else regenerates unless a stage opts in with `passiveRegenTicks`
(the Lab and the rotation do not). Rate limit: one ability intent per player per **6 ticks**, accepted or refused (stage actions keep
their own 3-tick gap).

**Rules implemented but without a dedicated test** (an honest list; they are not claimed as supported):
the +15 energy for a conduit repair; Momentum's 200 px range limit on objects (no test refuses a push that is too far away); and the
per-player "1 active" caps of Gravity Well and Freeze. Those two caps are defence in depth: with the default numbers the cooldown
(300 and 240 ticks) is longer than the effect (120 and 60 ticks), so a player cannot reach them by play, and no test reaches the refusal
messages. The per-player cap of Duplicate (2 copies) and every room-wide cap ARE tested directly.

Anchor placement rules (P3B): the caster stands on a solid (feet on a platform top), at least 40 px from the left and right edges, at
least 120 px from any other active anchor, and at most 2 anchors are active in the room. A refused anchor spends nothing.

Hard bounds behind the caps (defence in depth, tested): at most **12 props** alive per room (stage props plus copies), **6** authored
props per stage, **8** gravity zones listed, **16** impulse events listed. Impulses are clamped to +-600 px/s per axis and NaN/Infinity
become 0. Props are capped at 700 px/s. Flipped gravity is capped at terminal velocity (900 px/s) so nothing accelerates without bound.

## 3. How an intent is judged

`ability:use` carries an `AbilityAction`; Zod rejects malformed payloads (unknown keys, NaN, Infinity, coordinates beyond +-5000, bad ids)
with "Invalid ability request". The ability system then checks, in this order, and spends nothing on any refusal:

1. member of the run and connected, stage running; 2. ability enabled in this stage; 3. rate limit; 4. cooldown; 5. energy;
6. target exists, range, ownership, per-player cap, per-room cap, placement rules.

Ownership: stage props belong to nobody and anyone may affect them. A copy belongs to its maker; nobody else may freeze or push it.
Momentum on another player is not possible (`self` or a prop only). Copies cannot be copied, heavy props cannot be copied.

Messages the server can return (the HUD shows them verbatim): `You are not part of this run.`, `This stage is already stabilised.`,
`Reality abilities are not available in this stage.`, `That ability is not available here.`, `Too fast.`,
`That ability is still recharging.`, `Not enough Reality Energy.`, `Too far away.`, `Too far away to place a copy there.`,
`That point is outside the arena.`, `A gravity anchor holds this area steady.`, `You already have a gravity well running.`,
`The room already has 2 gravity wells.`, `Nothing there to freeze.`, `You already have something frozen.`,
`The room already has 3 frozen things.`, `Gravity flux cannot be frozen. Anchor it.`, `That is already frozen.`,
`That object belongs to another player.`, `Frozen objects cannot be pushed.`, `Nothing there to push.`, `Nothing there to duplicate.`,
`A copy cannot be copied.`, `That object is too heavy to duplicate.`, `You already have 2 copies.`,
`Too many copies exist right now.`, `There is no room to place a copy there.`; and for the Anchor tool: `A gravity anchor needs solid
footing.`, `Too close to the edge to plant an anchor.`, `Only 2 anchors can hold at once. Wait for one to fade.`,
`Too close to another anchor.`

## 4. What each ability does

* **Gravity Well.** Opens a 320 x 320 px zone centred on the point you aim at (shifted to stay inside the arena). `flip` sets vertical
  gravity to -1800 px/s^2 (the exact opposite of normal), `reduce` to +450. The zone is public data (`GameSnapshot.world.zones`); players
  and crates inside it follow its gravity, judged by the body centre at the start of each sub-step. It cannot be opened with its centre
  inside an active Anchor's radius ("an anchor pins an area stable"). Leaving the zone sideways returns normal gravity: nobody is trapped.
* **Freeze.** Stops a prop dead (velocity zeroed, immune to gravity, zones and pushes) or holds an arc discharge mid-cycle: its pulse
  countdown pauses and resumes when it thaws. Gravity flux is not freezable (it is answered by an Anchor).
* **Duplicate.** Makes a copy of a light, original crate at a point you choose; it drops from there under normal physics, lasts 8 s, and
  then disappears. Copies press plates exactly like the original. See section 5.
* **Momentum.** `up`, `down`, `left`, `right` or `cancel`. On yourself: a vertical impulse once, and a lateral push that fades linearly
  over 8 ticks (about 135 px of travel at 600 px/s); `cancel` kills your vertical speed. On a crate: adds up to 600 px/s per axis (it then
  slides with friction 0.82 per tick on the ground, falls off ledges, and stops against walls and the arena edge); `cancel` stops it dead.
  A jump plus a Momentum shove reaches about 325 px up at best; stage authors must keep required climbs above that.
* **Anchor.** The P2 Gravity Anchor tool, unchanged limits, plus the placement rules in section 2. Costs no Reality Energy.

## 5. Objects and plates

Crates are the only prop kind. They are simulated by the server, never collide with players or each other, and are drawn by the client
from the snapshot. A **pressure plate** is a stage entity used as a control of a `timed_controls` objective with `armTicks: 1`: the
objective completes at the moment ALL of its plates are pressed at once, and latches. A plate is pressed when something stands on it
(centre within 24 px, feet within 3 px of its surface). `activatedBy: 'any'` is pressed by a player or a resting prop; `'object'` (a
heavy plate) only by a RESTING prop; a prop in flight never presses. No new objective kind exists, so older exhaustive switches are intact.

## 6. Using abilities in a stage

* `StageDef.abilities = { enabled: AbilityId[], energyMax, energyStart, passiveRegenTicks }` (optional; absent = P2/P3A behaviour).
* `StageDef.props = [{ id, kind: 'crate', x, y, light }]` (max 6; feet-centre on a platform, not overhanging it).
* `StageDef.arenaId` selects the arena through `getArena(id)`. An id that is not registered is a validation error (`arena mismatch`): stage 1 would refuse to start and a later stage would be replaced by the fallback stage.
* Rotation: `ABILITIES_IN_ROTATION` in `server/src/abilities/defaults.ts` is `true`, so generated stages (stage 2 and up) and the fallback
  stage offer every ability with the default economy; the tutorial (stage 1) never does. Generated stages have no props, so Duplicate has
  nothing to copy there. Set the constant to `false` to confine abilities to stages that declare them (the Lab).
* The validator accepts an arc discharge without a Shield Projector in the loadout only if Freeze is enabled and the channel fits in one
  freeze with 10 ticks to spare (`FREEZE_CHANNEL_SLACK_TICKS`). It rejects stages whose plates, props or abilities are malformed.

## 7. Protocol surface (all additive and optional)

| Item | Direction | Notes |
|---|---|---|
| `ability:use` | client to server | payload `AbilityAction`; ack `{ ok, message }` or `{ ok: false, error }` |
| `GameSnapshot.world?` | server to client | `{ zones, impulses, props }`; absent when empty, so pre-P3B snapshots are unchanged |
| `StageState.abilities?` | server to client | enabled abilities, energy cap, per-player energy and cooldowns, active counts |
| `StageState.hazards[].frozenUntilTick?` | server to client | only while frozen |
| `pressure_plate` entity kind | server to client | state `idle`, `pressed` or `complete` |
| `JoinPayload.lab?`, `RoomSnapshot.lab?` | both | Ability Lab dev flag, see section 8 |
| `stepBody(body, input, arena, world?)` | shared | optional 4th parameter; default path is bit-exact with P2 (see ARCHITECTURE.md) |

## 8. The Ability Lab (dev stage, not in the rotation)

Stage "Reality Calibration" on its own arena (`ability-lab-01`), six independent stations: Anchor console, Freeze console, Gravity Well
ledge, Momentum island plate, Duplicate heavy plates, and two capacitors (repairs). Every ability is required by at least one station.
One player needs 105 energy of abilities and starts with 100, so at least one repair is required.

**Open it in a browser**

1. Start the server with the flag (its log then prints `Ability Lab: ON, open /?lab=1`):
   bash / zsh / Git Bash `ABILITY_LAB=1 npm run dev:server`; PowerShell `$env:ABILITY_LAB = "1"; npm run dev:server`;
   cmd.exe `set ABILITY_LAB=1 && npm run dev:server`.
2. Start the client: `npm run dev:client`.
3. Open **http://localhost:5173/?lab=1**. This creates a new Ability Lab room (the lobby shows `ABILITY LAB (dev)`); press Enter to start.
4. Other players join with the room code (`http://localhost:5173/#CODE`); the room already is a Lab room, so they need no parameter.

The flag counts only when a room is created. With the server flag off, `?lab=1` shows "The Ability Lab is not enabled on this server
(start it with ABILITY_LAB=1)." and creates no room; without `?lab=1` you get the normal game. The Lab is stage 1 of that room; the
host's "next stage" continues with the normal stage 2. Hold R (host) resets the Lab.

**What proves each ability is required.** The solvability test plays the real server path with 1 to 4 bots. For each of Gravity Well,
Momentum, Duplicate and Freeze it solves every other station and shows the skipped one stays open; the Anchor console refuses until an
anchor is planted. Extra proofs: no jump, even boosted by one Momentum shove at any of 9 moments, reaches the ledge (about 14,000
combinations simulated with the shared step; a control with a well does reach it); the island plate and both duplicate plates are heavy
(players cannot press them); no standing point has the crate and the island plate in Duplicate range together; a crate pushed any other
way never presses the island plate. Mutation checks (arc period, ledge height, plate weight) confirmed these tests fail when the design is broken.

**Stations (spoilers).**

| Station | Solution |
|---|---|
| Capacitors | Scanner (1), then Welder (2) on the drained capacitor on the low platform at the left; each repair gives +30 energy to everyone |
| Anchor console | Plant an Anchor (3) beside the console on that platform, then channel with E |
| Freeze console | On the floor under the arcs: Freeze (7) the arc, then channel with E at once (3 s freeze, 2.25 s channel) |
| Ledge plate | Far-right platform: aim a flip well about 150 px above you and slightly left, press 6, ride up without moving, steer left onto the ledge |
| Island plate | Upper-left platform: mouse on the crate, hold Left or A, press 9; the crate flies onto the island and slides to the wall |
| Two heavy plates | Between the plates on the right platform: mouse on the empty plate, press 8; the original holds one plate, the copy the other |

## 9. Known limits and things not done

* "Block a beam" is not implemented (no beams). Duplicate holds plates only.
* "Required" is shown for the intended mechanics only. It is not a proof that no exotic multi-ability chain exists, for example lifting a
  crate with a flipped well and pushing it with several Momentum shoves to avoid a Duplicate.
* The island crate reaches the island only if shoved from near its authored spot (x 340 to 378). A wrong shove needs a reset (hold R, host)
  or a copy of the crate.
* Numbers are the GAMEPLAY.md section 4 defaults and were checked by tests and by one developer playing the Lab; they are not
  balance-tuned for the endless rotation, where abilities are on by default.
* Events created after a snapshot (a teammate's well) are unknown to the client's prediction until the next snapshot; the server
  wins and corrects. A body hovering exactly on a zone edge can differ by one sub-step (a few px) because snapshots round to 0.01 px.
* Combinations of disasters and abilities are out of scope (P3C), as are health and death (P4).
