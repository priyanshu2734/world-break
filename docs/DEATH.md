# DEATH (P4)

Status: **steps 1 and 2 of 5 done** (death core, spectating). Revive, stage flow and review are steps 3 and 4; see `docs/handoffs/P4.md`.

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

## Not done yet
Revive Cell action, generator placement, Hardcore exclusion (step 3; `revive_cell` already exists as an item kind). Retry with a new seed, clear rule, dead return, death review screen (step 4). Strict solver (step 5).

## Test hooks
`DeathSystem.setLethal(false)` is used ONLY by `test/ghost/gun.solve.test.ts` to measure that generated stages are solvable (not that a bot survives the ghost).
