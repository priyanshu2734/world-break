import type { Arena } from '@wb/shared';

/**
 * P3F step 1: the reach graph of a room costs about 15 ms (it runs the real movement function thousands of times) and is cached per arena OBJECT. Stage generation builds a
 * fresh arena object every time, although a template room is a pure function of a few numbers, so equal rooms are given ONE shared instance here and the graph is
 * computed once per distinct room. Pure content key (solids and spawns), bounded: the map is emptied when it grows past `MAX`.
 */
const MAX = 600;
const known = new Map<string, Arena>();

export function canonicalArena(a: Arena): Arena {
  const key = `${a.width}x${a.height}|${a.solids.map((s) => `${s.x},${s.y},${s.w},${s.h}`).join(';')}|${a.spawns.map((p) => `${p.x},${p.y}`).join(';')}`;
  const hit = known.get(key);
  if (hit) return hit;
  if (known.size >= MAX) known.clear();
  known.set(key, a);
  return a;
}
