import { PROP_MAX_ALPHA, themeOrLab, type PropPlacement, type ThemeId } from '@wb/shared';
import { circle, line, rect, type Prim } from './prims';

/**
 * P3F step 5: the procedural art of one prop (original, drawn from rectangles, lines and circles). A prop stands on the line `p.y`, spans `p.x .. p.x + p.w` and rises `p.h`.
 * Every primitive's alpha is the prop's own alpha (at most `PROP_MAX_ALPHA`) times a share of at most 1, so no prop is ever bright enough to hide a hazard or a world object.
 */
export function propPrims(theme: ThemeId, p: PropPlacement, alphaMul = 1): Prim[] {
  const d = themeOrLab(theme);
  const body = p.shade === 0 ? d.prop : p.shade === 1 ? d.propDark : d.propLight;
  const A = Math.min(PROP_MAX_ALPHA, p.alpha * alphaMul), dark = d.propDark, light = d.propLight;
  const { x, y, w, h } = p, top = y - h;
  switch (p.kind) {
    case 'bench': return [rect(x, top, w, 8, body, A), rect(x + 6, top + 8, 6, h - 8, dark, A), rect(x + w - 12, top + 8, 6, h - 8, dark, A), rect(x + 14, top - 14, 10, 14, light, A * 0.8), rect(x + 40, top - 9, 16, 9, light, A * 0.8)];
    case 'rack': return [rect(x, top, w, h, dark, A * 0.7), ...[0, 1, 2].map((i) => line(x, top + 18 + i * 26, x + w, top + 18 + i * 26, light, A, 2)), ...[0, 1, 2].map((i) => rect(x + 8 + i * 16, top + 6, 6, 12, body, A))];
    case 'monitor': return [rect(x, top, w, h, dark, A), rect(x + 4, top + 4, w - 8, h - 14, body, A), line(x + 8, top + 12, x + w - 12, top + 12, light, A, 1), line(x + 8, top + 20, x + w - 22, top + 20, light, A, 1), rect(x + w / 2 - 6, y - 8, 12, 8, dark, A)];
    case 'pipe': return [rect(x, top, w, h, body, A), line(x, top + 2, x + w, top + 2, light, A, 1), ...[0.25, 0.75].map((f) => rect(x + w * f - 3, top - 3, 6, h + 6, dark, A))];
    case 'bed': return [rect(x, top + 14, w, 12, body, A), rect(x, top, 10, h, dark, A), rect(x + w - 10, top + 8, 10, h - 8, dark, A), rect(x + 14, top + 6, 28, 10, light, A * 0.9)];
    case 'curtain': return [line(x, top, x + w, top, dark, A, 2), ...Array.from({ length: 6 }, (_, i) => rect(x + i * (w / 6), top + 2, w / 6 - 2, h - 2, i % 2 === 0 ? body : dark, A * 0.8))];
    case 'drip': return [line(x + w / 2, top, x + w / 2, y, dark, A, 3), line(x, top, x + w, top, dark, A, 3), rect(x + w - 10, top + 4, 8, 22, light, A * 0.9), circle(x + w / 2, y - 3, 6, dark, A)];
    case 'cabinet': return [rect(x, top, w, h, body, A), rect(x + 4, top + 4, w / 2 - 6, h - 8, dark, A * 0.8, true), rect(x + w / 2 + 2, top + 4, w / 2 - 6, h - 8, dark, A * 0.8, true), circle(x + w / 2 - 5, top + h / 2, 2, light, A), circle(x + w / 2 + 5, top + h / 2, 2, light, A)];
    case 'gear': { const cx = x + w / 2, cy = top + h / 2, r = w / 2 - 6; return [circle(cx, cy, r, body, A), circle(cx, cy, r * 0.35, dark, A), ...Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return line(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6), body, A, 6); })]; }
    case 'crates': return [rect(x, top + h / 2, w / 2, h / 2, body, A), rect(x + w / 2, top + h / 2, w / 2, h / 2, dark, A), rect(x + w / 4, top, w / 2, h / 2, body, A), line(x, y - h / 4, x + w / 2, y - h / 4, light, A * 0.7, 1), line(x + w / 4, top + h / 4, x + w * 0.75, top + h / 4, light, A * 0.7, 1)];
    case 'vent': return [rect(x, top, w, h, dark, A), ...Array.from({ length: 5 }, (_, i) => line(x + 6, top + 6 + i * 6, x + w - 6, top + 6 + i * 6, light, A, 2))];
    case 'girder': return [rect(x, top, w, 4, body, A), rect(x, y - 4, w, 4, body, A), ...Array.from({ length: Math.floor(w / 24) }, (_, i) => line(x + i * 24, top + 4, x + i * 24 + 12, y - 4, dark, A, 2))];
    case 'shelf': {
      const planks = [0, 1, 2, 3].map((i) => top + 30 + i * 36);
      return [rect(x, top, 6, h, dark, A), rect(x + w - 6, top, 6, h, dark, A), ...planks.map((py) => rect(x, py, w, 5, body, A)),
        ...planks.slice(0, 3).flatMap((py) => Array.from({ length: 5 }, (_, k) => rect(x + 10 + k * 14, py - 20 + (k % 2) * 4, 9, 20 - (k % 2) * 4, k % 2 ? light : body, A * 0.9)))];
    }
    case 'books': return [rect(x, y - 10, w, 10, body, A), rect(x + 6, y - 20, w - 14, 10, dark, A), rect(x + 14, y - 30, w - 34, 10, light, A * 0.9)];
    case 'ladder': return [line(x + 4, top, x + 4, y, body, A, 4), line(x + w - 4, top, x + w - 4, y, body, A, 4), ...Array.from({ length: Math.floor(h / 16) }, (_, i) => line(x + 4, top + 8 + i * 16, x + w - 4, top + 8 + i * 16, dark, A, 3))];
    case 'desk': return [rect(x, top, w, 8, body, A), rect(x + 6, top + 8, 8, h - 8, dark, A), rect(x + w - 14, top + 8, 8, h - 8, dark, A), rect(x + 20, top - 8, 26, 8, light, A * 0.9), rect(x + 60, top - 14, 10, 14, dark, A)];
  }
}
