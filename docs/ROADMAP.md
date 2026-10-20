# Roadmap v4 (escape-room pivot)

Done: P0 lobby, P1 multiplayer core, P2 repair systems, P3A disaster registry + endless loop, P3B abilities, P3C salvage items (924 tests).
Rule: one phase at a time from the latest tag; each ends with a handoff in `docs/handoffs/`.

| Phase | Goal |
|---|---|
| **P3D** | Escape-room foundation: darkness spike, multi-room world (bigger than screen), doors and locks, exit, server-side vision, minimal HUD |
| **P3E** | The Ghost: senses, sound, waves, stun gun in a safe, hiding spots, stage scaling tuning table, ghost types (Wisp, Shade, Howler, Mimic, Phantom, Warden, Twins) with different looks, sounds and powers |
| **P3F** | Disasters as a difficulty layer with optional cure puzzles; more lock and puzzle variety; items in generated stages |
| **P3G** | Team panel (Tab): ping wheel and chat, per-player information, first-minute onboarding and hints |
| **P4** | Captured, revive, eliminated, spectating (limited view), stage retry, death review |
| **P5A/B** | Scenario model, validator (rooms, locks, ghost fairness), deterministic fallback, then OpenAI generation |
| **P6** | Accounts, save, guests, endless progression and unlocks |
| **P7** | Polish (lighting, audio, art), Playwright E2E, security, performance, deployment, submission |

Between phases: a 20-minute playtest with 2 or 3 friends who have never seen the game. Do not help them. Write down where they get lost.
