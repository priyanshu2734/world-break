# Salvage: carrying, hiding and fitting parts (P3C)

Parts are physical things that players find, carry and fit to broken targets. The server owns all of it: a client only sends an intent and
draws the public state. Every number below lives in one place, `shared/src/salvage/specs.ts` (`ITEM_LIMITS`, `ITEM_KIND_SPECS`); this document mirrors it.
Times are server ticks (20 per second).

## 1. Limits

| Limit | Value | Meaning |
|---|---|---|
| Carry slots per player | 2 | `carrySlots` |
| Light part | 1 slot | every kind except the power core |
| Heavy part (`power_core`, or `slots: 2` in a stage) | 2 slots | needs both hands empty, and blocks any other pick-up |
| Pick-up reach | 70 px horizontal, 60 px vertical (`RANGE_DY`) | `pickupRange` |
| Open a stash | 70 px | `openRange` |
| Fit a part to a target | 80 px | `installRange` |
| Hand over | 90 px between giver and receiver | `handoverRange` |
| A target's needs become visible | team has stood within 160 px | `needsRevealRange` |
| Gap between two item intents of one player | 4 ticks (0.2 s), refused intents count too | `minGapTicks` ("Too fast.") |
| Wait after a drop or swap before picking up | 10 ticks (0.5 s) | `dropCooldownTicks` |
| Wait after a hand-over before the next one | 20 ticks (1 s) | `handoverCooldownTicks` |
| Carried parts an armed discharge can destroy per hit | 1 (the one picked up last) | |
| Safe time after a part was burned | 100 ticks (5 s) | `hazardGraceTicks` |
| Parts per stage | 12 | `maxItemsPerStage` (authoring bound; nothing spawns at runtime) |
| Targets with needs per stage | 8 | `maxNeedsPerStage` |
| Stashes per stage | 6 | `maxStashesPerStage` |
| Parts per need | 1 to 2 | `NeedDef.items` |
| Lone-player trips a stage may require | 12 | `maxTripsPerStage` (a heavy part = 1 trip, two light parts = 1 trip) |
| Authored height above a platform | at most 40 px | `maxAuthoredFall`: the part rests on the first surface below |

Part kinds: `fuse`, `flux_coil`, `coolant_cell`, `valve_wheel`, `access_key`, `battery`, `revive_cell` (light) and `power_core` (heavy).
Only the Fuse, Flux Coil and Battery are used by a stage today (the hunt). The other kinds exist so later stages can use them; `revive_cell` has no behaviour yet (revival belongs to a later phase).

## 2. Actions and keys

A player sends `item:action` with one of these intents (validated by `ItemActionSchema`, then by the rules; a refusal changes nothing).

| Intent | Key | Rule |
|---|---|---|
| `pickup { itemId }` | **E** | part in reach, on the ground, enough free slots, not in drop cooldown |
| `open { stashId }` | **E** (when no part is in reach) | opens a visible container; reveals what is inside, or says it is empty |
| `drop { itemId }` | **G** | puts down the part picked up last (**Shift+G**: the older one); it lands on the first platform below you |
| `swap { dropId, pickId }` | **G** (when a part lies in reach and the hands are full) | drops one carried part and takes one lying nearby in one step |
| `install { itemId, targetId }` | **F** | the part must be carried, of a kind the target still needs, within 80 px |
| `handover { itemId, toPlayerId }` | **H** | gives the part picked up last to the nearest teammate within 90 px who has room |

E falls back to the normal "use" when no part or closed stash is in reach. Parts cannot be handled while channelling a repair.
The client chooses targets for convenience only (`client/src/ui/itemView.ts`); the server re-checks everything.
On a disconnect or a leave, a player's parts are dropped at their last safe footing (outside any armed hazard); with no safe footing, at the arena spawn.

## 3. Needs and clue clarity

A stage can say that a target (breakpoint, conduit or entity) needs parts (`StageDef.needs`). While parts are missing, the Flux Welder refuses the target (before spending a charge)
and `interact` on a console, switch or cache is refused. The team sees a target's needs only after somebody stood within 160 px of it; an unrevealed hidden breakpoint is never listed.
The room difficulty sets the clarity:

| Difficulty | What `items.needs` shows | Refusal text | `cracked` mark |
|---|---|---|---|
| easy | part names, required tools, the author's one-line hint | "It cannot be finished yet. Missing: Flux Coil." | shown on parts with a tell |
| intermediate | silhouettes only (`small` or `heavy`), tools, no hint | "It cannot be finished yet. It still needs 1 part." | shown |
| hardcore | nothing until a first attempt on that target (a refused repair or an install), then silhouettes and no tools | "It will not take. Something is missing." | never shown |

An installed part is shown by name at every clarity. Hint lines name no coordinates and no step (the hunt's tests check this).

## 4. Hiding, decoys and destroyed parts

* **Hidden parts** are never published (not even as "unknown"). `hidden.reveal: 'scan'`: the Phase Scanner reveals it within its radius. `hidden.reveal: 'interact'`: the part sits in a visible stash
  (`StageDef.stashes`); `open` reveals it. Stashes may be empty and look the same until opened. The open intent names a stash, never a part.
* **Non-disclosure.** A hidden, destroyed or nonexistent part id gets the byte-identical refusal in every action (`Nothing there.` / `You are not carrying that.`); an unrevealed or unknown install target likewise.
* **Ability gates.** `gate: 'gravity_well' | 'freeze' | 'duplicate' | 'momentum'` marks a spot a lone player cannot reach on foot. The validator requires the stage to enable that ability and the spot to really be out of reach.
* **Decoys.** A decoy of the right kind can be picked up and carried like any part; when it is fitted it shatters, is gone, costs the stage's `wrongTargetPenalty` (score category `wrong_part`), and the need stays unmet.
  `tell: true` publishes `cracked: true` (not in hardcore). A decoy without a tell is indistinguishable from a good part. The decoy flag itself is never published.
* **Hazards.** An armed arc discharge that hits an unshielded player destroys one carried part (the last picked up) and gives 5 s of grace. Fitted parts are immune. A shield stops the loss.
* **Destroyed** (shattered, burned) and **consumed** parts leave the public state. Only `in_world`, `carried` and `installed` parts are published.

## 5. Solvability

`validateSalvage` (called from `validateStageDef`) checks, for ONE player starting at spawn 0: every part and stash is on a platform reachable on foot (real `stepBody` physics) or carries an enabled gate;
every mandatory need is matched to a distinct, genuine (non-decoy), revealable part that can be carried to the target (bipartite matching: a part never serves two demands); the 2-slot trip count is within the bound;
only the Flux Welder may be a required tool. Hazards, crates and timing are not modelled, so the authored hunt is also proven by a real-physics bot (`server/test/salvage/hunt.solvability.test.ts`).

## 6. Stage 1: "Cold Start: Salvage" (the hunt)

Stage 1 is the hunt when the server runs with the hunt on, which is the default for `npm run dev:server`.
**`HUNT_STAGE=0` restores the old tutorial as stage 1** (bash `HUNT_STAGE=0 npm run dev:server`; PowerShell `$env:HUNT_STAGE = "0"; npm run dev:server`; cmd `set HUNT_STAGE=0 && npm run dev:server`).
The server log prints `stage 1: salvage hunt` or `stage 1: tutorial`. Stage 2 and later are generated as before (the game stays endless). Rooms built in code get the tutorial unless they pass the hunt option
(`new Room(code, ticks, seed, { hunt: true })`).

The failure chain is the tutorial's. What changes is what the repairs demand:

* The cracked flux coupling cannot be welded until a genuine **Flux Coil** is fitted. Nobody starts with one.
* The only genuine coil is **hidden** in the maintenance locker on the top-right deck. A second coil on the first platform is visibly **cracked** (a decoy that shows its crack).
* **Breaker 2** will not close until a **Fuse** is fitted. A spare Battery lies beside the fuse and nothing needs it. Two hands: you cannot carry the whole pile.
* The phase locks and the core console work as in the tutorial.

How to play it (solo is enough; teammates make it faster):

1. Start `npm run dev:server` and `npm run dev:client`, create a room, press Start.
2. On the first low-left platform, scan (key 1 is the Scanner: press **1**) so the coupling appears. Walk up to it and read "Needs: Flux Coil" above it.
3. Pick up the Fuse (**E**). Notice the Battery and the red-marked cracked coil; your hands hold two parts.
4. Climb to the top-right deck, open the locker (**E**). Hands full: **G** swaps the cracked coil for the real one.
5. At the coupling, **F** fits the coil, then weld it with **2**. At Breaker 2, **F** fits the Fuse, then continue the power route, phase locks and core as in the tutorial.
6. Fitting the cracked coil by mistake shatters it and costs score; the real coil is still in the locker.
7. With teammates: one can fit the fuse and route the power while another hunts the coil; **H** passes a part to a nearby teammate.

## 7. Colour and shape language (client)

Red = danger (a cracked part), cyan = interactive (parts and opened containers), amber = hidden clue (a closed stash), green = repaired (a fitted part). Each part kind has its own silhouette,
so colour is never the only cue: fuse bar, flux coil ring, coolant cell hexagon, valve wheel spoked wheel, access key triangle, battery capped cell, revive cell cross, power core block. The carry HUD (bottom right) shows two slots;
a heavy part spans both.
