/**
 * P3E step 2: the light flicker during a WARNING. Returns a brightness multiplier 0.35..1 for the player's light.
 * Normal: the light dips in slots of at least 160 ms chosen by a fixed hash. It dips to 35% to 65%, it never goes fully dark and
 * never flashes bright, so it is a flicker of the light, not a strobe. Players who still find it hard use `?reduceflash=1`.
 * Reduced (`?reduceflash=1`): a slow sine between 0.7 and 1 with a 3 s period: no sudden change at all.
 */
export const FLICKER_SLOT_MS = 160;
export const FLICKER_MIN = 0.35;

function hash(n: number): number {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export function flickerLevel(ms: number, reduced: boolean): number {
  if (!Number.isFinite(ms)) return 1;
  if (reduced) return 0.85 + 0.15 * Math.sin((ms / 3000) * 2 * Math.PI);
  const slot = Math.floor(ms / FLICKER_SLOT_MS);
  const r = hash(slot);
  return r < 0.4 ? FLICKER_MIN + 0.3 * hash(slot + 7919) : 1; // 40% of slots are dim (0.35..0.65), the rest full
}

/** The multiplier to apply to the light reach and ambient: 1 outside a warning. */
export function lightScale(warning: boolean, ms: number, reduced: boolean): number {
  return warning ? flickerLevel(ms, reduced) : 1;
}
