import Phaser from 'phaser';
import { ARENA, ESCAPE_LIMITS } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { CodeEntry } from './escapeUse';
import { PAD, padHint, padSlots, padTextWidth } from './padLogic';

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
  /** One box and one digit text per slot (rebuilt on every key), so the typed digits are always shown in their own box. */
  private slotObjs: Phaser.GameObjects.GameObject[] = [];
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
    const cx = W / 2, cy = H / 2 - 40, top = cy - PAD.panelH / 2;
    const panel = this.scene.add.rectangle(cx, cy, PAD.panelW, PAD.panelH, 0x04101a, 0.97).setStrokeStyle(2, COLOR.cyan);
    this.title = this.scene.add.text(cx, top + 30, t.kind === 'keypad' ? 'KEYPAD' : 'SAFE', { ...FONT, fontSize: '22px', color: '#9fe9ff' }).setOrigin(0.5);
    // the hint wraps inside the panel (it used to be one line wider than its box)
    const hint = this.scene.add.text(cx, top + PAD.panelH - 22, padHint(t.length).join('\n'), { ...FONT, fontSize: '14px', color: '#9cc9d4', align: 'center', wordWrap: { width: padTextWidth() }, lineSpacing: 3 }).setOrigin(0.5, 1);
    for (const o of [panel, this.title, hint]) { o.setDepth(D).setScrollFactor(0); this.objs.push(o); }
    this.refresh();
  }

  close(): void {
    for (const o of this.objs) o.destroy();
    for (const o of this.slotObjs) o.destroy();
    this.objs = []; this.slotObjs = []; this.target = null; this.entry = null;
  }

  /** Close when the player has walked away from what they were typing into. */
  update(me: { x: number; y: number } | null): void {
    const t = this.target;
    if (!t) return;
    if (!me || Math.abs(me.x - t.x) > ESCAPE_LIMITS.useRange + 30 || Math.abs(me.y - t.y) > 80) this.close();
  }

  private refresh(): void {
    if (!this.entry || !this.target) return;
    for (const o of this.slotObjs) o.destroy();
    this.slotObjs = [];
    const cx = W / 2, cy = H / 2 - 40 - PAD.panelH / 2 + 112;
    for (const sl of padSlots(this.entry.text, this.entry.length)) {
      const box = this.scene.add.rectangle(cx + sl.x, cy, PAD.slotW, PAD.slotH, sl.filled ? 0x0b2a38 : 0x061722, 1).setStrokeStyle(sl.current ? 3 : 2, sl.current ? COLOR.amber : sl.filled ? COLOR.cyan : 0x35576a);
      const txt = this.scene.add.text(cx + sl.x, cy, sl.char, { ...FONT, fontSize: '48px', color: COLOR.text }).setOrigin(0.5);
      for (const o of [box, txt]) { o.setDepth(121).setScrollFactor(0); this.slotObjs.push(o); }
    }
  }

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
