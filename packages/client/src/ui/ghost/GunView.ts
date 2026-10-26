import Phaser from 'phaser';
import type { GhostPublic, GhostShot } from '@wb/shared';
import { COLOR, FONT } from '../../palette';
import { aimLine, boltAt, flashAlpha, gunPrompt, liveShots, stunnedGhosts, type Pt } from './gunLogic';
import type { GhostStatus } from '@wb/shared';

const W = 1280, H = 720;
export interface ShotRecord { shot: GhostShot; at: number }

/**
 * P3E step 4: the Pulse Gun on screen. While a gun is in hand: a short aim line (as long as the gun's range) with a crosshair. After a shot: a muzzle
 * flash and the bolt flying. Over a stunned ghost: a "STUNNED" tag. It draws what the server sent; it decides nothing.
 */
export class GunView {
  private gfx: Phaser.GameObjects.Graphics;
  private prompt: Phaser.GameObjects.Text;
  private tags: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(13);
    this.prompt = scene.add.text(W / 2, H - 150, '', { ...FONT, fontSize: '18px', color: '#c8f7ff', backgroundColor: '#04101add' })
      .setOrigin(0.5).setPadding(10, 5).setDepth(102).setScrollFactor(0).setVisible(false);
  }

  update(o: { me: Pt | null; carries: boolean; aim: number; status: Pick<GhostStatus, 'hiddenIn' | 'caught'> | null; shots: readonly ShotRecord[]; ghosts: readonly GhostPublic[]; myRoom: string | undefined; nowMs: number }): void {
    const g = this.gfx;
    g.clear();
    const text = o.me ? gunPrompt(o.carries, o.status) : null;
    this.prompt.setVisible(text !== null);
    if (text !== null) this.prompt.setText(text);
    if (o.me && text !== null) {
      const { from, to } = aimLine(o.me, o.aim);
      g.lineStyle(2, 0x8fe9ff, 0.35).lineBetween(from.x, from.y, to.x, to.y);
      g.lineStyle(2, 0x8fe9ff, 0.9).strokeCircle(to.x, to.y, 8).lineBetween(to.x - 12, to.y, to.x + 12, to.y).lineBetween(to.x, to.y - 12, to.x, to.y + 12);
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
    const stunned = stunnedGhosts(o.ghosts);
    while (this.tags.length < stunned.length) this.tags.push(this.scene.add.text(0, 0, 'STUNNED', { ...FONT, fontSize: '16px', color: '#' + COLOR.green.toString(16).padStart(6, '0') }).setOrigin(0.5).setDepth(14));
    this.tags.forEach((t, i) => {
      const gh = stunned[i];
      t.setVisible(gh !== undefined);
      if (gh) t.setPosition(gh.x, gh.y - 34);
    });
  }

  destroy(): void { this.gfx.destroy(); this.prompt.destroy(); this.tags.forEach((t) => t.destroy()); this.tags = []; }
}
