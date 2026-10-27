import Phaser from 'phaser';
import type { GhostFx, GhostPublic, GhostShot, GhostStatus } from '@wb/shared';
import { COLOR, FONT } from '../../palette';
import { DISSOLVE_MS, SCREAM_FX_MS, aimLine, boltAt, flashAlpha, fxProgress, gunPrompt, liveFx, liveShots, returnLine, stunnedGhosts, type Pt } from './gunLogic';

const W = 1280, H = 720;
export interface ShotRecord { shot: GhostShot; at: number }
export interface FxRecord { fx: GhostFx; at: number }

/**
 * P3E step 4 and 5: the Pulse Gun on screen. While a gun is in hand: a short aim line (as long as the gun's range) with a crosshair, a READY line or a
 * recharge bar. After a shot: a muzzle flash and the bolt flying. A ghost that was hit DISSOLVES (rising sparks); a Howler's scream is a red ring. When a
 * destroyed ghost is about to come back its warning is spelled out. It draws what the server sent; it decides nothing.
 */
export class GunView {
  private gfx: Phaser.GameObjects.Graphics;
  private prompt: Phaser.GameObjects.Text;
  private bar: Phaser.GameObjects.Graphics;
  private returning: Phaser.GameObjects.Text;
  private tags: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(13);
    this.bar = scene.add.graphics().setDepth(102).setScrollFactor(0);
    this.prompt = scene.add.text(W / 2, H - 150, '', { ...FONT, fontSize: '18px', color: '#c8f7ff', backgroundColor: '#04101add' })
      .setOrigin(0.5).setPadding(10, 5).setDepth(102).setScrollFactor(0).setVisible(false);
    this.returning = scene.add.text(W / 2, 168, '', { ...FONT, fontSize: '22px', color: '#ffd3c8', backgroundColor: '#2a0606dd' })
      .setOrigin(0.5).setPadding(12, 6).setDepth(103).setScrollFactor(0).setVisible(false);
  }

  update(o: {
    me: Pt | null; carries: boolean; aim: number; status: Pick<GhostStatus, 'hiddenIn' | 'caught'> | null;
    shots: readonly ShotRecord[]; fx: readonly FxRecord[]; ghosts: readonly GhostPublic[]; myRoom: string | undefined; nowMs: number;
    /** Milliseconds of recharge left and the share of the whole recharge still to go (0 = ready). */
    leftMs: number; fraction: number;
    /** Ms since a ghost last dissolved in this run (null = never) and whether a warning is on. */
    sinceDissolveMs: number | null; warning: boolean;
  }): void {
    const g = this.gfx;
    g.clear(); this.bar.clear();
    const text = o.me ? gunPrompt(o.carries, o.status, o.leftMs) : null;
    this.prompt.setVisible(text !== null);
    if (text !== null) this.prompt.setText(text);
    if (o.me && text !== null) {
      const ready = o.leftMs <= 0;
      const { from, to } = aimLine(o.me, o.aim);
      const col = ready ? 0x8fe9ff : 0x5a6a70;
      g.lineStyle(2, col, ready ? 0.35 : 0.2).lineBetween(from.x, from.y, to.x, to.y);
      g.lineStyle(2, col, ready ? 0.9 : 0.5).strokeCircle(to.x, to.y, 8).lineBetween(to.x - 12, to.y, to.x + 12, to.y).lineBetween(to.x, to.y - 12, to.x, to.y + 12);
      // the recharge bar under the prompt: it drains toward ready
      const bw = 220, bx = W / 2 - bw / 2, by = H - 128;
      this.bar.fillStyle(0x04101a, 0.85).fillRect(bx - 2, by - 2, bw + 4, 10);
      this.bar.fillStyle(ready ? COLOR.green : COLOR.amber, 1).fillRect(bx, by, ready ? bw : bw * (1 - o.fraction), 6);
    }
    for (const s of liveShots(o.shots, o.nowMs)) {
      if (o.myRoom !== undefined && s.shot.room !== o.myRoom) continue;
      const age = o.nowMs - s.at, b = boltAt(s.shot, age), f = flashAlpha(age);
      if (f > 0) g.fillStyle(0xffffff, 0.6 * f).fillCircle(s.shot.x, s.shot.y, 22 * f + 4);
      if (!b.done) {
        g.lineStyle(4, 0x9ff1ff, 0.55).lineBetween(s.shot.x, s.shot.y, b.x, b.y);
        g.fillStyle(0xe6fbff, 1).fillCircle(b.x, b.y, 7);
      }
    }
    // a destroyed ghost dissolves into rising sparks; a scream is an expanding red ring
    for (const f of liveFx(o.fx, o.nowMs)) {
      if (o.myRoom !== undefined && f.fx.room !== o.myRoom) continue;
      const age = o.nowMs - f.at;
      if (f.fx.kind === 'dissolve') {
        const k = fxProgress(age, DISSOLVE_MS);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2, r = 6 + 34 * k, up = 46 * k * (0.6 + 0.4 * ((i * 7) % 5) / 4);
          g.fillStyle(0xdff6ff, 1 - k).fillCircle(f.fx.x + Math.cos(a) * r, f.fx.y + Math.sin(a) * r * 0.5 - up, 3 * (1 - k) + 1);
        }
        g.lineStyle(3, 0x9ff1ff, 0.8 * (1 - k)).strokeCircle(f.fx.x, f.fx.y, 10 + 60 * k);
      } else {
        const k = fxProgress(age, SCREAM_FX_MS);
        g.lineStyle(5, 0xff3b30, 0.8 * (1 - k)).strokeCircle(f.fx.x, f.fx.y, 20 + 320 * k);
      }
    }
    const back = returnLine(o.warning, o.sinceDissolveMs);
    this.returning.setVisible(back !== null);
    if (back !== null) this.returning.setText(back);
    const stunned = stunnedGhosts(o.ghosts);
    while (this.tags.length < stunned.length) this.tags.push(this.scene.add.text(0, 0, 'STUNNED', { ...FONT, fontSize: '16px', color: '#' + COLOR.green.toString(16).padStart(6, '0') }).setOrigin(0.5).setDepth(14));
    this.tags.forEach((t, i) => {
      const gh = stunned[i];
      t.setVisible(gh !== undefined);
      if (gh) t.setPosition(gh.x, gh.y - 34);
    });
  }

  destroy(): void { this.gfx.destroy(); this.bar.destroy(); this.prompt.destroy(); this.returning.destroy(); this.tags.forEach((t) => t.destroy()); this.tags = []; }
}
