import Phaser from 'phaser';
import type { DraftPublic } from '@wb/shared';
import { draftHeader, draftLines } from './draftLogic';

const FONT = { fontFamily: 'monospace' } as const;

/** P3F step 4: the draft pick after a cleared stage: 3 cards, keys 1 to 3 vote, the server settles it. */
export class DraftView {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly head: Phaser.GameObjects.Text;
  private readonly body: Phaser.GameObjects.Text;
  private last = '';

  constructor(scene: Phaser.Scene) {
    this.bg = scene.add.rectangle(240, 120, 800, 300, 0x04101a, 0.95).setOrigin(0).setStrokeStyle(2, 0x9dffcb).setDepth(130).setScrollFactor(0).setVisible(false);
    this.head = scene.add.text(260, 134, '', { ...FONT, fontSize: '16px', color: '#9dffcb' }).setDepth(131).setScrollFactor(0).setVisible(false);
    this.body = scene.add.text(260, 170, '', { ...FONT, fontSize: '14px', color: '#d6f3ff', wordWrap: { width: 760 }, lineSpacing: 8 }).setDepth(131).setScrollFactor(0).setVisible(false);
  }

  update(draft: DraftPublic | undefined, myVote: number | null, isHost: boolean): void {
    const show = draft !== undefined;
    this.bg.setVisible(show); this.head.setVisible(show); this.body.setVisible(show);
    if (!draft) { this.last = ''; return; }
    const key = JSON.stringify([draft, myVote, isHost]);
    if (key === this.last) return;
    this.last = key;
    this.head.setText(draftHeader(draft, isHost));
    this.body.setText(draftLines(draft, myVote).map((l) =>
      `${l.picked ? '>>' : '  '} [${l.key}] ${l.title}${l.mine ? '  (your vote)' : ''}   votes: ${l.votes}\n      ${l.text}${l.tradeoff ? `\n      Price: ${l.tradeoff}` : ''}`).join('\n\n'));
  }

  destroy(): void { this.bg.destroy(); this.head.destroy(); this.body.destroy(); }
}
