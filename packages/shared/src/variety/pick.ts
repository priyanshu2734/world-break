import { createRng, deriveSeed } from '../disasters/rng';
import { ROOM_TEMPLATES, TEMPLATE_IDS, type TemplateId, type TemplateRoom } from './templates';

/**
 * P3F step 1: which template each room of a stage uses. A pure function of `(stage, seed)`.
 *
 * The no-repeat rule ("no stage uses the previous stage's template") has to hold although stage N never sees the seed of stage N-1, so it is made
 * true BY CONSTRUCTION: the templates are split into an ODD pool and an EVEN pool, odd stages draw from one and even stages from the other.
 * Stage 1 is the tutorial room, which is in neither pool. Inside one stage the rooms get different templates while the pool has enough of them.
 */
export function templatePool(stage: number): readonly TemplateId[] {
  const s = Number.isFinite(stage) ? Math.max(1, Math.floor(stage)) : 1;
  if (s <= 1) return ['tutorial'];
  if (s === 2) return ['hall']; // the single-gate room of stage 2 is the original plan
  const pool = s % 2 === 1 ? 'odd' : 'even';
  return TEMPLATE_IDS.filter((id) => id !== 'tutorial' && ROOM_TEMPLATES[id].pool === pool && ROOM_TEMPLATES[id].minStage <= s);
}

/** The template of each of the `count` rooms of a stage, in room order. Deterministic in `(stage, seed)`. */
export function templatesForStage(stage: number, seed: number, count: number): TemplateId[] {
  const pool = templatePool(stage);
  const order = createRng(deriveSeed(seed, 'template', stage)).shuffle(pool);
  return Array.from({ length: count }, (_, i) => order[i % order.length]!);
}

/**
 * The room that template `id` builds for room `index` of `stage` (a pure function of `(stage, seed, index, id)`; its own generator, so no draw of the stage generator is
 * spent on it). `null` for `tutorial` and `hall`, which the original room plan builds.
 */
export function templateRoomFor(stage: number, seed: number, index: number, id: TemplateId): TemplateRoom | null {
  const t = ROOM_TEMPLATES[id];
  if (t.build === undefined) return null;
  const rng = createRng(deriveSeed(seed, 'room', stage, index, id));
  return t.build(rng.pick(t.widths), rng);
}
