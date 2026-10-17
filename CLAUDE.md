# WORLD//BREAK: working rules for every AI session

Read this file first in every session. Treat the checked-out code as authoritative. Then read `docs/GAMEPLAY.md` (the design bible)
and the latest `docs/handoffs/*.md`.

## Project
TypeScript npm-workspaces monorepo: `@wb/shared` (Zod schemas, protocol, state machines, deterministic sim),
`@wb/server` (authoritative Node + Socket.IO), `@wb/client` (Phaser 3 + Vite). See `docs/ARCHITECTURE.md`, `docs/DISASTERS.md`.

## Commands (repo root)
    npm ci && npm run typecheck && npm test && npm run build
    npm run dev:server   # :3001
    npm run dev:client   # :5173 (second tab joins with the room code in the URL hash, e.g. localhost:5173/#ABCD)

## Hard rules
1. Server owns all authoritative state. Clients send intents only.
2. Extend contracts additively. Never rename or remove an event, field, export or test. Document every contract change.
3. No second room manager, objective framework, state machine, networking layer or persistence layer.
4. `shared/src/sim.ts`, `shared/src/arena.ts`, `client/src/sim/prediction.ts` must stay bit-exact between server and client.
   Change them only additively (optional parameters, defaults = old behaviour), with parity tests and a documented migration.
5. The game is ENDLESS. No final stage, no ending screen, no credits. Complexity is bounded and validated (see GAMEPLAY.md section 6).
6. Obey `docs/GAMEPLAY.md`: no checklist stages, every disaster has its own verb, decoys, bounded counts, readable visuals.
7. Secrets (OPENAI_API_KEY, auth keys) are server-side only; never in client code, logs, Git or tests. `.env.example` has placeholders only.
8. Never claim something works unless you ran it. Write "NOT RUN". Mocked tests are not live verification.
   If you cannot run commands, ALSO review every test and helper for TypeScript type compatibility by hand (vitest does not typecheck).
9. A milestone is complete only when its acceptance criteria are verified, not when code is written.
10. Edit only the files your phase may touch. Add new tests; never edit old tests to make them pass (exception: assertions that
    this phase deliberately changes, listed in the handoff).
11. Finish by writing `docs/handoffs/<Phase>.md` (never overwrite another phase's file) and updating `docs/ARCHITECTURE.md`.
12. Line endings: LF (see `.gitattributes`).
