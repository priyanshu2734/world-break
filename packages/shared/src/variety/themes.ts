import { THEME_IDS, type ThemeId } from './curriculum';
import { createRng, deriveSeed } from '../disasters/rng';

/**
 * P3F step 5: the visual THEMES as DATA. A theme is a palette, a short list of procedural props and an ambient hum. It is chosen by the seed and the newness score
 * (`themeForStage`, step 4), travels to the client in `RoomSnapshot.theme`, and NEVER changes physics: nothing here is read by the server's rules, the generator's draws,
 * the validators or the solver.
 *
 * The colour language is kept: red = danger, cyan = interactive, amber = clue, green = done. Every theme colour is therefore either muted (`THEME_MAX_CHROMA`) or far
 * from those four hues (`COLOUR_LANGUAGE_HUES`, `THEME_MIN_HUE_GAP`): a prop never looks like something the player should react to. Props are background art, drawn behind the players,
 * the world objects and the hazards, at a bounded alpha (`PROP_MAX_ALPHA`), so they cannot hide anything.
 */
export type PropKind =
  | 'bench' | 'rack' | 'monitor' | 'pipe'                // lab
  | 'bed' | 'curtain' | 'drip' | 'cabinet'               // hospital
  | 'gear' | 'crates' | 'vent' | 'girder'                // factory
  | 'shelf' | 'books' | 'ladder' | 'desk';               // library

export interface ThemeHum {
  /** Base frequency in Hz and the wave shape of the ambient hum. */
  hz: number; wave: 'sine' | 'triangle';
  /** A second partial as a ratio of the base (0 = none), and the slow wobble (Hz) that moves it (0 = steady). */
  partial: number; wobbleHz: number;
  /** Gain 0 to `HUM_MAX_GAIN`. */
  gain: number;
}
export interface ThemeDef {
  id: ThemeId;
  label: string;
  /** A faint wash over the whole room (0xRRGGBB) and its alpha. */
  wash: number; washAlpha: number;
  /** Platform slab fill, the slab's top edge and the faint lines on a slab. */
  slab: number; edge: number; line: number;
  /** The prop palette: a body colour, a darker one and a light accent. */
  prop: number; propDark: number; propLight: number;
  props: readonly PropKind[];
  hum: ThemeHum;
}

export const HUM_MAX_GAIN = 0.05;
export const PROP_MAX_ALPHA = 0.4;
export const PROPS_PER_ROOM_MAX = 14;
/** The hues (degrees) of the colour language: red, amber, green, cyan. */
export const COLOUR_LANGUAGE_HUES = [0, 38, 150, 188] as const;
export const THEME_MIN_HUE_GAP = 22;
/** A theme colour is "muted" when its chroma (brightest channel minus dimmest, 0 to 1) is at most this. */
export const THEME_MAX_CHROMA = 0.2;

export const THEMES: Readonly<Record<ThemeId, ThemeDef>> = {
  lab: {
    id: 'lab', label: 'Laboratory', wash: 0x1a2430, washAlpha: 0.1, slab: 0x0a1822, edge: 0x6a7f94, line: 0x2c3e50,
    prop: 0x4a5a6b, propDark: 0x2a3644, propLight: 0x8499ad,
    props: ['bench', 'rack', 'monitor', 'pipe'],
    hum: { hz: 100, wave: 'triangle', partial: 2, wobbleHz: 0.15, gain: 0.03 },
  },
  hospital: {
    id: 'hospital', label: 'Hospital', wash: 0x2a3034, washAlpha: 0.12, slab: 0x141c20, edge: 0x8d9aa0, line: 0x36434a,
    prop: 0x6c7a80, propDark: 0x3a464c, propLight: 0xb4c0c4,
    props: ['bed', 'curtain', 'drip', 'cabinet'],
    hum: { hz: 120, wave: 'sine', partial: 1.5, wobbleHz: 0.1, gain: 0.025 },
  },
  factory: {
    id: 'factory', label: 'Factory', wash: 0x2c2622, washAlpha: 0.12, slab: 0x161412, edge: 0x7d7268, line: 0x3a322c,
    prop: 0x5f554c, propDark: 0x332c27, propLight: 0x948a80,
    props: ['gear', 'crates', 'vent', 'girder'],
    hum: { hz: 50, wave: 'triangle', partial: 3, wobbleHz: 0.2, gain: 0.04 },
  },
  library: {
    id: 'library', label: 'Library', wash: 0x2a2422, washAlpha: 0.1, slab: 0x15110f, edge: 0x7a6a60, line: 0x38302a,
    prop: 0x5a4a42, propDark: 0x31281f, propLight: 0x8c7a6e,
    props: ['shelf', 'books', 'ladder', 'desk'],
    hum: { hz: 80, wave: 'sine', partial: 0, wobbleHz: 0, gain: 0.015 },
  },
};

export const themeOrLab = (id: string | undefined): ThemeDef => THEMES[(THEME_IDS as readonly string[]).includes(id ?? '') ? (id as ThemeId) : 'lab'];

/** Hue (0 to 360) and chroma (0 to 1: brightest channel minus dimmest) of a 0xRRGGBB colour. */
export function hueChroma(c: number): { hue: number; chroma: number } {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d > 0) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, chroma: d };
}
/** May this colour be used by a theme (it cannot be mistaken for red, amber, green or cyan)? */
export function themeColourOk(c: number): boolean {
  const { hue, chroma } = hueChroma(c);
  if (chroma <= THEME_MAX_CHROMA) return true;
  return COLOUR_LANGUAGE_HUES.every((h) => { const d = Math.abs(hue - h); return Math.min(d, 360 - d) >= THEME_MIN_HUE_GAP; });
}

// ------------------------------------------------------------------------------------------------------------------ procedural props
export interface PropPlacement {
  kind: PropKind;
  /** Left edge, the line the prop stands on, and its size (px, inside the room). */
  x: number; y: number; w: number; h: number;
  /** 0 = the body colour, 1 = the dark one, 2 = the light one; and the alpha (never above `PROP_MAX_ALPHA`). */
  shade: 0 | 1 | 2; alpha: number;
}
const SIZE: Readonly<Record<PropKind, readonly [number, number]>> = {
  bench: [120, 46], rack: [60, 90], monitor: [50, 36], pipe: [200, 14],
  bed: [130, 40], curtain: [70, 120], drip: [24, 100], cabinet: [56, 80],
  gear: [70, 70], crates: [80, 64], vent: [60, 40], girder: [220, 18],
  shelf: [90, 150], books: [70, 30], ladder: [34, 130], desk: [110, 50],
};
/** Props that hang or are fixed high on the back wall (they are placed above the floor line). */
const HIGH: ReadonlySet<PropKind> = new Set<PropKind>(['pipe', 'monitor', 'vent', 'girder', 'gear']);

/**
 * The props of one room: a pure function of (theme, room id, run or stage seed, room size). Between 3 and `PROPS_PER_ROOM_MAX`, all inside the room, all at a
 * bounded alpha. `floorY` is the line the floor stands on. It uses its own random stream (`deriveSeed(seed, 'props', roomId)`), so it cannot move a single draw of the generator.
 */
export function propsFor(theme: ThemeId, roomId: string, seed: number, width: number, height: number, floorY: number): PropPlacement[] {
  const def = themeOrLab(theme), rng = createRng(deriveSeed(seed, 'props', roomId));
  const n = Math.min(PROPS_PER_ROOM_MAX, Math.max(3, Math.floor(width / 190)));
  const out: PropPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(def.props), [w, h] = SIZE[kind];
    const x = Math.round(rng.int(20, Math.max(21, Math.floor(width - w - 20))));
    const top = HIGH.has(kind) ? rng.int(60, Math.max(61, floorY - h - 100)) : floorY - h;
    const y = Math.min(floorY, Math.max(h, top + h));
    out.push({ kind, x, y: Math.min(y, height), w, h, shade: rng.pick([0, 1, 2] as const), alpha: Math.round((0.18 + 0.2 * rng.next()) * 100) / 100 });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ how a theme is drawn
export interface ThemeLook {
  washAlpha: number; propAlphaMul: number;
  /** Platform edge alpha, and whether anything slowly moves (the edge pulse, the hum wobble, the ghost bob). */
  edgeAlpha: number; motion: boolean;
  humGain: number; humWobble: number;
}
/**
 * The theme under the player's settings. Reduced motion: nothing moves and the hum does not wobble. Brightness assist: the wash gets weaker (it must never make a room darker)
 * and the props and edges a little stronger, so the room can be read; the hum is untouched.
 */
export function themeLook(theme: ThemeId, o: { reducedMotion: boolean; assist: boolean }): ThemeLook {
  const d = themeOrLab(theme);
  return {
    washAlpha: o.assist ? Math.min(d.washAlpha, 0.04) : d.washAlpha,
    propAlphaMul: o.assist ? 1.4 : 1,
    edgeAlpha: o.assist ? 1 : 0.85,
    motion: !o.reducedMotion,
    humGain: Math.min(HUM_MAX_GAIN, d.hum.gain),
    humWobble: o.reducedMotion ? 0 : d.hum.wobbleHz,
  };
}
