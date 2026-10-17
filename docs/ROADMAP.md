# Roadmap v2 (replaces the old P3B to P7 plan)

Done: P0 lobby, P1 multiplayer core, P2 repair systems, P3A disaster registry and endless stage loop.
Rule: one phase at a time, each from the latest git tag, each ending in a handoff in `docs/handoffs/`.

| Phase | Goal | Key risk |
|---|---|---|
| **P3B** | Reality abilities + physics migration (gravity zones, momentum, freeze, duplicate bounded, anchor) + "Ability Lab" stage | touches frozen `sim.ts`; needs client prediction parity |
| **P3C** | Make disasters physical, give each its signature verb, deduction clues and decoys, tested combinations, `clueClarity` per mode | content design quality |
| **P3D** | Game feel pass 1: lighting, particles, screen shake, audio cues, clear visual language, HUD cleanup | scope creep (keep it a pass) |
| **P4** | Health, danger telegraphs, downed/revive/spectate/team wipe, death review, Reserve, risk contracts | state machine correctness |
| **P4B** | Multi-room stages (sector graph, doors, cross-room dependencies, room caps by stage) | `arena.ts` is frozen: needs additive multi-arena support |
| **P5A/P5B** | Scenario model, validator, deterministic fallback, then OpenAI generation (rooms, mechanics, modifiers included) | validator must understand rooms and abilities |
| **P6** | Accounts, save, guests, Workshop meta progression, draft picks persistence, endless progression and unlocks | auth and DB choice, security |
| **P7A** | Visual and audio polish, onboarding, results and death-review UX | time sink |
| **P7B** | Playwright E2E, security review, performance, deployment, submission pack | environment |

Between phases: a 20 minute **playtest with friends**. Write down where they get bored or stuck and feed it to the next prompt.
