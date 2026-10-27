import { GHOST_LOOK_SCALE, ghostLookTier, type GhostPublic, type GhostType } from '@wb/shared';

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

// ------------------------------------------------------------------------------------------------ P3E step 5: one look per type, growing with the stage
export interface Pt { x: number; y: number }
export interface Eye { x: number; y: number; r: number }
export interface GhostShape {
  /** Body scale from the look tier (a stage 25 ghost is clearly bigger than a stage 2 one). */
  scale: number;
  tier: 0 | 1 | 2 | 3;
  body: Pt[];
  /** Extra polygons: arms, crown spikes. */
  extras: Pt[][];
  eyes: Eye[];
  eyeColor: number;
  tint: number;
  /** Glow tint and radius multiplier. */
  glowTint: number;
  glowScale: number;
  /** A pale outline (the Shade is dark: it needs a rim to be seen in the dark), or null. */
  rim: number | null;
  /** The body does not bob (a stunned ghost, or a Shade frozen in the light). */
  still: boolean;
}

export const KIND_TINT: Record<GhostType, number> = { wisp: 0xcfe8ff, shade: 0x2a2f55, howler: 0x6b2f2f };
export const mixColor = (a: number, b: number, t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  const ch = (shift: number) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** `n` pointed spikes along the top of a body (a crown), `w` wide, from `topY` up by `h`. */
export function crown(n: number, w: number, topY: number, h: number): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const cx = n === 1 ? 0 : -w / 2 + (w * i) / (n - 1), up = h * (i % 2 === 0 ? 1 : 0.7);
    out.push([{ x: cx - 2.5, y: topY }, { x: cx, y: topY - up }, { x: cx + 2.5, y: topY }]);
  }
  return out;
}

/** Spikes a tier adds: none, none, 3, 5. */
export const CROWN_SPIKES = [0, 0, 3, 5] as const;

export function ghostShape(kind: GhostType, stage: number, state: GhostPublic['state'], ms: number, lit = false): GhostShape {
  const tier = ghostLookTier(stage), scale = GHOST_LOOK_SCALE[tier];
  const menace = tier * 0.18; // the colour slides toward red as the stage grows
  const hunting = state === 'hunting';
  const base = { scale, tier, still: state === 'stunned' || lit } as const;
  if (kind === 'shade') {
    const wave = Math.sin(ms / 260) * 2.2;
    const body: Pt[] = [{ x: -6, y: -30 }, { x: 6, y: -30 }, { x: 9, y: -14 }, { x: 12, y: 20 }, { x: 7, y: 34 + wave }, { x: 0, y: 27 - wave }, { x: -7, y: 34 - wave }, { x: -12, y: 20 }, { x: -9, y: -14 }];
    const eyeC = lit ? 0x7fa8ff : hunting ? 0xff5a4d : 0xe6efff;
    const eyes: Eye[] = [{ x: -3, y: -22, r: 1.6 + tier * 0.3 }, { x: 3, y: -22, r: 1.6 + tier * 0.3 }];
    if (tier >= 3) eyes.push({ x: 0, y: -26, r: 1.4 });
    return { ...base, body, extras: crown(CROWN_SPIKES[tier], 10, -30, 9), eyes, eyeColor: eyeC, tint: mixColor(KIND_TINT.shade, 0x7a1020, menace), glowTint: lit ? 0x6f8fff : mixColor(0x3b4aa8, 0xaa1c2c, menace), glowScale: 3.4, rim: lit ? 0xbcd0ff : 0x7d8cff };
  }
  if (kind === 'howler') {
    const sway = Math.sin(ms / 420) * 3;
    const body: Pt[] = [{ x: -8, y: -24 }, { x: 8, y: -24 }, { x: 11, y: -6 }, { x: 8, y: 16 }, { x: -8, y: 16 }, { x: -11, y: -6 }];
    const arm = (side: 1 | -1): Pt[] => [{ x: side * 10, y: -14 }, { x: side * 15, y: -12 }, { x: side * (19 + sway), y: 30 }, { x: side * (15 + sway), y: 34 }, { x: side * 9, y: -2 }];
    const eyes: Eye[] = [{ x: -3.5, y: -17, r: 2.2 + tier * 0.3 }, { x: 3.5, y: -17, r: 2.2 + tier * 0.3 }];
    if (tier >= 3) eyes.push({ x: 0, y: -21, r: 1.8 });
    return { ...base, body, extras: [arm(1), arm(-1), ...crown(CROWN_SPIKES[tier], 12, -24, 10)], eyes, eyeColor: 0xff3b30, tint: mixColor(KIND_TINT.howler, 0x9a1010, menace), glowTint: mixColor(0x992222, 0xff2a2a, menace), glowScale: hunting ? 5 : 3.8, rim: null };
  }
  // the Wisp: the small pale glow, its eyes and spikes turn menacing with the stage
  const body = wispOutline(ms);
  const eyeC = hunting ? 0xff4d4d : state === 'stunned' ? 0x3a4046 : tier >= 2 ? 0x6a1010 : 0x0a1822;
  const er = 2 + tier * 0.4;
  const eyes: Eye[] = [{ x: -3.5, y: -2, r: er }, { x: 3.5, y: -2, r: er }];
  if (tier >= 3) eyes.push({ x: -3.5, y: -7, r: 1.5 }, { x: 3.5, y: -7, r: 1.5 });
  const t = ghostLook(state, ms);
  return { ...base, body, extras: crown(CROWN_SPIKES[tier], 14, -11, 8), eyes, eyeColor: eyeC, tint: mixColor(t.tint, 0xff7a6a, menace), glowTint: mixColor(t.tint, 0xff4a3a, menace), glowScale: t.glowScale, rim: null };
}
