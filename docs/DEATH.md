# DEATH (P4)

Status: **step 1 of 5 done** (death core). Spectating, revive, stage flow and review are steps 2 to 4; see `docs/handoffs/P4.md`.

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

## Not done yet
Spectator view (`eyes`), follow and ghost-here ping (step 2). Revive Cell action, generator placement, Hardcore exclusion (step 3; `revive_cell` already exists as an item kind). Retry with a new seed, clear rule, dead return, death review screen (step 4). Strict solver (step 5).

## Test hooks
`DeathSystem.setLethal(false)` is used ONLY by `test/ghost/gun.solve.test.ts` to measure that generated stages are solvable (not that a bot survives the ghost).
