import Phaser from 'phaser';
import type { StageState } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { abilitySlots, energyView, type SlotStatus } from './abilityView';

const H = 720, D = 100;
const STATUS_COLOR: Record<SlotStatus, string> = { ready: '#d8f6ff', cooldown: '#ffb02e', no_energy: '#ff9d6b', empty: '#6f8794', unavailable: '#3a4a54' };

/** Reality Energy bar and the five ability slots (bottom row, right of the tools). Reads public server state only. */
export class AbilityHud {
  private boxes: Phaser.GameObjects.Rectangle[] = [];
  private texts: Phaser.GameObjects.Text[] = [];
  private barBg: Phaser.GameObjects.Rectangle;
  private bar: Phaser.GameObjects.Rectangle;
  private barText: Phaser.GameObjects.Text;
  private readonly x0 = 640;

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < 5; i++) {
      const x = this.x0 + i * 118, y = H - 74;
      this.boxes.push(scene.add.rectangle(x, y, 110, 46, 0x04101a, 0.85).setOrigin(0).setDepth(D).setStrokeStyle(1, COLOR.cyanDim).setVisible(false));
      this.texts.push(scene.add.text(x + 6, y + 4, '', { ...FONT, fontSize: '13px', color: COLOR.text, lineSpacing: 2 }).setDepth(D + 1).setVisible(false));
    }
    this.barBg = scene.add.rectangle(this.x0, H - 98, 580, 12, 0x04101a, 0.9).setOrigin(0).setDepth(D).setStrokeStyle(1, COLOR.cyanDim).setVisible(false);
    this.bar = scene.add.rectangle(this.x0 + 2, H - 96, 0, 8, 0x8a6bff).setOrigin(0).setDepth(D + 1).setVisible(false);
    this.barText = scene.add.text(this.x0 + 290, H - 112, '', { ...FONT, fontSize: '13px', color: '#b8a6ff' }).setOrigin(0.5).setDepth(D + 1).setVisible(false);
  }

  update(st: StageState | null, tick: number, localId: string): void {
    const slots = abilitySlots(st, localId, tick);
    const energy = energyView(st, localId);
    const show = slots.length > 0;
    this.barBg.setVisible(show && !!energy); this.bar.setVisible(show && !!energy); this.barText.setVisible(show && !!energy);
    this.boxes.forEach((b, i) => { b.setVisible(show); this.texts[i]!.setVisible(show); });
    if (!show) return;
    if (energy) {
      this.bar.width = 576 * energy.fraction;
      this.barText.setText(`REALITY ENERGY ${energy.energy}/${energy.max}`);
    }
    slots.forEach((s, i) => {
      const status = s.status === 'cooldown' ? `${s.cooldownSeconds.toFixed(1)}s` : s.status === 'no_energy' ? 'no energy' : s.status === 'empty' ? 'empty' : s.status === 'unavailable' ? 'n/a' : 'ready';
      this.texts[i]!.setText(`${s.key} ${s.label}\n${s.detail}  ${status}`).setColor(STATUS_COLOR[s.status]);
    });
  }
}
