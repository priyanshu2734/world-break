import Phaser from 'phaser';
import type { StageState } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { drawShape } from './itemDraw';
import { TONE_COLOR, carryView } from './itemView';

const W = 1280, H = 720, D = 100;
const BOX = 116, GAP = 8;

/** The two carry slots (bottom right). A heavy part spans both. Shown only on stages that have parts. */
export class ItemHud {
  private frame: Phaser.GameObjects.Graphics;
  private title: Phaser.GameObjects.Text;
  private names: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene) {
    this.frame = scene.add.graphics().setDepth(D);
    this.title = scene.add.text(W - 16, H - 192, '', { ...FONT, fontSize: '13px', color: '#9fb6c2' }).setOrigin(1, 0).setDepth(D + 1).setVisible(false);
    for (let i = 0; i < 2; i++) this.names.push(scene.add.text(0, 0, '', { ...FONT, fontSize: '12px', color: COLOR.text }).setOrigin(0.5, 0).setDepth(D + 1).setVisible(false));
  }

  update(st: StageState | null, localId: string): void {
    const g = this.frame;
    g.clear();
    const v = carryView(st, localId);
    this.title.setVisible(!!v);
    this.names.forEach((n) => n.setVisible(false));
    if (!v) return;
    this.title.setText(`HANDS ${v.used}/${v.max}   E pick up  G drop/swap  F fit  H hand over`);
    const x0 = W - 16 - (BOX * v.max + GAP * (v.max - 1));
    const y0 = H - 172;
    v.cells.forEach((c, i) => {
      const x = x0 + i * (BOX + GAP);
      const covered = c.kind === 'covered';
      if (covered) return; // drawn by the heavy part that spans it
      const span = c.kind === 'part' ? c.span : 1;
      const w = BOX * span + GAP * (span - 1);
      const tone = c.kind === 'part' ? (c.cracked ? 'danger' : 'cyan') : 'cyan';
      g.fillStyle(0x04101a, 0.85).fillRect(x, y0, w, 56);
      g.lineStyle(c.kind === 'part' ? 2 : 1, c.kind === 'part' ? TONE_COLOR[tone] : COLOR.cyanDim, 1).strokeRect(x, y0, w, 56);
      if (c.kind === 'part') {
        drawShape(g, c.shape, x + w / 2, y0 + 20, span === 2 ? 15 : 11, TONE_COLOR[tone], 0.35);
        if (c.cracked) g.lineStyle(2, COLOR.danger, 1).lineBetween(x + w / 2 - 11, y0 + 9, x + w / 2 + 11, y0 + 31);
        this.names[i]!.setColor(COLOR.text).setText(c.cracked ? `${c.label} (cracked)` : c.label).setPosition(x + w / 2, y0 + 38).setVisible(true);
      } else {
        this.names[i]!.setText('empty').setColor('#4f6672').setPosition(x + w / 2, y0 + 20).setVisible(true);
      }
    });
  }
}
