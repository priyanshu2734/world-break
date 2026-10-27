import Phaser from 'phaser';
import type { GhostStatus } from '@wb/shared';
import { COLOR, FONT } from '../../palette';
import { WARNING_TIP, captiveInReach, hidePrompt, modeOf, nearestSpot } from './hideLogic';

const W = 1280, H = 720;

/**
 * P3E step 3: draws the hiding places the server told this player about, the prompt (hide, come out, hold E to free someone, you are caught),
 * a vignette while hiding, and a progress bar over a caught teammate. It draws only what is in `GhostStatus`: no status, nothing drawn.
 */
export class HideView {
  private spots: Phaser.GameObjects.Graphics;
  private prompt: Phaser.GameObjects.Text;
  private tip: Phaser.GameObjects.Text;
  private vignette: Phaser.GameObjects.Rectangle;
  private bars: Phaser.GameObjects.Graphics;
  private tipUntil = 0;

  constructor(private scene: Phaser.Scene) {
    this.spots = scene.add.graphics().setDepth(4);
    this.bars = scene.add.graphics().setDepth(12);
    this.prompt = scene.add.text(W / 2, H - 190, '', { ...FONT, fontSize: '20px', color: '#ffe9c7', backgroundColor: '#04101add' })
      .setOrigin(0.5).setPadding(12, 6).setDepth(102).setScrollFactor(0).setVisible(false);
    this.tip = scene.add.text(W / 2, 128, '', { ...FONT, fontSize: '22px', color: '#cfe8ff', backgroundColor: '#020509cc' })
      .setOrigin(0.5).setPadding(14, 8).setDepth(103).setScrollFactor(0).setVisible(false);
    this.vignette = scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.35).setDepth(49).setScrollFactor(0).setVisible(false);
  }

  /** Show the one-time explanation of the flicker for a few seconds. */
  showTip(now: number): void { this.tip.setText(WARNING_TIP).setVisible(true); this.tipUntil = now + 6000; }

  update(o: {
    status: GhostStatus | null; me: { x: number; y: number } | null; where: ReadonlyMap<string, { x: number; y: number }>;
    nameOf: (id: string) => string; otherPrompt: boolean; now: number;
  }): void {
    if (this.tipUntil !== 0 && o.now > this.tipUntil) { this.tip.setVisible(false); this.tipUntil = 0; }
    const st = o.status;
    const mode = modeOf(st);
    this.vignette.setVisible(mode === 'hidden');
    this.spots.clear();
    this.bars.clear();
    if (!st) { this.prompt.setVisible(false); return; }
    for (const s of st.spots) {
      const mine = st.hiddenIn === s.id;
      if (s.kind === 'closet') {
        this.spots.fillStyle(0x0d1c27, 1).fillRect(s.x - 24, s.y - 84, 48, 84).lineStyle(2, COLOR.cyanDim, 0.9).strokeRect(s.x - 24, s.y - 84, 48, 84);
        this.spots.lineStyle(1, COLOR.cyanDim, 0.6).lineBetween(s.x, s.y - 84, s.x, s.y).fillStyle(mine ? COLOR.amber : COLOR.cyanDim, 0.9).fillCircle(s.x - 7, s.y - 42, 2).fillCircle(s.x + 7, s.y - 42, 2);
      } else {
        this.spots.fillStyle(0x0d1c27, 1).fillRect(s.x - 30, s.y - 34, 60, 26).lineStyle(2, COLOR.cyanDim, 0.9).strokeRect(s.x - 30, s.y - 34, 60, 26);
        for (let i = 0; i < 4; i++) this.spots.lineStyle(1, COLOR.cyanDim, 0.7).lineBetween(s.x - 24 + i * 16, s.y - 30, s.x - 24 + i * 16, s.y - 12);
      }
    }
    // a caught teammate in view: a ring and the rescue progress above their head
    for (const c of st.captives) {
      const p = o.where.get(c.id);
      if (!p) continue;
      this.bars.lineStyle(2, COLOR.danger, 0.9).strokeCircle(p.x, p.y - 22, 30);
      this.bars.fillStyle(0x04101a, 0.9).fillRect(p.x - 25, p.y - 74, 50, 6).fillStyle(COLOR.amber, 1).fillRect(p.x - 25, p.y - 74, 50 * c.progress, 6);
    }
    const spot = o.me ? nearestSpot(o.me, st.spots) : null;
    const captive = o.me ? captiveInReach(o.me, st.captives, o.where) : null;
    const text = hidePrompt({ status: st, spot: o.otherPrompt && mode === 'free' ? null : spot, captive, captiveName: captive ? o.nameOf(captive.id) : '' });
    this.prompt.setVisible(text !== '').setText(text);
  }

  destroy(): void { this.spots.destroy(); this.bars.destroy(); this.prompt.destroy(); this.tip.destroy(); this.vignette.destroy(); }
}
