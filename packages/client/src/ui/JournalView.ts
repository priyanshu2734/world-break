import Phaser from 'phaser';
import type { GhostType } from '@wb/shared';
import { JOURNAL_RULES, journalHeader, journalRows, markCheck, type Journal } from './journalLogic';

const FONT = { fontFamily: 'monospace' } as const;

/** P3F step 3: the team journal, a simple panel (J opens and closes it). Three buttons enter a suspect; the server decides. */
export class JournalView {
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly head: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Text[] = [];
  private readonly buttons: Phaser.GameObjects.Text[] = [];
  private shown = false;
  private journal: Journal | null = null;
  private last = '';

  constructor(private readonly scene: Phaser.Scene, private readonly onMark: (g: GhostType, reason: string | null) => void) {
    const bg = scene.add.rectangle(330, 60, 620, 360, 0x04101a, 0.94).setOrigin(0).setStrokeStyle(1, 0xb9a7ff).setDepth(120).setScrollFactor(0);
    this.head = scene.add.text(344, 70, '', { ...FONT, fontSize: '15px', color: '#d6ccff' }).setDepth(121).setScrollFactor(0);
    const rules = scene.add.text(344, 94, JOURNAL_RULES, { ...FONT, fontSize: '12px', color: '#ffd9a0', wordWrap: { width: 592 } }).setDepth(121).setScrollFactor(0);
    this.parts.push(bg, this.head, rules);
    (['wisp', 'shade', 'howler'] as const).forEach((g, i) => {
      const y = 140 + i * 90;
      this.rows.push(scene.add.text(344, y, '', { ...FONT, fontSize: '12px', color: '#bfe8ff', wordWrap: { width: 470 } }).setDepth(121).setScrollFactor(0));
      const b = scene.add.text(840, y, `[ ${g.toUpperCase()} ]`, { ...FONT, fontSize: '14px', color: '#9dffcb', backgroundColor: '#0b2a36', padding: { x: 6, y: 4 } })
        .setDepth(121).setScrollFactor(0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { const j = this.journal; this.onMark(g, j ? (() => { const c = markCheck(j, g); return c.ok ? null : c.reason; })() : 'No journal here.'); });
      this.buttons.push(b);
    });
    this.parts.push(...this.rows, ...this.buttons);
    this.apply();
  }

  get isOpen(): boolean { return this.shown; }
  toggle(): void { this.shown = !this.shown; this.apply(); }

  /** `journal` undefined = no ghost stage (or a spectator): the panel is closed and empty. */
  update(journal: Journal | undefined): void {
    this.journal = journal ?? null;
    if (!journal && this.shown) { this.shown = false; this.apply(); }
    const key = JSON.stringify(journal ?? null);
    if (key === this.last) return;
    this.last = key;
    if (!journal) return;
    this.head.setText(journalHeader(journal));
    journalRows(journal).forEach((r, i) => {
      const ev = r.evidence.map((e) => `${e.seen ? '[x]' : '[ ]'} ${e.label}`).join('   ');
      this.rows[i]?.setText(`${r.name}${r.marked ? '  (entered)' : ''}\n${ev}\n${r.counter}`);
    });
  }

  private apply(): void { for (const p of this.parts) (p as unknown as { setVisible(v: boolean): unknown }).setVisible(this.shown); }
  destroy(): void { for (const p of this.parts) p.destroy(); }
}
