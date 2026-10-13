# P1 Handoff: Playable Multiplayer Core

Baseline: commit `316743a` (P0). P1 builds on it without removing or renaming any P0 API, event, field or test.

## What P1 delivers
- Authoritative 20 Hz simulation (`GameSim`, drift-correcting `startFixedLoop`), one input consumed per player per tick.
- Deterministic movement/collision (`shared/src/sim.ts`) with 4 sub-steps per tick (no tunnelling), world bounds, solid platforms.
- Hand-authored arena `relay-platform-01` (`shared/src/arena.ts`), 4 stable spawns on open floor, reachability proven by simulation in tests.
- Lobby -> briefing (3 s server countdown, existing `START`) -> playing (existing `BEGIN`) flow.
- Snapshots every tick to every room member (`game:snapshot`, volatile), validated with Zod on the client.
- Client: local prediction + server reconciliation (same shared `stepBody`), snapshot interpolation for remote players (100 ms delay), error smoothing, hard resync on arena reset.
- Disconnect handling: in-run disconnects stay visible and flagged; host migrates; room deleted when nobody is connected.
- Reset: host-only, restores spawn state, bumps `epoch`, drops disconnected players, stays in `playing`.
- HUD: players, slot colour, "(you)", host tag, connection dot, stage, difficulty, sim clock, room code, online state, briefing banner, reset toast and hold-bar.
- Health is NOT shown: the shared model has no health value (only the PlayerLife state machine, which P1 does not drive).

## Shared contract changes (all additive)
`protocol.ts`: added `GameInputSchema`, `GamePlayerSchema`, `GameSnapshotSchema`; events `game:input` (C->S, no ack), `game:reset` (C->S, ack), `game:snapshot` (S->C). New exports `arena.ts`, `sim.ts`. `RoomSnapshot`, `room:*` events and `phases.ts` are unchanged.
Server: `Room` gained `tick/submitInput/disconnect/resetArena/gameSnapshot/connectedCount` and an optional `briefingTicks` ctor arg; `RoomManager` gained an optional options arg and `forEach`; `createGameServer` gained `briefingTicks` option. Client `Session` gained `game/buffer/gameSerial/sendInput/resetArena`.
Behavioural note: `Room.start()` now also creates the simulation. Joining after start is still rejected.

## Bugs found by real-browser testing (and fixed)
1. Phaser's `update(delta)` is smoothed/clamped at low FPS, so prediction ran at ~25% speed. Simulation now uses `performance.now()`.
2. Inputs were sent with `socket.volatile`, which drops bursts after a hitch. Now reliable; server backlog raised to 8 (trim to 4).
3. Arena spawns 0 and 3 sat under platforms (jump head-bump). Spawns moved; regression test added.

## Known issues
- Browser verification ran in a software-rendered sandbox at ~3-4 FPS per tab. Logic, sync, reset and disconnect are verified; render smoothness at 60 FPS on real GPUs is NOT verified.
- No reconnect: a dropped player cannot rejoin the run (ghost remains until reset).
- No per-socket rate limit on `game:input` (queue is bounded, parse cost is not).
- No player-vs-player collision (intentional for P1).
- Run cannot return to lobby (`playing` has no `RETURN_LOBBY` transition); reset is the only restart path.
- `window.__WB_DEBUG__` is exposed in dev builds only (read-only diagnostics used by the browser script).
- HUD panel reserves 4 rows even with fewer players; controls hint overlaps the floor line.
- Browser script uses Python Playwright, not `@playwright/test` (scheduled for P7).

## Files P2 (systems graph) may modify
Add freely: `packages/shared/src/systems/**`, `packages/server/src/systems/**`, `packages/client/src/ui/**`, and matching tests.
Additive edits only (extend, never rename/remove): `shared/src/protocol.ts`, `shared/src/index.ts`, `server/src/game.ts` (step/snapshot hooks), `server/src/room.ts` (tick/snapshot hooks), `server/src/gateway.ts` (new events), `client/src/net/session.ts`, `client/src/scenes/GameScene.ts`.
Do NOT modify without a documented migration: `shared/src/sim.ts` and `arena.ts` (client prediction depends on bit-exact parity; spawn/reachability tests guard them), `shared/src/phases.ts`, `shared/src/difficulty.ts`, `server/src/loop.ts`, `client/src/sim/prediction.ts`, `client/src/net/interpolation.ts`, and all existing tests (add new ones instead).
