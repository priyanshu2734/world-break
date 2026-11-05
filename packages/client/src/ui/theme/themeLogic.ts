import { themeLook, themeOrLab, propsFor, type ThemeDef, type ThemeId, type ThemeLook, type PropPlacement } from '@wb/shared';
import { propPrims } from './propArt';
import type { Prim } from './prims';

/** P3F step 5: everything a theme needs on the client, as pure functions (the Phaser view only draws what these return). */
export interface LookFlags { reducedMotion: boolean }
/** Reduced motion is on when the browser asks for it (`prefers-reduced-motion`), or with `?reducemotion=1`, or with the older `?reduceflash=1`. */
export function lookFlags(search: string, prefersReduced: boolean): LookFlags {
  const q = new URLSearchParams(search);
  return { reducedMotion: prefersReduced || q.get('reducemotion') === '1' || q.get('reduceflash') === '1' };
}

export interface RoomDecor { wash: { color: number; alpha: number }; props: Prim[]; placements: PropPlacement[] }
/** The background of one room: the wash and the props, from the theme, the stage seed and the player's settings. */
export function roomDecor(theme: ThemeId, roomId: string, seed: number, size: { w: number; h: number; floorY: number }, look: ThemeLook): RoomDecor {
  const d = themeOrLab(theme);
  const placements = propsFor(theme, roomId, seed, size.w, size.h, size.floorY);
  return { wash: { color: d.wash, alpha: look.washAlpha }, props: placements.flatMap((p) => propPrims(theme, p, look.propAlphaMul)), placements };
}

/** The slab and edge colours of a platform under a theme. In the dark view the slab stays plain (nothing decorative outside the light). */
export function slabLook(theme: ThemeId, dark: boolean, look: ThemeLook): { fill: number; line: number | null; edge: number; edgeAlpha: number } {
  const d: ThemeDef = themeOrLab(theme);
  return { fill: d.slab, line: dark ? null : d.line, edge: d.edge, edgeAlpha: look.edgeAlpha };
}
export { themeLook };
