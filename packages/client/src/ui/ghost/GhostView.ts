import Phaser from 'phaser';
import type { GhostPublic } from '@wb/shared';
import { ghostLook, ghostShape, smoothToward } from './ghostLook';

const DEPTH = 11; // above the players (10), below the dark layer (50): the dark view hides it outside the light like everything else

interface One { box: Phaser.GameObjects.Container; glow: Phaser.GameObjects.Image; body: Phaser.GameObjects.Graphics; x: number; y: number; seen: number }

/**
 * P3E step 2: draws the ghosts the server put in THIS player's view (`GameSnapshot.ghosts`). It never invents a ghost and never
 * reads a position from anywhere else; no entry in the snapshot means nothing is drawn. The Wisp is a small pale glow with a
 * teardrop body, a wavy tail and two dark eyes, all drawn in code.
 */
export class GhostView {
  private ones = new Map<string, One>();
  constructor(private scene: Phaser.Scene) {}

  /** `stage` picks the look tier (a stage 25 ghost is bigger and more menacing than a stage 2 one). */
  update(ghosts: readonly GhostPublic[], myRoom: string | undefined, ms: number, dtMs: number, stage = 2): void {
    const live = new Set<string>();
    for (const g of ghosts) {
      if (myRoom !== undefined && g.room !== myRoom) continue; // another room has other coordinates
      live.add(g.id);
      let o = this.ones.get(g.id);
      if (!o) { o = this.make(g); this.ones.set(g.id, o); }
      const look = ghostLook(g.state, ms), shape = ghostShape(g.kind, stage, g.state, ms, g.lit === true);
      if (Math.hypot(g.x - o.x, g.y - o.y) > 200) { o.x = g.x; o.y = g.y; } // a respawn or a room change: do not glide across the room
      o.x = smoothToward(o.x, g.x, dtMs); o.y = smoothToward(o.y, g.y, dtMs);
      o.box.setPosition(o.x, o.y + (shape.still ? 0 : look.bob) * shape.scale).setVisible(true).setScale(shape.scale);
      o.glow.setTint(shape.glowTint).setAlpha(look.glowAlpha).setScale(shape.glowScale);
      o.body.setAlpha(g.kind === 'shade' ? Math.max(0.8, look.bodyAlpha) : look.bodyAlpha);
      this.redraw(o.body, g, shape);
    }
    for (const [id, o] of this.ones) if (!live.has(id)) { o.box.destroy(); this.ones.delete(id); }
  }

  get count(): number { return this.ones.size; }
  destroy(): void { for (const o of this.ones.values()) o.box.destroy(); this.ones.clear(); }

  private make(g: GhostPublic): One {
    const glow = this.scene.add.image(0, 0, 'spark').setBlendMode(Phaser.BlendModes.ADD);
    const body = this.scene.add.graphics();
    const box = this.scene.add.container(g.x, g.y, [glow, body]).setDepth(DEPTH);
    return { box, glow, body, x: g.x, y: g.y, seen: 0 };
  }

  private redraw(gfx: Phaser.GameObjects.Graphics, g: GhostPublic, shape: ReturnType<typeof ghostShape>): void {
    gfx.clear();
    const poly = (pts: { x: number; y: number }[]) => pts.map((p) => new Phaser.Geom.Point(p.x, p.y));
    gfx.fillStyle(shape.tint, 0.92).fillPoints(poly(shape.body), true);
    for (const e of shape.extras) gfx.fillStyle(shape.tint, 0.92).fillPoints(poly(e), true);
    if (shape.rim !== null) { gfx.lineStyle(1.5, shape.rim, 0.9).strokePoints(poly(shape.body), true); }
    const face = Math.cos(g.angle) >= 0 ? 1 : -1;
    for (const e of shape.eyes) gfx.fillStyle(shape.eyeColor, 1).fillCircle(e.x + face * 1.2, e.y, e.r);
  }
}
