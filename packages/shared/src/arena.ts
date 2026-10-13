/**
 * Hand-authored arena geometry. Public data (not a hidden solution), shared so the
 * client can render it and predict collisions with exactly the server's rules.
 * Coordinates are pixels, origin top-left, +y down.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface SpawnPoint { x: number; y: number }
export interface Arena {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Fully solid rectangles. */
  solids: readonly Rect[];
  /** Feet-center spawn per player slot (slot index === array index). */
  spawns: readonly SpawnPoint[];
}

export const ARENA_ID = 'relay-platform-01';

export const ARENA: Arena = {
  id: ARENA_ID,
  name: 'Relay Platform 01',
  width: 1280,
  height: 720,
  solids: [
    { x: 0, y: 680, w: 1280, h: 40 }, // floor
    { x: 140, y: 590, w: 260, h: 20 }, // low left
    { x: 880, y: 590, w: 260, h: 20 }, // low right
    { x: 470, y: 500, w: 340, h: 20 }, // centre
    { x: 60, y: 410, w: 280, h: 20 }, // upper left
    { x: 940, y: 410, w: 280, h: 20 }, // upper right
    { x: 380, y: 320, w: 180, h: 20 }, // top left
    { x: 720, y: 320, w: 180, h: 20 }, // top right
  ],
  spawns: [
    // Open floor columns with full jump headroom (not under any platform).
    { x: 90, y: 680 },
    { x: 435, y: 680 },
    { x: 845, y: 680 },
    { x: 1190, y: 680 },
  ],
};
