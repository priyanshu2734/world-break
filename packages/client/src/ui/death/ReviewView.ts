import Phaser from 'phaser';
import type { DeathReviewMsg, RoomPhase } from '@wb/shared';
import { FONT } from '../../palette';
import { retryHint, reviewSections, showReview, teamLine, wipeHeadline } from './reviewLogic';

const W = 1280, H = 720;

/** P4 step 4: the wipe banner and the death review. It draws only what the server sent in `death:review` and the room phase; it decides nothing. */
export class ReviewView {
  private dim: Phaser.GameObjects.Rectangle;
  private head: Phaser.GameObjects.Text;
  private body: Phaser.GameObjects.Text;
  private foot: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.dim = scene.add.rectangle(W / 2, H / 2, W, H, 0x02060a, 0.72).setDepth(120).setScrollFactor(0).setVisible(false);
    this.head = scene.add.text(W / 2, 54, '', { ...FONT, fontSize: '30px', color: '#ff8c8c' }).setOrigin(0.5, 0).setDepth(121).setScrollFactor(0).setVisible(false);
    this.body = scene.add.text(120, 120, '', { ...FONT, fontSize: '17px', color: '#dbe9f6', wordWrap: { width: W - 240 }, lineSpacing: 4 }).setDepth(121).setScrollFactor(0).setVisible(false);
    this.foot = scene.add.text(W / 2, H - 56, '', { ...FONT, fontSize: '20px', color: '#9ff0b0' }).setOrigin(0.5, 1).setDepth(121).setScrollFactor(0).setVisible(false);
  }

  update(o: { phase: RoomPhase | undefined; review: DeathReviewMsg | null; isHost: boolean; stage: number | undefined }): void {
    const head = wipeHeadline(o.phase, o.review);
    const on = head !== '';
    this.dim.setVisible(on);
    this.head.setText(head).setVisible(on);
    const review = showReview(o.phase) ? o.review : null;
    let text = '';
    if (review) {
      const parts: string[] = [teamLine(review), ''];
      if (review.yours) for (const s of reviewSections(review.yours)) parts.push(s.title.toUpperCase(), ...s.lines.map((l) => `   ${l}`), '');
      else parts.push('You were not killed this time.', '');
      text = parts.join('\n');
    }
    this.body.setText(text).setVisible(text !== '');
    const hint = retryHint(o.phase, o.isHost, o.stage);
    this.foot.setText(hint).setVisible(hint !== '');
  }

  destroy(): void { this.dim.destroy(); this.head.destroy(); this.body.destroy(); this.foot.destroy(); }
}
