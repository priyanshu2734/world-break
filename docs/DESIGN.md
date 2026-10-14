# WORLD//BREAK: THE REALITY RELAY: Design

## Pitch
1 to 4 players run a relay through a world whose rules are failing. They investigate symptoms, find hidden breakpoints,
use tools and reality abilities, and repair the failure chain before it collapses. Every stage is a new disaster puzzle.

## ENDLESS by design
- There is no last stage. Clearing stage N always leads to stage N+1. No ending screen, no credits, no "game complete".
- Stage numbers are unbounded integers (`stage >= 1`, no maximum anywhere in schemas, storage or UI).
- Milestone moments (every 10th stage, e.g. 10, 20, 30...) are celebrations and unlocks, never endings: a short sequence, a new mechanic
  or map family, then "Next stage". The team can always continue.
- Difficulty gating (existing rule): Easy from stage 1, Intermediate unlocks at stage 10, Hardcore at stage 20.
- Scaling is bounded and fair: complexity grows through new mechanics, longer dependency chains, new layouts and disaster combinations,
  NOT by unbounded damage. Include recovery stages (calmer, resource-rich) and optional objectives so long runs stay fresh.
- A failed attempt retries the same stage with a different validated scenario seed. Progress is never reset to stage 1.
- Success metrics shown to players: highest stage reached, stage streak, optional objectives completed.

## Disasters (v1 set)
Gravity inversion, reactor overload, reality fracture, temporal storm, cascading power failure. Combinations only where explicitly defined and tested.

## Tools (P2)
Phase Scanner, Flux Welder, Gravity Anchor, Power Cell, Shield Projector.

## Tone and look
Clean neon-on-dark, readable first. Procedural/original art only. Hazards must never be hidden by effects.
Symptoms (visible, flashy), breakpoints (hidden until scanned), scenery (neutral) must be visually distinct.
