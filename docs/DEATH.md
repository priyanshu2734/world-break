# DEATH (P4)

Status: **steps 1 to 3 of 5 done** (death core, spectating, revive). Stage flow and review are step 4; see `docs/handoffs/P4.md`.

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

## Spectating (step 2)
| Rule | Where |
|---|---|
| A dead player (body or eliminated) is shown the ghosts and the teammates their TARGET can see, through the target's eyes and flashlight, plus the team list (with each player's life). Nothing else: `restrictedView` with `spectator: true` returns a BLANKED stage state (no items, doors, keypads, safes, clues, switches, exit, objectives, entities, tools, feed, disaster, abilities) and no world props. | `rooms/view.ts` |
| A hidden teammate stays hidden from a spectator. | `rooms/view.ts` |
| With nobody to watch, the spectator gets the team list only. | `rooms/view.ts` |
| Target: the next living, connected teammate after them in team order; `spectate:follow` takes an id, `next` or `prev`; yourself, the dead and strangers are refused. When the target dies or disconnects the camera moves on at the next tick to the next living teammate after it (deterministic); a revived player stops being a spectator. | `death/spectate.ts` |
| The spectator is sent the layout (walls and doorways) of the room their target is in, when the target or its room changes. No other room. | `Room.syncSpectatorLayouts` |
| Ghost-here ping: no payload. The position is the nearest ghost in the spectator's OWN view, computed by the server; refused with `No ghost in view.`; one per 3 s (`Too fast.`); sent to the living in that room and to spectators watching that room, and to the sender. Bounded queue (16). | `Room.spectatePing`, `SPECTATE` in `shared/death.ts` |
| Every control input from a dead player is refused with `You are dead. You can only watch.`: `game:input`, `stage:action`, `ability:use`, `escape:action`, `item:action`, `ghost:action` (hide, leave, fire), and the host's arena reset. `spectate:*` is refused for the living (`You are not dead.`). | `room.ts` |
| `death:state` goes to ONE player when it changes and once a second: life, whom they watch, who they can watch, ping wait, revive time left. | `gateway.ts` |

Client: `ui/death/spectateLogic.ts` (pure, tested) and `ui/death/SpectateView.ts`; `GameScene` does not predict a dead player, and the camera, room and light follow the watched teammate. Keys: left and right arrows switch, G pings.

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

## Not done yet
Retry with a new seed, clear rule, dead return, death review screen (step 4). Strict solver (step 5).

## Test hooks
`DeathSystem.setLethal(false)` is used ONLY by `test/ghost/gun.solve.test.ts` to measure that generated stages are solvable (not that a bot survives the ghost).
