import Phaser from 'phaser';
import type { DeathReviewMsg, RoomPhase } from '@wb/shared';
import { FONT } from '../../palette';
import { coversScreen, killSummary, retryHint, reviewSections, showReview, teamLine, wipeHeadline } from './reviewLogic';

const W = 1280, H = 720;
/** Above every other thing in the scene (the HUD tops out at depth 105): the review is a full-screen panel, nothing shows through it. */
const DEPTH = 1000;

/** P4 step 4 and 6: the wipe banner and the death review, as a full-screen dark panel. It draws only what the server sent in `death:review` and the room phase; it decides nothing. */
export class ReviewView {
  private bg: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private headline: Phaser.GameObjects.Text;
  private why: Phaser.GameObjects.Text;
  private body: Phaser.GameObjects.Text;
  private team: Phaser.GameObjects.Text;
  private foot: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const t = (y: number, size: number, color: string, wrap = W - 240): Phaser.GameObjects.Text =>
      scene.add.text(W / 2, y, '', { ...FONT, fontSize: `${size}px`, color, align: 'center', wordWrap: { width: wrap }, lineSpacing: 6 }).setOrigin(0.5, 0).setDepth(DEPTH + 1).setScrollFactor(0).setVisible(false);
    this.bg = scene.add.rectangle(W / 2, H / 2, W, H, 0x03060a, 1).setDepth(DEPTH).setScrollFactor(0).setVisible(false);
    this.title = t(36, 18, '#8aa0b0');
    this.headline = t(96, 54, '#ff8c8c');
    this.why = t(176, 26, '#ffe2c2', W - 200);
    this.body = scene.add.text(W / 2, 270, '', { ...FONT, fontSize: '17px', color: '#c9d8e4', wordWrap: { width: W - 360 }, lineSpacing: 5 }).setOrigin(0.5, 0).setDepth(DEPTH + 1).setScrollFactor(0).setVisible(false);
    this.team = t(H - 120, 16, '#8aa0b0');
    this.foot = t(H - 70, 22, '#9ff0b0');
  }

  update(o: { phase: RoomPhase | undefined; review: DeathReviewMsg | null; isHost: boolean; stage: number | undefined }): void {
    const on = coversScreen(o.phase);
    this.bg.setVisible(on);
    const title = wipeHeadline(o.phase, o.review);
    this.title.setText(title).setVisible(on && title !== '');
    const review = showReview(o.phase) ? o.review : null;
    const yours = review?.yours ?? null;
    // the line that matters first and largest: what killed you and why
    const s = yours ? killSummary(yours) : null;
    this.headline.setText(s?.headline ?? (review ? 'You were not killed this time.' : '')).setVisible(on && (s !== null || review !== null));
    this.why.setText(s?.why ?? '').setVisible(on && s !== null);
    const parts: string[] = [];
    if (yours) for (const sec of reviewSections(yours)) parts.push(sec.title.toUpperCase(), ...sec.lines.map((l) => `   ${l}`), '');
    this.body.setText(parts.join('\n').trim()).setVisible(on && parts.length > 0);
    this.team.setText(review ? teamLine(review) : '').setVisible(on && review !== null);
    const hint = retryHint(o.phase, o.isHost, o.stage);
    this.foot.setText(hint).setVisible(on && hint !== '');
  }

  destroy(): void { for (const o of [this.bg, this.title, this.headline, this.why, this.body, this.team, this.foot]) o.destroy(); }
}
