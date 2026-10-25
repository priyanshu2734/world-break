import type { GhostPublic } from '@wb/shared';

/** P3E step 2: pure look parameters for the Wisp (a small pale glow). No Phaser here. */
export interface GhostLook { tint: number; glowAlpha: number; bodyAlpha: number; glowScale: number; bob: number }

export const WISP_TINT = 0xcfe8ff;
const STATE_TINT: Record<GhostPublic['state'], number> = { roaming: 0xcfe8ff, hunting: 0xffd9c8, stunned: 0x8a96a0 };

export function ghostLook(state: GhostPublic['state'], ms: number): GhostLook {
  const pulse = 0.5 + 0.5 * Math.sin(ms / (state === 'hunting' ? 160 : 520));
  const base = state === 'stunned' ? 0.35 : state === 'hunting' ? 0.95 : 0.7;
  return {
    tint: STATE_TINT[state] ?? WISP_TINT,
    glowAlpha: (state === 'stunned' ? 0.12 : 0.22) + 0.12 * pulse,
    bodyAlpha: base * (0.85 + 0.15 * pulse),
    glowScale: state === 'hunting' ? 5.5 : 4.5,
    bob: state === 'stunned' ? 0 : Math.sin(ms / 380) * 4,
  };
}

/** Teardrop outline of the body (local px, origin at the centre): a round head with a short wavy tail. n points. */
export function wispOutline(ms: number, n = 18): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const r = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (y > 0) y += (1 - Math.cos(a * 2 + Math.PI)) * 3 * (1 + 0.3 * Math.sin(ms / 200 + x * 0.4)) + 3; // tail drops below the head
    pts.push({ x, y });
  }
  return pts;
}

/** Move toward a target without overshoot (a snapshot-rate ghost looks smooth between 20 Hz updates). */
export function smoothToward(cur: number, target: number, dtMs: number, tauMs = 60): number {
  if (!Number.isFinite(cur)) return target;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return cur + (target - cur) * k;
}
