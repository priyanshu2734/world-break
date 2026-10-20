# Prompt for P3D (v4). Later phases are written from the real handoff when you reach them.
Paste with the EXECUTION NOTE and the HANDOFF FOOTER (see P3D_full_prompt.md which already contains both).

---------------------------------------------------------------------------
## P3D: ESCAPE-ROOM FOUNDATION (rooms, doors and locks, exit, darkness, server-side vision, minimal HUD)
BASELINE: repo at tag p3c-complete, 924 tests passing (client 68, server 757, shared 99), typecheck and build clean. Preserve everything.
Read CLAUDE.md, docs/GAMEPLAY.md (v4, authoritative), docs/ROADMAP.md, docs/ARCHITECTURE.md, docs/DISASTERS.md, docs/ABILITIES.md, docs/SALVAGE.md,
docs/handoffs/P2.md, P3A.md, P3B.md, P3C.md and the real code: shared sim/arena/protocol and abilities/labArena.ts (how the Ability Lab swaps in its
own arena), client prediction (setArena), server room/gateway/game/engine/stageDef/validate, salvage, the stage registry, GameScene and ui.

GOAL: turn the game into a co-op escape room. A stage is a chain of up to 6 rooms (see GAMEPLAY.md section 4 table). Players find items, open doors with
different locks, and reach the exit. NO ghost yet (P3E). Disasters are not part of this phase. Keep stages endless and deterministic by seed.

DELIVER IN 5 STEPS (zip after each step):
1. DARKNESS SPIKE (client-only, flagged, cheap): a dark level with a flashlight cone plus a small radius light, ambient brightness as a parameter
   (stage and mode will drive it later), shown with a URL flag such as ?dark=1 on the existing hunt stage. Purpose: let the maintainer judge the 2D look and
   whether hidden things feel hidden. Include a brightness assist option. No server changes. Tell me exactly how to open it.
2. ROOMS: a room graph per stage; each room has its own arena LARGER than the screen with camera follow (no minimap). Generalise the Ability Lab's
   arena-per-stage mechanism to arena-per-room ADDITIVELY (shared sim.ts/arena.ts/prediction.ts only through optional parameters, default behaviour
   unchanged, parity tests, documented migration). Players belong to a room; passing through a door moves them to the adjacent room's spawn. Snapshots
   carry the player's current room id. All existing sim, prediction and parity tests stay unchanged and green.
3. DOORS, LOCKS, EXIT, CLEAR RULE: lock types key-item, code (clue in one place, keypad in another), power (carry a battery), two-person (solo-safe via a
   clone or timed alternative), and safe (combination from clues). Reuse the P3C item model, needs, slots (2) and decoys. Exit object. Clear rule from
   GAMEPLAY.md section 3: the stage is cleared when at least one player reaches the exit; the rest return next stage; document how this plugs into the
   existing STAGE_CLEAR transition (phases.ts is frozen, do not edit it).
4. SERVER-SIDE VISIBILITY AND MINIMAL HUD: the server publishes to each client only entities within that player's vision (radius plus line of sight, blocked
   by walls and closed doors). Hidden items, safes, code clues and other rooms are never in the snapshot unless in view (extend the P2 and P3C
   non-disclosure invariants; refusals stay byte-identical for hidden and nonexistent things). Teammates are always visible on the team list but not their
   inventories. Client: hide the old tool bar and ability bar on escape stages, show one current-goal line, the 2 item slots, and the keys from GAMEPLAY.md
   section 11. Darkness driven by the real stage parameter.
5. STAGES, VALIDATION, DOCS: an escape stage generator (seeded, deterministic) producing 1 to 6 rooms by the stage table with a different lock per door
   and clues; stage 1 = a single-room escape tutorial with one key and one door (teach one thing at a time). Extend the validator and the real-physics
   solvability bot: every stage solvable by 1 player within 2 slots, and by 2 to 4 players. Add docs/ROOMS.md (limits table), ARCHITECTURE.md update, and
   docs/handoffs/P3D.md.
OUT OF SCOPE: the ghost, the stun gun, disasters in escape stages, chat and ping, death and revive, OpenAI, persistence, art polish.
KEEP: server-authoritative, additive protocol, bounded counts, determinism, endless loop (test stage 1,000,000), no unbounded rooms (cap 6).
Env flag ESCAPE_STAGES (default on for the dev server; "0" restores the previous stage 1 and generator behaviour so old tests stay valid).
Files you may modify: add under shared/src/rooms/**, server/src/rooms/**, server/src/systems/stages/**, client/src/ui/**, client/src/scenes/**;
additive edits to protocol.ts, index.ts, room.ts, gateway.ts, game.ts, engine.ts, stageDef.ts, validate.ts, schemas.ts, registry.ts, session.ts,
GameScene.ts, salvage/**; sim.ts, arena.ts, prediction.ts only via the documented additive migration. Do not touch phases.ts, difficulty.ts, loop.ts,
interpolation.ts, tutorial.ts or old tests.
