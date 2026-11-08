import Phaser from 'phaser';
import { PING_KINDS, PING_LABELS, type PingKind, type PingRequest, type TeamPanel } from '@wb/shared';
import { COLOR } from '../../palette';
import {
  CHAT_MAX, ChatLog, QGesture, WHEEL, journalLine, needsPoint, panelRows, pingRequest, placeMarker, pruneMarkers, slotAngle, wheelSlot,
  type LiveMarker, type Rect,
} from './teamLogic';

const FONT = { fontFamily: 'monospace' } as const;
const SLOT_COLOURS = [0x3de8ff, 0xffb02e, 0x6dffb0, 0xc58bff] as const;
const KIND_COLOUR: Readonly<Record<PingKind, number>> = { key: 0xffd35a, danger: 0xff4d4d, help: 0xff9a3d, door: 0xb0b8c4, ghost: 0xb9a7ff, go: 0x6dffb0, hide: 0x7fd6ff };

export interface TeamFrame {
  now: number;
  /** Q is held (only ever true for a living player on an escape stage). */
  qDown: boolean;
  canPing: boolean;
  /** Pointer: screen position and world position. */
  pointer: { x: number; y: number; worldX: number; worldY: number };
  panel: TeamPanel | null;
  markers: readonly LiveMarker[];
  chat: ChatLog;
  selfId: string;
  /** The camera's view of the world (for edge arrows). */
  view: Rect;
}
export interface TeamHandlers {
  onPing(req: PingRequest): void;
  onChat(text: string): void;
  onMute(id: string): void;
  onNotice(text: string): void;
}

/**
 * P6 A: draws the team panel (Tab), the ping wheel (hold Q), the ping markers and the chat (Enter), and reads the chat box. It only asks:
 * a ping is a request the server checks against the pinger's own view; a chat line is cleaned and limited by the server.
 * The panel doubles as a picker: click a kind, then click the world (for the kinds that point at something).
 */
export class TeamView {
  private readonly gesture = new QGesture();
  private panelOpen = false;
  private armed: PingKind | null = null;
  private anchor: { sx: number; sy: number; wx: number; wy: number } | null = null;
  private chatBox: HTMLInputElement | null = null;
  private lastPanelKey = '';
  private readonly panelParts: Phaser.GameObjects.GameObject[] = [];
  private readonly rowTexts: Phaser.GameObjects.Text[] = [];
  private readonly muteBtns: Phaser.GameObjects.Text[] = [];
  private readonly kindBtns: Phaser.GameObjects.Text[] = [];
  private readonly head: Phaser.GameObjects.Text;
  private readonly journal: Phaser.GameObjects.Text;
  private readonly armedText: Phaser.GameObjects.Text;
  private readonly chatText: Phaser.GameObjects.Text;
  private readonly toastText: Phaser.GameObjects.Text;
  private readonly wheel: Phaser.GameObjects.Graphics;
  private readonly wheelLabels: Phaser.GameObjects.Text[] = [];
  private readonly marks: Phaser.GameObjects.Graphics;
  private readonly markText: Phaser.GameObjects.Text[] = [];
  private rowIds: string[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly h: TeamHandlers) {
    const bg = scene.add.rectangle(10, 60, 360, 330, 0x04101a, 0.94).setOrigin(0).setStrokeStyle(1, COLOR.cyan).setDepth(122).setScrollFactor(0);
    this.head = scene.add.text(22, 68, 'TEAM', { ...FONT, fontSize: '15px', color: '#9dffcb' }).setDepth(123).setScrollFactor(0);
    this.journal = scene.add.text(22, 90, '', { ...FONT, fontSize: '12px', color: '#d6ccff' }).setDepth(123).setScrollFactor(0);
    this.panelParts.push(bg, this.head, this.journal);
    for (let i = 0; i < 4; i++) {
      const y = 114 + i * 26;
      const t = scene.add.text(22, y, '', { ...FONT, fontSize: '13px', color: COLOR.text }).setDepth(123).setScrollFactor(0);
      const m = scene.add.text(300, y, '[mute]', { ...FONT, fontSize: '12px', color: '#ffd9a0', backgroundColor: '#1a1530', padding: { x: 4, y: 2 } })
        .setDepth(123).setScrollFactor(0).setInteractive({ useHandCursor: true });
      m.on('pointerdown', () => { const id = this.rowIds[i]; if (id) this.h.onMute(id); });
      this.rowTexts.push(t); this.muteBtns.push(m); this.panelParts.push(t, m);
    }
    this.panelParts.push(scene.add.text(22, 224, 'PING (click one, then click the world)', { ...FONT, fontSize: '12px', color: '#9aa7b0' }).setDepth(123).setScrollFactor(0));
    PING_KINDS.forEach((k, i) => {
      const b = scene.add.text(22 + (i % 2) * 168, 244 + Math.floor(i / 2) * 28, PING_LABELS[k], { ...FONT, fontSize: '13px', color: '#d8f6ff', backgroundColor: '#0b2a36', padding: { x: 6, y: 3 } })
        .setDepth(123).setScrollFactor(0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => this.pick(k));
      this.kindBtns.push(b); this.panelParts.push(b);
    });
    this.armedText = scene.add.text(22, 360, '', { ...FONT, fontSize: '12px', color: '#ffb02e' }).setDepth(123).setScrollFactor(0);
    this.chatText = scene.add.text(22, 376, '', { ...FONT, fontSize: '11px', color: '#bfe8ff', wordWrap: { width: 336 } }).setDepth(123).setScrollFactor(0).setVisible(false);
    this.panelParts.push(this.armedText);
    this.toastText = scene.add.text(16, 640, '', { ...FONT, fontSize: '13px', color: '#d8f6ff', backgroundColor: '#04101acc', padding: { x: 6, y: 4 }, wordWrap: { width: 460 } })
      .setOrigin(0, 1).setDepth(118).setScrollFactor(0).setVisible(false);
    this.wheel = scene.add.graphics().setDepth(125).setScrollFactor(0);
    PING_KINDS.forEach((k) => this.wheelLabels.push(scene.add.text(0, 0, PING_LABELS[k], { ...FONT, fontSize: '12px', color: '#d8f6ff', backgroundColor: '#04101acc', padding: { x: 4, y: 2 } }).setOrigin(0.5).setDepth(126).setScrollFactor(0).setVisible(false)));
    this.marks = scene.add.graphics().setDepth(40);
    for (let i = 0; i < 12; i++) this.markText.push(scene.add.text(0, 0, '', { ...FONT, fontSize: '12px', color: '#ffffff', backgroundColor: '#04101acc', padding: { x: 3, y: 1 } }).setOrigin(0.5, 1).setDepth(41).setVisible(false));
    this.applyPanel();
  }

  get isOpen(): boolean { return this.panelOpen; }
  /** True while the chat box has the keyboard: the scene must not read the game keys. */
  get typing(): boolean { return this.chatBox !== null; }
  /** True while a world click would place the armed ping (the scene's own pointer handlers should not also act). */
  get hasArmed(): boolean { return this.armed !== null; }
  toggle(): void { this.panelOpen = !this.panelOpen; if (!this.panelOpen) this.armed = null; this.applyPanel(); }
  close(): void { this.panelOpen = false; this.armed = null; this.applyPanel(); }

  private pick(kind: PingKind): void {
    if (needsPoint(kind)) { this.armed = kind; this.armedText.setText(`${PING_LABELS[kind]}: click where (Esc cancels)`); return; }
    const req = pingRequest(kind, null);
    if (req) this.h.onPing(req);
    this.armed = null; this.armedText.setText('');
  }

  /** A click on the world while a point ping is armed. Returns true when it was used (the panel's own buttons are screen objects and never reach here). */
  worldClick(worldX: number, worldY: number): boolean {
    if (!this.armed) return false;
    const req = pingRequest(this.armed, { x: worldX, y: worldY });
    this.armed = null; this.armedText.setText('');
    if (req) this.h.onPing(req);
    return true;
  }

  cancel(): void { this.armed = null; this.anchor = null; this.gesture.reset(); this.armedText.setText(''); }

  // ---------------------------------------------------------------- chat box (a DOM input: typing never reaches the game keys)
  openChat(): void {
    if (this.chatBox) return;
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = CHAT_MAX; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'Say something to the team (Enter sends, Esc closes)';
    Object.assign(input.style, { position: 'fixed', left: '50%', bottom: '44px', transform: 'translateX(-50%)', width: 'min(560px, 90vw)', font: '14px monospace', padding: '6px 10px', background: '#04101a', color: '#d8f6ff', border: '1px solid #3de8ff', zIndex: '10', outline: 'none' });
    // the game listens on the window: stop every key event here so typing 'e' or 'q' is only ever typing
    const stop = (e: KeyboardEvent) => e.stopPropagation();
    input.addEventListener('keyup', stop); input.addEventListener('keypress', stop);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = input.value; this.closeChat(); if (t.trim() !== '') this.h.onChat(t); }
      else if (e.key === 'Escape') this.closeChat();
    });
    document.body.appendChild(input);
    this.chatBox = input;
    this.scene.input.keyboard!.enabled = false; // the game keys sleep while the box is open
    this.scene.input.keyboard!.resetKeys();
    input.focus();
  }
  closeChat(): void {
    const b = this.chatBox;
    if (!b) return;
    this.chatBox = null;
    b.remove();
    if (this.scene.input.keyboard) this.scene.input.keyboard.enabled = true;
  }

  // ---------------------------------------------------------------- per frame
  /** Draws everything. Returns what the Q key did this frame (`tap` = the old Q, cancel). */
  frame(f: TeamFrame): { tap: boolean } {
    const ev = f.canPing ? this.gesture.step(f.qDown, f.now) : (this.gesture.reset(), 'none' as const);
    if (ev === 'open') this.anchor = { sx: f.pointer.x, sy: f.pointer.y, wx: f.pointer.worldX, wy: f.pointer.worldY };
    if (ev === 'select' && this.anchor) {
      const k = wheelSlot(f.pointer.x - this.anchor.sx, f.pointer.y - this.anchor.sy);
      if (k) { const req = pingRequest(k, { x: this.anchor.wx, y: this.anchor.wy }); if (req) this.h.onPing(req); }
      this.anchor = null;
    }
    if (!this.gesture.isOpen) this.anchor = null;
    this.drawWheel(f);
    this.drawMarkers(f);
    this.drawPanel(f);
    this.drawToasts(f);
    return { tap: ev === 'tap' };
  }

  private drawWheel(f: TeamFrame): void {
    const g = this.wheel; g.clear();
    const a = this.anchor, on = this.gesture.isOpen && a !== null;
    this.wheelLabels.forEach((l) => l.setVisible(on));
    if (!on || !a) return;
    const pick = wheelSlot(f.pointer.x - a.sx, f.pointer.y - a.sy);
    g.fillStyle(0x04101a, 0.55).fillCircle(a.sx, a.sy, WHEEL.radius + 26);
    g.lineStyle(2, COLOR.cyan, 0.9).strokeCircle(a.sx, a.sy, WHEEL.deadzone);
    PING_KINDS.forEach((k, i) => {
      const ang = slotAngle(i), x = a.sx + Math.cos(ang) * WHEEL.radius, y = a.sy + Math.sin(ang) * WHEEL.radius;
      g.fillStyle(KIND_COLOUR[k], k === pick ? 0.95 : 0.35).fillCircle(x, y, k === pick ? 16 : 11);
      this.wheelLabels[i]!.setPosition(x, y + (Math.sin(ang) >= 0 ? 28 : -28)).setAlpha(k === pick ? 1 : 0.7);
    });
    g.fillStyle(0xffffff, 0.9).fillCircle(f.pointer.x, f.pointer.y, 3);
  }

  private drawMarkers(f: TeamFrame): void {
    const g = this.marks; g.clear();
    const live = pruneMarkers(f.markers, f.now);
    let t = 0;
    for (const l of live) {
      const d = placeMarker(l, f.now, f.view);
      if (!d) continue;
      const col = KIND_COLOUR[l.marker.kind], who = SLOT_COLOURS[l.marker.slot % SLOT_COLOURS.length]!;
      if (d.mode === 'world') {
        g.lineStyle(3, col, d.alpha).strokeCircle(d.x, d.y, 16);
        g.fillStyle(who, d.alpha * 0.8).fillCircle(d.x, d.y, 5);
      } else if (d.mode === 'edge') {
        const sz = 12, x = d.x, y = d.y, c = Math.cos(d.angle), s = Math.sin(d.angle);
        g.fillStyle(col, d.alpha).fillTriangle(x + c * sz, y + s * sz, x - c * sz - s * sz * 0.7, y - s * sz + c * sz * 0.7, x - c * sz + s * sz * 0.7, y - s * sz - c * sz * 0.7);
      }
      const txt = this.markText[t++];
      if (!txt) continue;
      if (d.mode === 'room') txt.setPosition(f.view.x + f.view.w / 2, f.view.y + 40 + (t - 1) * 18).setOrigin(0.5, 0);
      else txt.setPosition(d.x, d.y - 22).setOrigin(0.5, 1);
      txt.setText(d.label).setAlpha(d.alpha).setColor(d.mode === 'room' ? '#ffd9a0' : '#ffffff').setVisible(true);
    }
    for (; t < this.markText.length; t++) this.markText[t]!.setVisible(false);
  }

  private drawPanel(f: TeamFrame): void {
    const rows = panelRows(f.panel, f.selfId, f.chat.mutedIds);
    const key = JSON.stringify([rows, journalLine(f.panel), f.chat.recent(6).map((l) => l.msg.id), this.armed]);
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    this.rowIds = rows.map((r) => r.id);
    this.journal.setText(journalLine(f.panel) ?? '');
    this.rowTexts.forEach((t, i) => {
      const r = rows[i];
      t.setText(r ? r.text : '').setAlpha(r && r.state === 'disconnected' ? 0.5 : 1);
      this.muteBtns[i]!.setVisible(this.panelOpen && !!r && r.canMute).setText(r?.muted ? '[unmute]' : '[mute]');
    });
    const recent = f.chat.recent(6).map((l) => `${l.msg.spectator ? '(dead) ' : ''}${l.msg.name}: ${l.msg.text}`);
    this.chatText.setText(recent.join('\n')).setVisible(this.panelOpen);
    this.armedText.setText(this.armed ? `${PING_LABELS[this.armed]}: click where (Esc cancels)` : '');
  }

  private drawToasts(f: TeamFrame): void {
    const t = f.chat.toasts(f.now);
    if (t.length === 0 || this.panelOpen) { this.toastText.setVisible(false); return; }
    this.toastText.setVisible(true).setAlpha(Math.max(...t.map((x) => x.alpha)))
      .setText(t.map((x) => `${x.line.msg.spectator ? '(dead) ' : ''}${x.line.msg.name}: ${x.line.msg.text}`).join('\n'));
  }

  private applyPanel(): void {
    for (const p of this.panelParts) (p as unknown as { setVisible(v: boolean): unknown }).setVisible(this.panelOpen);
    this.chatText.setVisible(this.panelOpen);
    if (this.panelOpen) for (const b of this.muteBtns) b.setVisible(false); // drawPanel shows the right ones
    this.lastPanelKey = '';
  }

  destroy(): void {
    this.closeChat();
    for (const p of this.panelParts) p.destroy();
    for (const o of [this.chatText, this.toastText, this.wheel, this.marks, ...this.wheelLabels, ...this.markText]) o.destroy();
  }
}
