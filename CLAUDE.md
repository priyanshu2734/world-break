# WORLD//BREAK: working rules for every AI session

Read this file first in every session. Treat the checked-out code as authoritative.

## Project
TypeScript npm-workspaces monorepo: `@wb/shared` (Zod schemas, protocol, state machines, deterministic sim),
`@wb/server` (authoritative Node + Socket.IO), `@wb/client` (Phaser 3 + Vite). See `docs/ARCHITECTURE.md`,
`docs/DESIGN.md` and the latest `docs/handoffs/*.md` / `docs/P*_HANDOFF.md`.

## Commands (run from repo root)
    npm ci                 # clean install from the lockfile
    npm run typecheck
    npm test
    npm run build
    npm run dev:server     # :3001
    npm run dev:client     # :5173 (open 2+ tabs; room code in URL hash)

## Hard rules
1. Server owns all authoritative state. Clients send intents only.
2. Extend existing contracts additively. Never rename or remove an event, field, export or test. Document every contract change.
3. Do not create a second room manager, objective framework, state machine, networking layer or persistence layer.
4. `shared/src/sim.ts`, `shared/src/arena.ts`, `client/src/sim/prediction.ts`: client prediction depends on bit-exact parity with the server.
   Change only additively, with parity tests and a documented migration.
5. The game is ENDLESS. There is no final stage, no "you win" screen, no credits. See `docs/DESIGN.md`.
6. Secrets (OPENAI_API_KEY) are server-side only; never in client code, logs, Git or tests. `.env.example` has placeholders only.
7. Never claim something works unless it was actually run. Use "NOT RUN" in reports. Mocked tests are not live verification.
8. A milestone is complete only when its acceptance criteria are verified, not when code is written.
9. Edit only the files your phase is allowed to touch (listed in the previous handoff). Add new tests; do not edit old ones to make them pass.
10. Finish by writing `docs/handoffs/Pn.md` (never overwrite another phase's handoff) and updating `docs/ARCHITECTURE.md`.
