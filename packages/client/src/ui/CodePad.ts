import Phaser from 'phaser';
import { ARENA, ESCAPE_LIMITS } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { CodeEntry } from './escapeUse';

const W = ARENA.width, H = ARENA.height;

export interface PadTarget { id: string; kind: 'keypad' | 'safe'; length: number; x: number; y: number }

/**
 * P3D step 3: the small panel for typing a keypad code or a safe combination. Digits 0-9 type, Backspace erases, Enter tries,
 * Esc closes. It closes by itself when the player walks out of reach. The server decides whether the code is right; this only types.
 */
export class CodePad {
  private target: PadTarget | null = null;
  private entry: CodeEntry | null = null;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private title!: Phaser.GameObjects.Text;
  private slots!: Phaser.GameObjects.Text;
  private onKey = (ev: KeyboardEvent): void => this.handle(ev);

  constructor(private scene: Phaser.Scene, private submit: (target: PadTarget, code: string) => void) {
    scene.input.keyboard!.on('keydown', this.onKey);
    scene.events.once('shutdown', () => this.destroy());
  }

  get isOpen(): boolean { return this.target !== null; }

  open(t: PadTarget): void {
    this.close();
    this.target = t; this.entry = new CodeEntry(t.length);
    const D = 120;
    const panel = this.scene.add.rectangle(W / 2, H / 2 - 40, 380, 190, 0x04101a, 0.96).setStrokeStyle(2, COLOR.cyan);
    this.title = this.scene.add.text(W / 2, H / 2 - 110, t.kind === 'keypad' ? 'KEYPAD' : 'SAFE', { ...FONT, fontSize: '22px', color: '#9fe9ff' }).setOrigin(0.5);
    this.slots = this.scene.add.text(W / 2, H / 2 - 60, '', { ...FONT, fontSize: '40px', color: COLOR.text }).setOrigin(0.5);
    const hint = this.scene.add.text(W / 2, H / 2 - 4, `type ${t.length} digits   Enter: try   Backspace: erase   Esc: close`, { ...FONT, fontSize: '13px', color: '#7fb6c2' }).setOrigin(0.5);
    for (const o of [panel, this.title, this.slots, hint]) { o.setDepth(D).setScrollFactor(0); this.objs.push(o); }
    this.refresh();
  }

  close(): void {
    for (const o of this.objs) o.destroy();
    this.objs = []; this.target = null; this.entry = null;
  }

  /** Close when the player has walked away from what they were typing into. */
  update(me: { x: number; y: number } | null): void {
    const t = this.target;
    if (!t) return;
    if (!me || Math.abs(me.x - t.x) > ESCAPE_LIMITS.useRange + 30 || Math.abs(me.y - t.y) > 80) this.close();
  }

  private refresh(): void { if (this.entry) this.slots.setText(this.entry.display()); }

  private handle(ev: KeyboardEvent): void {
    if (!this.target || !this.entry) return;
    if (ev.key >= '0' && ev.key <= '9' && ev.key.length === 1) this.entry.push(ev.key);
    else if (ev.key === 'Backspace') this.entry.back();
    else if (ev.key === 'Escape') { this.close(); return; }
    else if (ev.key === 'Enter') {
      if (this.entry.complete) { const t = this.target, code = this.entry.text; this.entry.clear(); this.submit(t, code); }
    } else return;
    this.refresh();
  }

  destroy(): void {
    this.scene.input.keyboard?.off('keydown', this.onKey);
    this.close();
  }
}
