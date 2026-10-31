# DEATH (P4)

Status: **P4 complete** (death core, spectating, revive, stage flow and review, solver and docs). What each rule is backed by is in `docs/handoffs/P4.md`; see `docs/handoffs/P4.md`.

## Rules in force after step 1
| Rule | Value | Where |
|---|---|---|
| Touch kills | contact 0.3 s (6 ticks), line of sight, never a hidden player | `ghost/system.ts catchCheck`, `death/tuning.ts` |
| Easy / Intermediate | `alive -> downed` (a body) for 45 s, then `eliminated` | `death/system.ts` |
| Hardcore | `alive -> downed -> eliminated` in the same tick, no window | `death/system.ts` |
| Spawn grace | no kill in the first 20 s of a stage | `DeathSystem.canKill` |
| Satiated ghost | 8 s quiet after a kill (no sensing, hunting, moving or killing) | `ghost/system.ts satiate` |
| Protection after revive | 5 s (the transition exists; the Revive Cell action is step 3) | `DeathSystem.revive` |
| Items | one carried part dropped per few ticks at the body; `dropAll` after 80 failed attempts | `DeathSystem.step` |
| Rest | nearest reachable floor, deterministic; relocated items are flagged in the log | `salvage/dropRest.ts` |
| Dead player | frozen, every input refused (`You are dead. You can only watch.`); the stage engine sees them as not connected (a body on the exit does not clear the stage) | `room.ts` |
| Exit and death on one tick | the exit wins: a cleared stage skips the ghost and death step | `Room.tick` |
| Event log | ring of 300, every entry carries its tick | `DeathSystem.events` |

All numbers live in `DEATH_TABLE` (`death/tuning.ts`); none depends on the stage (pinned at stages 1 and 1,000,000).

## Spectating (steps 2 and 6)
**Step 6 replaced the step 2 rule.** A dead player used to see only through a living teammate's light and could not move. Now they are a **free-fly spectator**: a camera, not a body.

| Rule | Where |
|---|---|
| A dead player (body or eliminated) is shown EVERY teammate and EVERY ghost on the stage, wherever they are (position and look), and the team list with each player's life. Nothing else: `restrictedView` with `spectator` and `fly` returns a BLANKED stage state (no items, doors, keypads, safes, clues, switches, exit, objectives, entities, tools, feed, disaster, abilities) and no world props. No teammate's eyes or light limit it. A teammate who hides is shown at their spot (a spectator sees every teammate); nothing in the message says a spot exists. | `rooms/view.ts` |
| The camera is the server's too: each spectator has one (`SpectateSystem`), either sitting on the teammate they follow or flying free. Movement keys send an INTENT (-1, 0 or 1 per axis, validated by Zod; no speed, no position); the camera moves at most `SPECTATE.camSpeed` (640 px/s, a diagonal no faster), is clamped inside the arena of its room, passes through walls (a camera has no body) and has no exit: there is nothing for it to leave through and it never leaves the rooms of the stage. At most one camera message per 2 ticks per spectator; an intent lapses after half a second of silence. The client predicts the same step (`stepSpectatorCam`, shared) and snaps to the server's camera when the room differs or the two drift by more than 160 px. | `shared/death.ts`, `death/spectate.ts`, `ui/death/flyLogic.ts` |
| Rooms: `spectate:room` takes `next`, `prev` or a room id of this stage (anything else is refused with "There is no such room."); the camera lands in the middle of the room and flies free. The spectator is sent the layout of the camera's room with its walls and floors and NO doors, once per room switch. | `Room.syncSpectatorLayouts`, `queueLayout` |
| Follow: still there. A spectator starts on the next living teammate in team order; `spectate:follow` takes an id, `next` or `prev` (Z and X) and returns the camera to the teammate (F). When the followed teammate dies or disconnects the camera moves on at the next tick to the next living teammate after it (deterministic); with nobody left to follow the camera flies free. A revived player stops being a spectator. | `death/spectate.ts` |
| Ghost-here ping (G): no payload. The position is the ghost nearest the camera (one in the camera's room first), chosen by the server; one per 3 s (`Too fast.`); sent to the living in that room and to spectators whose camera is in that room, and to the sender. It no longer needs a living teammate to look through. Bounded queue (16). | `Room.spectatePing` |
| Every control input from a dead player is refused with `You are dead. You can only watch.`: `game:input`, `stage:action`, `ability:use`, `escape:action`, `item:action`, `ghost:action` (hide, leave, fire), and the host's arena reset. The camera messages change nothing in the live world (the body stays where it fell). `spectate:*` is refused for the living (`You are not dead.`). | `room.ts` |
| `death:state` goes to ONE player when it changes (life, whom they follow, camera room or mode, ping wait, revive progress) and once a second: it carries the camera and the room ids of the stage for a dead player, nothing for the living. | `gateway.ts` |

Client: `ui/death/spectateLogic.ts`, `flyLogic.ts` (pure, tested) and `SpectateView.ts`. Keys: WASD or arrows fly, Q and E switch rooms, Z and X pick a teammate, F follows, G pings. The dark layer is off for a spectator (the whole room is lit) and a list shows which room each teammate and ghost is in.

## Revive (step 3)
| Rule | Where |
|---|---|
| ONE Revive Cell per ghost stage on Easy and Intermediate, none on Hardcore. It lies in the open on a floor spot of a random room (so a team may have to fetch it), one hand (fits next to the Pulse Gun in 2 slots), genuine. Drawn AFTER the gun and the evidence, so every earlier draw of a stage keeps its place; the item cap reserves a slot for it. | `rooms/generate.ts` |
| The validator PROVES it: exactly one on Easy/Intermediate, none on Hardcore (`requireRevive`); and for any stage at most one, not a decoy, not hidden, one hand, standing on a floor of its room (`validateEscape`). A stage that fails is regenerated like any other. | `rooms/escapeValidate.ts` |
| Revive action: a living, connected, not hidden teammate who carries the cell HOLDS E for 3 s (60 ticks, no break) within 70 px (and 60 px up or down) of a body in their room. Letting go, stepping away, hiding, dying, losing the cell or the window running out starts it over. One reviver per body, one body per reviver; the nearer body wins. The ghost standing on the body does not stop it (that is the risk). | `death/revive.ts`, `REVIVE` |
| A cell is spent only when the body can really come back (`DeathSystem.canRevive`: inside the window, Easy or Intermediate). A refused revive spends nothing. | `death/system.ts` |
| The player returns ALIVE at the body position with 5 s of protection and EMPTY HANDS: anything still in their hands (a drop in progress) is put down at once; what already fell stays where it fell. | `DeathSystem.revive` |
| The revive progress is told to the reviver (`reviving`) and to the body (`beingRevived`) only. The cell is never in a spectator's view. | `Room.deathState` |
| Client: bodies are drawn faint with a mark; with the cell in hand next to a body the prompt says "Hold E to bring NAME back" and E taps do nothing else (the hold rides on the input stream); a bar shows progress. | `ui/death/reviveLogic.ts`, `SpectateView.setRevive`, `GameScene` |

Logical cases, and what the code does: a revive while the ghost stands on the body works and the protection covers the revived player; two players dying on one tick are both bodies and one cell brings back the nearer; a dead player cannot revive anyone and a cell they carried lies where they fell; dropped things never count against the carrier's 2 slots (they are in the world); a gun dropped by a dead player keeps its recharge (the cooldown belongs to the gun, not to the shooter), so picking it up is no free shot.

## Stage flow and review (step 4)
| Rule | Where |
|---|---|
| Solo death, or nobody left alive and connected (and the dead have put their things down): `TEAM_WIPE`. A 3 s beat on the frozen world (`WIPE.beatTicks`), then `REVIEW`; the review waits for the host and does not move on by itself. `phases.ts` is NOT changed: the existing `playing -> team_wiped -> death_review -> briefing` path is used (`TEAM_WIPE`, `REVIEW`, `RETRY`, then `BEGIN`). | `Room.tick`, `Room.retryStage` |
| With 2 to 4 players the stage goes on while at least one is alive and connected. | `DeathSystem.noneAlive` |
| RETRY: the SAME stage number restarts on a NEW seed `deriveSeed(runSeed, 'stage', stage, 'retry', attempt)`; attempt 0 keeps the seed it always had. The generator validates every seed (8 derived tries of the same stage, never a different stage), so a retry is a validated stage. The number never goes back to 1 (stage 1,000,000 retries stage 1,000,000). Same difficulty. A fresh death system, items, players and spectators: everyone, the dead included, is alive with empty hands. The next stage number resets the attempt to 0. | `Room.buildEngine`, `Room.retryStage`, `StageRecord.attempt` |
| Who may retry: the host; anyone connected once the host has left (a host who disconnects hands the role to the next connected player). Disconnected players are dropped at the retry and at the next stage, like before. | `Room.retryStage` |
| Clear: at least ONE living player at the exit (`STAGE_CLEAR`); a body in the exit does not count (the engine sees the dead as not connected). The dead return for the next stage alive, with empty hands. | `rooms/escape.ts`, `Room.enginePos` |
| Exit and death on the same tick: the exit wins (the ghost and death step are skipped on a clearing tick). Proved for every offset of the touch (cleared at 0 to 5 ticks of contact, a death from 6). | `Room.tick`, `test/death/flow.test.ts` |
| Bonus: `no_deaths` (500 points, `DEATH_TABLE.noDeathBonus`) when a stage is cleared and nobody died on it. A revived death still counts as a death. | `DeathSystem.deaths`, `engine.grantBonus` |
| The Revive Cell lies where a team can reach it WITHOUT SOLVING ANY LOCK: every door of a stage carries a lock, so that is the start room. The generator draws it from the start room only (same draws as before: one pick, one spot) and the validator proves it (`behind a lock` is an error). | `rooms/generate.ts`, `rooms/escapeValidate.ts` |

### The death review
Built ONLY from recorded server events (`death/review.ts`). It is words around facts, never a guess: a player with no recorded death has no review.

| Section | Recorded by |
|---|---|
| Who or what touched you, and why (the ghost's own reasons), time of death | the ghost's `catch` event (`because`), the death system's `killed` event (tick) |
| The last warnings you got | the cue stream the player was sent (`Room.recordReview` words each change once: a warning starting, a sound appearing or coming closer, a ghost at a hiding place, a scream) |
| Noise you made | the ghost's `heard` events for that player (text and tick are the ghost's own) |
| Your hiding attempts | every hide or leave the player asked for, with the server's answer, and the ghost's `inspect` events that found them |
| Items carried, and where they dropped | `killed.carrying`, then `item_dropped` events (room, rest position, whether moved to a reachable floor) |
| Rescues attempted | revive start, give-up and completion, noted for the reviver and for the body |

Each entry carries its tick (shown as m:ss). Rings are bounded (24 notes per player and kind; 8 lines per section). A review names no code, no safe, no clue, no door and no item id: parts by what they are, positions only where they came to rest. Each player is sent THEIR OWN review (`death:review`, one socket) plus a team line of names, lives and times of death; a survivor of a team has none. The review exists only in the `death_review` phase.

### Disconnects (honest scope)
This codebase has no mid-run rejoin (`join` is refused once a run has started), so "reconnect" cannot happen: a player who drops stays in the run as disconnected until the next stage or retry, where they are removed. What IS handled and tested: a dead player who disconnects stays dead and drops nothing twice; living players who all disconnect wipe the team; a host who disconnects during the review hands over to the next connected player, who may retry; a disconnected player cannot retry; the dropped players are gone after the retry and the dead who stayed come back.

## Solvability with death in the game (step 5)
The solver bot (`test/rooms/solver.ts`) can now lose its lead to a death and carry on: the next living player takes over, waits for the dead player's drops to finish, walks to where each part CAME TO REST and picks it up again (within the 2 slots), and finishes the stage. A run in which nobody dies is unchanged. The drills are in `test/death/solve.test.ts` (helper `test/death/drill.ts`) and take about 45 s.

| Claim | Kind | What is asserted | Where |
|---|---|---|---|
| One player, 20 stages (2 to 29 and 1,000,000) x 4 seeds x 3 difficulties, the ghost present but unable to kill: every run clears within 2 slots | STRICT | all 240 runs clear; none dies; none holds more than 2 parts | `STRICT 1` |
| One player, a LETHAL ghost and a hiding reflex (19 stage/difficulty cells x 6 seeds): every run is `cleared` (nobody died) or `died` (a recorded ghost kill); never stuck, never another error. Two runs of a seed give the same answer | STRICT | exact classification, `stuck` is `[]` | `STRICT 2` |
| Two to four players: a scripted death right after ANY part is fetched (the first fetch, the last, or every carrier in turn until one is left; on foot or in the air; 2 and 4 players on Easy over 12 stages x 2 seeds, and 3 players with every carrier killed in turn on all three difficulties): the part is recovered from where it rests and EVERY run still clears. Every dropped part is recovered once, every death changes the lead once | STRICT | all runs clear; recovered = kills; lead changes = kills | `STRICT 3` |
| Where a player can stand on a generated room (more than 20,000 spots on reachable platforms and in the air above them, 20 stages x 2 seeds x 3 difficulties), a dropped part never has to be moved | STRICT | no spot is relocated | `STRICT 4` |
| Whether a bot that hides when warned survives a LETHAL ghost with 2, 3 or 4 players | STATISTICAL | classification only (cleared, died, or the reflex's own timeout), stage 4 always cleared, `reflex <= 4` and `cleared > 35%` of 126 runs | `STATISTICAL` |

**Why "strict" is the stage and "statistical" is the bot.** The generator can promise that a stage is solvable and that a death never makes it unsolvable (the drills prove it, deterministically, for every grid cell). It cannot promise that a bot with a hiding reflex survives a lethal ghost: that depends on the bot. The statistical test is deterministic too (seeded, so it cannot flake), but it is a SAMPLE: it asserts only what the sample supports (early stages are always cleared; later ones are lost to the ghost more often; a run ends cleared, dead or in the reflex's own timeout), not a guarantee. It is a regression guard on the bot, not a claim about the game.

**What the old loose thresholds were.** The P3E tests in `gun.solve.test.ts` asserted "at least 7 of 10" (stage 29), "8 of 10" (Hardcore) and "4 of 5 / 2 of 5" (co-op) because a caught bot dropped its key and never went back. They are now exact. Making them exact also exposed two bot defects that the thresholds had hidden for a whole phase, both fixed in the test helpers: a bot standing up to 14 px beyond a platform's edge could not find its own goal (`Bot.goTo`), and the hiding reflex could pull a player away from a door in the middle of a crossing (`solver.through` now retries it).

**Mutation check.** With the solver's recovery switched off the strict drill fails ("Locked. Needs a key", "recovered 0 of 1"); with it on it passes.

## Safes, hiding spots and the review text (step 6)
* **Every page of a safe lies in the safe's own room**, at a random spot of it (the pages used to lie in the previous room 30% of the time). The validator (`escapeValidate.ts`) refuses a stage whose page is in another room, whose pages do not spell the combination, whose safe has no pages or holds a decoy or something that does not fit in 2 slots. A MANDATORY safe (a `safe` lock: a door needs it) must hold the key or part that opens that door. The optional safe holds the Pulse Gun. Both occur (`test/rooms/safes.test.ts` counts them) and a lone player clears every grid stage that has a mandatory safe within 2 slots.
* **Hiding spots follow the tuning table** (`ghostTuning(difficulty, stage).hidingSpotsPerRoom`: 4 per room early, falling to 1; Easy slowest, Hardcore fastest; stage 1,000,000 has 1), capped by `ESCAPE_LIMITS.maxHidingSpots / rooms`. A ghost stage's spots now lie on their own grid half a step off the item grid, so they never take a slot an item needs and a small room (stage 2) really gets its 4 (before, it got 1: the table's 4 could not fit next to the keys, gun and Revive Cell). Without the ghost the old `hidingSpotsForStage` placeholder is untouched. A spot holds two players (`CATCH_LIMITS.spotCapacity`). Tests at stages 2, 10, 24, 50 and 1,000,000 on all difficulties: `test/rooms/hiding.stages.test.ts`.
* **The review is a full-screen dark panel** above the whole HUD. "What killed you and why" is first and large; times are m:ss only; the server's own wording is made plain on the client (`on appearing` becomes `as it appeared`, your name becomes `you`); each part shows its last 3 lines.
* **The code pad** shows one box per digit with the typed digits in them, and a three-line hint that fits its panel.
* **The N key** is read once per frame (`stageKeyAction`): the next stage after a clear, a retry after a wipe.

## Known issues and limits
* **No mid-run rejoin.** `join` is refused once a run starts, so a "reconnect" cannot happen and was not built. A player who drops stays in the run as disconnected until the next stage or retry. See "Disconnects".
* **No review for a stage that was cleared with deaths.** The review is built when the team is wiped; a stage the survivors clear shows none. `death:review` is sent once.
* **`dropRest` knows platforms, not walls or gates.** A part dropped at a spot no player can occupy (inside a wall column) can be moved across a closed gate. On generated stages the only such spots are inside the stage 2 gate wall at the very top (a test lists them, so a change shows). No death position a player can reach is moved at all (`STRICT 4`). If a later phase adds a standable spot beside a gate, give `dropRest` the doors.
* **The Revive Cell is in the start room.** It is always reachable without solving a lock, at the price of being predictable: it is never somewhere a team must hunt for.
* **A spectator sees hiding teammates.** The step 6 rule shows every teammate to a spectator, including one hiding; a spectator who tells the living where someone hides (outside the game) can undo a hiding place. In-game there is no channel for it: a ping carries only a ghost's position.
* **Ghost kind in the review.** `review.cause.ghostKind` and the cue notes name the ghost's type (`wisp`, `shade`, `howler`). Fine while types are visible; P3F's evidence game must stop that before it hides the type.
* **Hiding bot and a ghost that cannot kill.** In a harness where the ghost cannot kill, a hidden bot is hunted for ever and the reflex times out (`hide detour did not end`); it is the reason `gun.solve` classifies its failures instead of asserting every clear.
* **Cue notes** are sampled once per tick and worded once per change, so a very short warning inside one tick would not be noted.
* **Test time.** The server suite now takes about 2.5 minutes on the machine it was measured on (the drills are about 45 s of it).
