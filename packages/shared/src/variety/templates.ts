import type { Rect } from '../arena';
import type { Rng } from '../disasters/rng';

/**
 * P3F step 1: ROOM TEMPLATES. Pure data built from the arena's one primitive (a fixed rectangle): no engine change, no new physics.
 * A template turns `(width, rng)` into the solids of ONE room plus the places a thing may stand (`surfaces`), where the doors and the
 * exit stand, and how tall the room is. It is deterministic in its inputs and never reads a clock.
 *
 * Rules every template obeys (all of them checked by `server/test/rooms/templates.test.ts` and, at generation time, by `requireReachable`):
 *  1. Every ledge is one jump (rise at most 95 px, gap at most 95 px) from another ledge or the floor, so a lone player reaches it with the REAL
 *     movement function (`stepBody`, `shared/src/sim.ts`: a jump rises at most 128 px).
 *  2. Anything that TOUCHES the floor and is not part of a second floor level is at most 95 px high: the floor stays walkable end to end.
 *     Anything taller floats (a ledge with free floor beneath it).
 *  3. The spawn row (x 300 to 450), both arrival points and both doors stand on clear floor.
 *  4. At most `ROOM_LIMITS.maxSolidsPerRoom` solids, a height of 720 to 1440, a width of 1600 to 3200.
 *  5. Moving platforms do not exist: the shared sim has only fixed rectangles and `sim.ts` is frozen. `islands` and `bridge` give the same
 *     "careful jumping" feel with fixed platforms.
 */

/** The 15 template ids. `tutorial` is the stage 1 room, `hall` is the original staircase slab (stage 2 and the classic option of every even stage). */
export const TEMPLATE_IDS = [
  'tutorial', 'hall',
  'corridor', 'split_level', 'tower', 'pit', 'islands', 'vent_crawl', 'hub',
  'mezzanine', 'catwalk', 'warehouse', 'terrace', 'shaft', 'bridge',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** A place things may stand. `floor` surfaces take the bulky things (lockers, safes, keypads, switches, hiding spots); `ledge` surfaces take small things. */
export interface Surface { solid: number; y: number; x0: number; x1: number; kind: 'floor' | 'ledge' }
export interface DoorSite {
  /** Left edge of the 40 px door box in this room; the box stands on the surface at `y`. */
  x: number; y: number;
  /** Where a player who comes INTO this room through the door of the neighbour stands. */
  arrive: { x: number; y: number };
}
export interface TemplateRoom {
  id: TemplateId; width: number; height: number;
  /** The level of the spawn row and of the west door (the lowest ground a player starts on). */
  floorY: number;
  solids: Rect[]; surfaces: Surface[];
  /** The west door leads back to the previous room, the east door on to the next one. */
  west: DoorSite; east: DoorSite;
  /** Where the exit stands when this is the last room. */
  exit: { x: number; y: number };
}

export interface RoomTemplate {
  id: TemplateId;
  /** `odd` templates run on odd stages and `even` ones on even stages: consecutive stages can therefore never share a template, whatever the seeds. */
  pool: 'odd' | 'even';
  /** The first stage the template may appear on (gentle ones first, then the tall and tricky ones). */
  minStage: number;
  label: string;
  /** Width choices (px). Omitted for `hall`, whose geometry is the original generator's. */
  widths: readonly number[];
  /** Absent for `tutorial` and `hall`: those two are built by the original plan (`generate.ts`). */
  build?: (width: number, rng: Rng) => TemplateRoom;
}

// ---------------------------------------------------------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------------------------------------------------------
export const TEMPLATE = {
  /** A ledge is this thick; a floor is this thick. */
  ledgeH: 20, floorH: 40,
  /** One jump up: the rise between two consecutive ledges. The real maximum is 128 px (680^2 / (2 x 1800)). */
  rise: 95,
  /** Things on a floor start at this x (clear of the spawn row and of the arrival point), and keep this far from the east end. */
  firstX: 560, eastMargin: 460,
  doorW: 40, doorH: 100,
} as const;

class Build {
  readonly floor: number;
  readonly solids: Rect[];
  readonly surfaces: Surface[] = [];
  constructor(readonly id: TemplateId, readonly width: number, readonly height: number, floorSolid?: Rect) {
    this.floor = height - TEMPLATE.floorH;
    this.solids = [floorSolid ?? { x: 0, y: this.floor, w: width, h: TEMPLATE.floorH }];
  }
  /** Add any solid, return its index. */
  solid(r: Rect): number { this.solids.push(r); return this.solids.length - 1; }
  /** Add a thin ledge and a surface for it (the span is inset a little so a thing never hangs over the edge). */
  ledge(x: number, y: number, w: number, kind: 'floor' | 'ledge' = 'ledge', inset = 0): number {
    const i = this.solid({ x, y, w, h: TEMPLATE.ledgeH });
    this.surfaces.push({ solid: i, y, x0: x + inset, x1: x + w - inset, kind });
    return i;
  }
  /** A floor-kind span of an existing solid (its top is `y`). */
  span(solid: number, y: number, x0: number, x1: number, kind: 'floor' | 'ledge' = 'floor'): void {
    if (x1 - x0 >= 40) this.surfaces.push({ solid, y, x0, x1, kind });
  }
  /** A flight of floating ledges. `dir` 1 goes right from `x`, -1 goes left from `x`; the first ledge is one rise above `base`. Returns the solid indices. */
  stairs(x: number, base: number, n: number, w: number, gap: number, dir: 1 | -1, kind: 'floor' | 'ledge' = 'ledge'): number[] {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const lx = dir === 1 ? x + k * (w + gap) : x - k * (w + gap) - w;
      out.push(this.ledge(lx, base - TEMPLATE.rise * (k + 1), w, kind));
    }
    return out;
  }
  done(extra: { west?: Partial<DoorSite>; east?: Partial<DoorSite>; exit?: { x: number; y: number }; floorY?: number } = {}): TemplateRoom {
    const wy = extra.west?.y ?? this.floor, ey = extra.east?.y ?? this.floor;
    return {
      id: this.id, width: this.width, height: this.height, floorY: extra.floorY ?? wy,
      solids: this.solids, surfaces: this.surfaces,
      west: { x: 60, y: wy, arrive: { x: 200, y: wy }, ...extra.west },
      east: { x: this.width - 80, y: ey, arrive: { x: this.width - 180, y: ey }, ...extra.east },
      exit: extra.exit ?? { x: this.width - 300, y: ey },
    };
  }
}

/** Free intervals of [from, to] that remain once the `blocks` (each padded by `pad`) are cut out; intervals shorter than `min` are dropped. */
function freeSpans(from: number, to: number, blocks: readonly { x: number; w: number }[], pad: number, min = 120): [number, number][] {
  const out: [number, number][] = [];
  let at = from;
  for (const b of [...blocks].sort((p, q) => p.x - q.x)) {
    const end = b.x - pad;
    if (end - at >= min) out.push([at, end]);
    at = Math.max(at, b.x + b.w + pad);
  }
  if (to - at >= min) out.push([at, to]);
  return out;
}
const eastLimit = (w: number): number => w - TEMPLATE.eastMargin;

// ---------------------------------------------------------------------------------------------------------------------------
// the templates
// ---------------------------------------------------------------------------------------------------------------------------

/** corridor: a long, low hall of crates. Crates (70 to 90 px) break the line of sight and carry things; one shelf stands above the middle crate. */
function corridor(W: number, rng: Rng): TemplateRoom {
  const b = new Build('corridor', W, 720);
  const n = W >= 3000 ? 4 : 3, lo = 780, hi = W - 780;
  const crates: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const cx = Math.round(lo + ((hi - lo) * (i + 0.5)) / n + rng.int(-50, 50)), h = rng.pick([70, 90]);
    const r: Rect = { x: cx - 70, y: b.floor - h, w: 140, h };
    crates.push(r);
    b.solid(r);
  }
  const ids = crates.map((_, i) => i + 1);
  crates.forEach((r, i) => b.surfaces.push({ solid: ids[i]!, y: r.y, x0: r.x + 20, x1: r.x + r.w - 20, kind: 'ledge' }));
  for (const [a, z] of freeSpans(TEMPLATE.firstX, eastLimit(W), crates, 40)) b.span(0, b.floor, a, z);
  // a shelf up and to the right of the middle crate: one jump from the crate's top
  const mid = crates[Math.floor(n / 2)]!;
  b.ledge(mid.x + mid.w + 75, b.floor - 185, 220, 'ledge');
  return b.done();
}

/** split_level: the east half of the room is a raised deck (180 px); two steps lead up to it, and the east door and the exit stand on it. */
function splitLevel(W: number, rng: Rng): TemplateRoom {
  const H = 720, F = H - 40, D = Math.round((W / 2 + rng.int(-120, 120)) / 10) * 10, deckY = F - 180;
  const b = new Build('split_level', W, H, { x: 0, y: F, w: D, h: 40 });
  const deck = b.solid({ x: D, y: deckY, w: W - D, h: H - deckY });
  b.ledge(D - 285, F - 90, 220, 'ledge');
  b.span(0, F, TEMPLATE.firstX, D - 60);
  b.span(deck, deckY, D + 80, eastLimit(W));
  return b.done({ east: { y: deckY }, exit: { x: W - 300, y: deckY } });
}

/** tower: a stepped pyramid. Stairs climb to a wide summit; a crown ledge stands one more jump above and beyond it. */
function tower(W: number, rng: Rng): TemplateRoom {
  const b = new Build('tower', W, 960);
  const w = rng.int(190, 230), gap = rng.int(55, 70), x0 = rng.int(560, 600), F = b.floor;
  b.stairs(x0, F, 3, w, gap, 1);
  const deckX = x0 + 3 * (w + gap), deckW = rng.int(480, 560);
  b.ledge(deckX, F - 4 * TEMPLATE.rise, deckW, 'floor', 30);
  b.ledge(deckX + deckW + 65, F - 5 * TEMPLATE.rise, 180, 'ledge');
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** pit: the middle of the floor drops 140 px into a pit with a step on each wall. Everything crosses by going down and climbing out; things lie in the pit. */
function pit(W: number, rng: Rng): TemplateRoom {
  const H = 960, U = H - 40 - 140, bottom = H - 40, P0 = rng.int(1000, 1100), P1 = P0 + 560;
  const b = new Build('pit', W, H, { x: 0, y: U, w: P0, h: H - U });
  const right = b.solid({ x: P1, y: U, w: W - P1, h: H - U });
  const pitFloor = b.solid({ x: P0, y: bottom, w: P1 - P0, h: 40 });
  b.solid({ x: P0, y: U + 75, w: 150, h: 20 });
  b.solid({ x: P1 - 150, y: U + 75, w: 150, h: 20 });
  b.span(0, U, TEMPLATE.firstX, P0 - 60);
  b.span(right, U, P1 + 60, eastLimit(W));
  b.span(pitFloor, bottom, P0 + 195, P1 - 195);
  b.surfaces.push({ solid: 3, y: U + 75, x0: P0 + 30, x1: P0 + 120, kind: 'ledge' }, { solid: 4, y: U + 75, x0: P1 - 120, x1: P1 - 30, kind: 'ledge' });
  return b.done({ west: { y: U }, east: { y: U }, exit: { x: W - 300, y: U } });
}

/** islands: a chain of floating platforms that wanders up and down between 95 and 380 px. Careful jumping; things on every island. */
function islands(W: number, rng: Rng): TemplateRoom {
  const b = new Build('islands', W, 960), F = b.floor;
  let level = 1, x = rng.int(600, 640);
  for (let k = 0; k < 7; k++) {
    const w = rng.int(200, 240);
    b.ledge(x, F - TEMPLATE.rise * level, w, 'ledge');
    x += w + rng.int(55, 70);
    level = Math.max(1, Math.min(4, level + rng.pick([1, 1, 0, -1, -1])));
  }
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** vent_crawl: a long tunnel (a floor and a low ceiling, 140 px between) up two steps. Things and hiding places lie inside it. */
function ventCrawl(W: number, rng: Rng): TemplateRoom {
  const b = new Build('vent_crawl', W, 960), F = b.floor;
  const w = rng.int(190, 210), gap = rng.int(55, 65), a0 = 620;
  b.stairs(a0, F, 2, w, gap, 1);
  const tx = a0 + 2 * (w + gap), tw = W - 2 * tx; // the tunnel floor mirrors the stairs on the east side
  const T = F - 3 * TEMPLATE.rise;
  b.ledge(tx, T, tw, 'floor', 130);
  b.solid({ x: tx + 90, y: T - 140 - 30, w: tw - 180, h: 30 }); // the ceiling, 140 px above the tunnel floor
  b.stairs(W - a0, F, 2, w, gap, -1);
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** hub: a plaza one flight up in the middle, with a staircase on each side and satellite ledges climbing to 380 px. */
function hub(W: number, rng: Rng): TemplateRoom {
  const b = new Build('hub', W, 960), F = b.floor;
  const L = rng.int(1080, 1140), pw = rng.int(340, 400), R = L + pw;
  b.ledge(L - 285, F - TEMPLATE.rise, 220, 'ledge');          // left stair
  b.ledge(L, F - 2 * TEMPLATE.rise, pw, 'floor', 40);          // the plaza
  b.ledge(R + 65, F - TEMPLATE.rise, 220, 'ledge');            // right stair
  b.ledge(L - 225, F - 3 * TEMPLATE.rise, 160, 'ledge');       // left satellites, one jump from the plaza's edge
  b.ledge(L - 450, F - 4 * TEMPLATE.rise, 160, 'ledge');
  b.ledge(R + 65, F - 3 * TEMPLATE.rise, 160, 'ledge');       // right satellites
  b.ledge(R + 290, F - 4 * TEMPLATE.rise, 160, 'ledge');
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** mezzanine: a long gallery 190 px up over the middle of the room, with a stair at each end. */
function mezzanine(W: number, rng: Rng): TemplateRoom {
  const b = new Build('mezzanine', W, 720), F = b.floor;
  const gx = rng.int(1080, 1140), gw = W - 2 * gx;
  b.ledge(gx - 285, F - TEMPLATE.rise, 220, 'ledge');
  b.ledge(gx, F - 2 * TEMPLATE.rise, gw, 'floor', 40);
  b.ledge(gx + gw + 65, F - TEMPLATE.rise, 220, 'ledge');
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** catwalk: a high catwalk (285 px) the whole way across the middle, with a three-step stair at each end. Two levels of play. */
function catwalk(W: number, rng: Rng): TemplateRoom {
  const b = new Build('catwalk', W, 960), F = b.floor;
  const L = rng.int(980, 1040), w = 180, gap = 65;
  b.stairs(L - 70, F - TEMPLATE.rise, 1, w, gap, -1);              // B (190 px), just before the catwalk
  b.stairs(L - 70 - w - gap, F, 1, w, gap, -1);                    // A (95 px)
  b.ledge(L, F - 3 * TEMPLATE.rise, W - 2 * L, 'floor', 40);       // the catwalk
  b.stairs(W - L + 70, F - TEMPLATE.rise, 1, w, gap, 1);
  b.stairs(W - L + 70 + w + gap, F, 1, w, gap, 1);
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** warehouse: two long shelves float 285 px up, each with a three-step stair; crates stand in the aisle between them. */
function warehouse(W: number, rng: Rng): TemplateRoom {
  const b = new Build('warehouse', W, 720), F = b.floor;
  const s1 = rng.int(1100, 1160), sw = rng.int(380, 420), w = 180, gap = 55;
  b.stairs(s1 - gap, F - TEMPLATE.rise, 1, w, gap, -1);                           // B (its right edge is one gap left of the shelf)
  b.stairs(s1 - gap - w - gap, F, 1, w, gap, -1);                                 // A (its right edge is one gap left of B)
  b.ledge(s1, F - 3 * TEMPLATE.rise, sw, 'floor', 40);                            // shelf 1
  const s2 = W - s1 - sw;
  b.ledge(s2, F - 3 * TEMPLATE.rise, sw, 'floor', 40);                            // shelf 2
  b.stairs(s2 + sw + gap, F - TEMPLATE.rise, 1, w, gap, 1);                       // B'
  b.stairs(s2 + sw + gap + w + gap, F, 1, w, gap, 1);                             // A'
  const mid = Math.round((s1 + sw + s2) / 2);
  const crates: Rect[] = [{ x: mid - 160, y: F - 70, w: 120, h: 70 }, { x: mid + 40, y: F - 90, w: 120, h: 90 }];
  for (const c of crates) { const i = b.solid(c); b.surfaces.push({ solid: i, y: c.y, x0: c.x + 20, x1: c.x + c.w - 20, kind: 'ledge' }); }
  for (const [a, z] of freeSpans(TEMPLATE.firstX, eastLimit(W), crates, 40)) b.span(0, F, a, z);
  return b.done();
}

/** terrace: four long terraces climb to the east, 95 px apart, 400 px wide each. A hillside of floors. */
function terrace(W: number, rng: Rng): TemplateRoom {
  const b = new Build('terrace', W, 960), F = b.floor;
  const tw = rng.int(380, 420), gap = rng.int(60, 70), x0 = rng.int(620, 660);
  b.stairs(x0, F, 4, tw, gap, 1, 'floor');
  for (let k = 0; k < 4; k++) { const s = b.surfaces[k]!; s.x0 += 30; s.x1 -= 30; }
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** shaft: a switchback. Four ledges climb to the east, four more climb back to the west, and a high gallery crowns it (760 px up). */
function shaft(W: number, rng: Rng): TemplateRoom {
  const b = new Build('shaft', W, 1040), F = b.floor;
  const w = rng.int(190, 230), gap = rng.int(55, 70), x0 = rng.int(520, 560), step = w + gap;
  b.stairs(x0, F, 4, w, gap, 1);                                                   // F-95 .. F-380 going east
  for (let j = 1; j <= 3; j++) b.ledge(x0 + (4 - 1 - j) * step, F - TEMPLATE.rise * (4 + j), w, 'ledge'); // F-475 .. F-665 coming back west
  b.ledge(x0 - step, F - TEMPLATE.rise * 8, w + 40, 'floor', 20);                  // the gallery
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  return b.done();
}

/** bridge: a stair up, a bridge of separate planks that rises and falls (rise 95, gap 90), a stair down. */
function bridge(W: number, rng: Rng): TemplateRoom {
  const b = new Build('bridge', W, 960), F = b.floor;
  const w = 180, gap = 65;
  b.stairs(560, F, 3, w, gap, 1);                                                  // up to F-285
  let x = 560 + 3 * (w + gap) + 20, level = 3;
  for (let k = 0; k < 4; k++) {
    b.ledge(x, F - TEMPLATE.rise * level, w, 'ledge');
    x += w + 75;
    level = k === 0 ? 4 : k === 1 ? 3 : 3;
  }
  b.ledge(x, F - TEMPLATE.rise * 2, w, 'ledge'); x += w + 70;                      // down the other side
  b.ledge(x, F - TEMPLATE.rise, w, 'ledge');
  b.span(0, F, TEMPLATE.firstX, eastLimit(W));
  void rng;
  return b.done();
}

export const ROOM_TEMPLATES: Readonly<Record<TemplateId, RoomTemplate>> = {
  tutorial: { id: 'tutorial', pool: 'odd', minStage: 1, label: 'Tutorial room', widths: [1920] },
  hall: { id: 'hall', pool: 'even', minStage: 2, label: 'Hall', widths: [1920, 2240, 2560] },
  corridor: { id: 'corridor', pool: 'odd', minStage: 3, label: 'Corridor of crates', widths: [2560, 3200], build: corridor },
  split_level: { id: 'split_level', pool: 'odd', minStage: 3, label: 'Split level', widths: [2240, 2560], build: splitLevel },
  tower: { id: 'tower', pool: 'odd', minStage: 5, label: 'Tower', widths: [2560, 3200], build: tower },
  pit: { id: 'pit', pool: 'odd', minStage: 5, label: 'Pit', widths: [2560, 3200], build: pit },
  islands: { id: 'islands', pool: 'odd', minStage: 7, label: 'Islands', widths: [3200], build: islands },
  vent_crawl: { id: 'vent_crawl', pool: 'odd', minStage: 7, label: 'Vent crawl', widths: [3200], build: ventCrawl },
  hub: { id: 'hub', pool: 'odd', minStage: 7, label: 'Hub', widths: [2560, 3200], build: hub },
  mezzanine: { id: 'mezzanine', pool: 'even', minStage: 4, label: 'Mezzanine', widths: [2560, 3200], build: mezzanine },
  catwalk: { id: 'catwalk', pool: 'even', minStage: 4, label: 'Catwalk', widths: [3200], build: catwalk },
  warehouse: { id: 'warehouse', pool: 'even', minStage: 4, label: 'Warehouse', widths: [3200], build: warehouse },
  terrace: { id: 'terrace', pool: 'even', minStage: 6, label: 'Terrace', widths: [3200], build: terrace },
  shaft: { id: 'shaft', pool: 'even', minStage: 6, label: 'Shaft', widths: [1920, 2240], build: shaft },
  bridge: { id: 'bridge', pool: 'even', minStage: 8, label: 'Bridge', widths: [3200], build: bridge },
};

