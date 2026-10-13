# WORLD//BREAK: THE REALITY RELAY: Architecture & Milestones

## Layout
npm workspaces monorepo. `@wb/shared` is consumed as TypeScript source by both sides.

    packages/shared   Zod schemas, protocol types, state machines, difficulty rules (no I/O)
    packages/server   Authoritative Node + Socket.IO server (Room logic is socket-free and unit-testable)
    packages/client   Phaser 3 + Vite renderer/input. Sends intents, renders server snapshots

## Principles
- Server owns all state. Clients send *intents*; the server validates (Zod), applies, broadcasts.
- Snapshots are public-only. Scenario solutions and the OpenAI key stay server-side.
- AI output is data only: Zod-parsed, then checked by a deterministic solver/validator before launch.
  On any failure -> tested deterministic fallback scenario.
- Explicit state machines (`RoomPhase`, `PlayerLife`) with illegal transitions throwing.

## Milestones
- [x] P0 Foundation: monorepo, contracts, state machines, lobby (1-4 players), difficulty gating
- [x] P1 Playable core: fixed-timestep sim @20Hz, movement, interpolation, one hand-authored arena, 1-4 players (see docs/P1_HANDOFF.md)
- [ ] P2 Systems graph: breakpoints, failure chains, tools, repair progress, timers, scoring (server-side)
- [ ] P3 Abilities + disasters: gravity inversion, reactor overload, fractures, temporal storms, power cascade, combos
- [ ] P4 Downed/revive/spectate, team wipe, death review, retry with new scenario
- [ ] P5 Scenario generator + validator + fallback; then OpenAI integration (structured outputs, timeouts, retries)
- [ ] P6 Persistence (stage progression, unlock 10/20, rewards), difficulty select per stage
- [ ] P7 Visual/audio polish, HUD, hazard warnings; Playwright E2E (multi-context), load/soak tests

## Initial risks
1. Netcode feel (latency, interpolation): mitigate with fixed ticks, snapshot interpolation, client-side prediction only for own movement.
2. Solvability of generated scenarios: must be provable by a deterministic solver, not by prompt trust.
3. Scope: strict phase gating; each phase must ship playable.
4. Bundle size (Phaser ~1.5 MB): acceptable now; revisit code-splitting in P7.
5. No OpenAI key in dev/CI: fallback path is the default-tested path; live API calls need a key and are not yet verified.
