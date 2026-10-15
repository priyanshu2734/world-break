// Exports platform-to-platform navigation edges discovered by probing the REAL shared movement rules.
// Used only by scripts/verify-repair-chain.py to walk the arena in a real browser.
import { ARENA, PLAYER_WIDTH, spawnBody, stepBody } from '@wb/shared';

const HW = PLAYER_WIDTH / 2;
const under = (x: number, y: number) => ARENA.solids.findIndex((s) => Math.abs(y - s.y) < 1e-6 && x + HW > s.x && x - HW < s.x + s.w);
const edges: unknown[] = [];
ARENA.solids.forEach((r, from) => {
  for (let sx = r.x + 4; sx <= r.x + r.w - 4; sx += 6) for (const dir of [-1, 1]) for (const jump of [true, false]) {
    const b = spawnBody(sx, r.y);
    for (let t = 0; t < 60; t++) {
      stepBody(b, { moveX: dir, jump: jump && t === 0 });
      const to = b.grounded ? under(b.x, b.y) : -1;
      if (to >= 0 && to !== from) { edges.push({ from, to, takeoffX: sx, dir, jump, ticks: t + 1 }); break; }
    }
  }
});
console.log(JSON.stringify({ solids: ARENA.solids, edges }));
