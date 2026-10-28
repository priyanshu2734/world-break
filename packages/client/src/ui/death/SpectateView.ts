import Phaser from 'phaser';
import type { DeathState, GhostPing } from '@wb/shared';
import { COLOR, FONT } from '../../palette';
import { activePings, headline, isSpectating, pingAlpha, watchLine } from './spectateLogic';

const W = 1280, H = 720;

/**
 * P4 step 2: what a dead player sees on top of the world (a dim, the headline, whom they watch and the keys) and the "ghost here" pings (drawn for
 * the living too). It draws only what the server sent: the death state and the ping list. Nothing here decides anything.
 */
export class SpectateView {
  private dim: Phaser.GameObjects.Rectangle;
  private head: Phaser.GameObjects.Text;
  private line: Phaser.GameObjects.Text;
  private rings: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene) {
    this.dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x02060a, 0.28).setDepth(48).setScrollFactor(0).setVisible(false);
    this.head = scene.add.text(W / 2, 64, '', { ...FONT, fontSize: '22px', color: '#ff8c8c', backgroundColor: '#020509cc' })
      .setOrigin(0.5, 0).setPadding(14, 8).setDepth(104).setScrollFactor(0).setVisible(false);
    this.line = scene.add.text(W / 2, H - 76, '', { ...FONT, fontSize: '18px', color: '#cfe8ff', backgroundColor: '#04101acc' })
      .setOrigin(0.5, 1).setPadding(12, 6).setDepth(104).setScrollFactor(0).setVisible(false);
    this.rings = scene.add.graphics().setDepth(30);
  }

  update(o: { death: DeathState | null; arrivedMs: number; pings: readonly { ping: GhostPing; at: number }[]; room: string | undefined; nowMs: number }): void {
    const dead = isSpectating(o.death);
    this.dim.setVisible(dead);
    const h = headline(o.death, o.nowMs, o.arrivedMs), w = watchLine(o.death, o.nowMs, o.arrivedMs);
    this.head.setText(h).setVisible(h !== '');
    this.line.setText(w).setVisible(w !== '');

    // pings, in the world: a ring that shrinks onto the spot and the word, for everyone in the room
    this.rings.clear();
    const live = activePings(o.pings, o.room, o.nowMs);
    while (this.labels.length < live.length) this.labels.push(this.scene.add.text(0, 0, 'GHOST', { ...FONT, fontSize: '14px', color: '#ffb02e' }).setOrigin(0.5).setDepth(31));
    this.labels.forEach((t, i) => {
      const p = live[i];
      if (!p) { t.setVisible(false); return; }
      const a = pingAlpha(p.age), r = 16 + 30 * Math.max(0, 1 - p.age / 700);
      this.rings.lineStyle(3, COLOR.amber, a).strokeCircle(p.ping.x, p.ping.y - 22, r);
      t.setPosition(p.ping.x, p.ping.y - 70).setAlpha(a).setVisible(true).setText(`GHOST (${p.ping.from})`);
    });
  }

  destroy(): void { this.dim.destroy(); this.head.destroy(); this.line.destroy(); this.rings.destroy(); for (const t of this.labels) t.destroy(); }
}
