import Phaser from 'phaser';
import { ARENA, type EscapePublic } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { usePrompt, type EscapeUse } from './escapeUse';

const W = ARENA.width, H = ARENA.height;

/**
 * P3D step 3: draws the keypads, safes, clues, switches and the exit of the room the player is in, the prompt for what E would do,
 * and the player's own notes (clue text they have read). World art sits at depth 6, inside the dark view's light mask, so in a
 * dark room each object is seen only when the player's light reaches it. Colour language: cyan = interactive, amber = clue,
 * green = done or open, red = locked.
 */
export class EscapeView {
  private art: Phaser.GameObjects.GameObject[] = [];
  private key = '';
  private prompt: Phaser.GameObjects.Text;
  private notesBg: Phaser.GameObjects.Rectangle;
  private notesText: Phaser.GameObjects.Text;
  private notesShown = '';

  constructor(private scene: Phaser.Scene) {
    this.prompt = scene.add.text(W / 2, H - 150, '', { ...FONT, fontSize: '20px', color: COLOR.text, backgroundColor: '#04101acc' })
      .setOrigin(0.5).setPadding(12, 6).setDepth(101).setScrollFactor(0).setVisible(false);
    this.notesBg = scene.add.rectangle(16, 160, 300, 40, 0x04101a, 0.85).setOrigin(0).setStrokeStyle(1, COLOR.amberDim).setDepth(100).setScrollFactor(0).setVisible(false);
    this.notesText = scene.add.text(26, 168, '', { ...FONT, fontSize: '14px', color: '#ffd9a0', wordWrap: { width: 282 } }).setDepth(101).setScrollFactor(0).setVisible(false);
  }

  /** `es` undefined = not an escape stage: everything hidden. */
  update(room: string | undefined, es: EscapePublic | undefined, tick: number, nearest: EscapeUse | null, canUse: boolean, notes: readonly { id: string; text: string }[]): void {
    this.drawWorld(room, es, tick);
    const p = es && canUse && nearest ? usePrompt(nearest, tick) : null;
    this.prompt.setVisible(p !== null).setText(p ?? '');
    this.drawNotes(es !== undefined ? notes : []);
  }

  private drawWorld(room: string | undefined, es: EscapePublic | undefined, tick: number): void {
    const mine = es && room !== undefined ? {
      keypads: es.keypads.filter((k) => k.room === room), safes: es.safes.filter((s) => s.room === room),
      clues: es.clues.filter((c) => c.room === room), switches: es.switches.filter((s) => s.room === room),
      exit: es.exit.room === room ? es.exit : null,
    } : null;
    const lockedOut = (t: number | null) => t !== null && t > tick;
    const key = mine ? JSON.stringify([room, mine.keypads.map((k) => [k.id, k.solved, lockedOut(k.lockedUntilTick)]), mine.safes.map((s) => [s.id, s.opened, lockedOut(s.lockedUntilTick)]), mine.clues.map((c) => c.id), mine.switches.map((s) => [s.id, s.active]), mine.exit?.x ?? null]) : '';
    if (key === this.key) return;
    this.key = key;
    for (const o of this.art) o.destroy();
    this.art = [];
    if (!mine) return;
    const g = this.scene.add.graphics().setDepth(6);
    this.art.push(g);
    const label = (x: number, y: number, text: string, color: string) =>
      this.art.push(this.scene.add.text(x, y, text, { ...FONT, fontSize: '12px', color }).setOrigin(0.5, 1).setDepth(6));
    for (const k of mine.keypads) {
      const c = k.solved ? COLOR.green : lockedOut(k.lockedUntilTick) ? COLOR.danger : COLOR.cyan;
      g.fillStyle(0x061622, 1).fillRect(k.x - 12, k.y - 64, 24, 36).lineStyle(2, c, 0.95).strokeRect(k.x - 12, k.y - 64, 24, 36);
      g.fillStyle(c, 0.8).fillRect(k.x - 8, k.y - 60, 16, 7);
      for (let i = 0; i < 6; i++) g.fillStyle(c, 0.5).fillRect(k.x - 8 + (i % 3) * 6, k.y - 49 + Math.floor(i / 3) * 8, 4, 5);
      g.lineStyle(2, COLOR.cyanDim, 1).lineBetween(k.x, k.y - 28, k.x, k.y);
      label(k.x, k.y - 68, 'KEYPAD', '#9fe9ff');
    }
    for (const s of mine.safes) {
      const c = s.opened ? COLOR.green : lockedOut(s.lockedUntilTick) ? COLOR.danger : COLOR.amber;
      g.fillStyle(0x16100a, 1).fillRect(s.x - 24, s.y - 50, 48, 50).lineStyle(3, c, 0.95).strokeRect(s.x - 24, s.y - 50, 48, 50);
      g.lineStyle(2, c, 0.8).strokeCircle(s.x, s.y - 26, 11).lineBetween(s.x, s.y - 26, s.x + (s.opened ? -9 : 7), s.y - 26 - (s.opened ? 0 : 8));
      label(s.x, s.y - 54, s.opened ? 'SAFE (open)' : 'SAFE', s.opened ? '#9dffcb' : '#ffd9a0');
    }
    for (const c of mine.clues) {
      g.fillStyle(0x2a2012, 1).fillRect(c.x - 9, c.y - 24, 18, 24).lineStyle(2, COLOR.amber, 0.95).strokeRect(c.x - 9, c.y - 24, 18, 24);
      for (let i = 0; i < 3; i++) g.lineStyle(1, COLOR.amber, 0.6).lineBetween(c.x - 5, c.y - 18 + i * 6, c.x + 5, c.y - 18 + i * 6);
      label(c.x, c.y - 28, c.label, '#ffd9a0');
    }
    for (const s of mine.switches) {
      const c = s.active ? COLOR.green : COLOR.cyan;
      g.fillStyle(0x061622, 1).fillRect(s.x - 16, s.y - 12, 32, 12).lineStyle(2, c, 0.95).strokeRect(s.x - 16, s.y - 12, 32, 12);
      g.fillStyle(c, s.active ? 0.95 : 0.35).fillRect(s.x - 10, s.y - 20, 20, 8);
      label(s.x, s.y - 24, 'SWITCH', s.active ? '#9dffcb' : '#9fe9ff');
    }
    if (mine.exit) {
      const e = mine.exit;
      g.fillStyle(0x07201a, 1).fillRect(e.x - 30, e.y - 100, 60, 100).lineStyle(3, COLOR.green, 0.95).strokeRect(e.x - 30, e.y - 100, 60, 100);
      g.fillStyle(COLOR.green, 0.18).fillRect(e.x - 24, e.y - 94, 48, 94);
      label(e.x, e.y - 104, 'EXIT', '#9dffcb');
    }
  }

  private drawNotes(notes: readonly { id: string; text: string }[]): void {
    const text = notes.map((n) => `- ${n.text}`).join('\n');
    if (text === this.notesShown) return;
    this.notesShown = text;
    const show = notes.length > 0;
    this.notesText.setVisible(show).setText(`NOTES\n${text}`);
    this.notesBg.setVisible(show).setSize(300, this.notesText.height + 16);
  }

  destroy(): void {
    for (const o of this.art) o.destroy();
    this.art = [];
    this.prompt.destroy(); this.notesBg.destroy(); this.notesText.destroy();
  }
}
