import { ARENA, ARENA_ID, type Arena } from '../arena';

/**
 * "Ability Lab" arena (P3B). Hand-authored, NOT part of the endless rotation (see server/src/systems/stages/abilityLab.ts).
 * Stations: a ledge no jump can reach (Gravity Well), an island across a gap (Momentum), two heavy plates and one crate
 * (Duplicate), a core console behind a flux (Anchor) and one behind a fast arc discharge (Freeze).
 * Public data, like every arena: the client draws it and predicts collisions with the same numbers.
 */
export const ABILITY_LAB_ARENA_ID = 'ability-lab-01';

export const ABILITY_LAB_ARENA: Arena = {
  id: ABILITY_LAB_ARENA_ID,
  name: 'Ability Lab',
  width: 1280,
  height: 720,
  solids: [
    { x: 0, y: 680, w: 1280, h: 40 }, // 0 floor
    { x: 320, y: 590, w: 200, h: 20 }, // 1 A1: anchor console, capacitor
    { x: 540, y: 500, w: 120, h: 20 }, // 2 S: step up to M_A
    { x: 340, y: 400, w: 160, h: 20 }, // 3 M_A: the crate's launch pad
    { x: 0, y: 600, w: 100, h: 20 }, // 4 M_B: the island across the gap (heavy plate)
    { x: 820, y: 590, w: 300, h: 20 }, // 5 D1: two heavy plates and a crate
    { x: 1140, y: 500, w: 140, h: 20 }, // 6 W1: take-off for the ledge
    { x: 1020, y: 140, w: 120, h: 20 }, // 7 ledge: only reachable through a gravity well (see the reach probe in the tests)
  ],
  spawns: [
    // Open floor columns with full jump headroom (nothing above x 126..300).
    { x: 140, y: 680 },
    { x: 190, y: 680 },
    { x: 240, y: 680 },
    { x: 290, y: 680 },
  ],
};

const ARENAS: Readonly<Record<string, Arena>> = {
  [ARENA_ID]: ARENA,
  [ABILITY_LAB_ARENA_ID]: ABILITY_LAB_ARENA,
};

/** Arena by id (stages name theirs in `arenaId`). Unknown ids return undefined: callers fall back to ARENA. */
export function getArena(id: string): Arena | undefined { return ARENAS[id]; }
