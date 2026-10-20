import Phaser from 'phaser';
import type { StageState } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { drawShape } from './itemDraw';
import { ITEM_SHAPE, TONE_COLOR, TONE_HEX, itemPrompt, itemTone, needPrompts, stashTone } from './itemView';

type Pt = { x: number; y: number };

/**
 * World markers for salvage: parts (a distinct shape per kind), stashes, carried parts above their carrier, "Needs: ..." lines over
 * discovered targets, and the key prompt for what is in reach. Pure presentation of the public state.
 */
export class ItemMarkers {
  private g: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private used = new Set<string>();
  private prompt: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(7);
    this.prompt = scene.add.text(640, 720 - 170, '', { ...FONT, fontSize: '18px', color: '#ffffff', backgroundColor: '#04101acc' })
      .setOrigin(0.5, 1).setDepth(101).setPadding(10, 4).setVisible(false);
  }

  private label(id: string, text: string, x: number, y: number, color: string, size = '13px') {
    let t = this.labels.get(id);
    if (!t) { t = this.scene.add.text(0, 0, '', { ...FONT, fontSize: size, color }).setOrigin(0.5, 1).setDepth(8); this.labels.set(id, t); }
    if (t.text !== text) t.setText(text);
    t.setColor(color).setPosition(x, y).setVisible(true);
    this.used.add(id);
  }

  /** `where` maps a player id to its rendered position (parts hover above their carrier). */
  update(st: StageState | null, localId: string, me: Pt | null, where: Map<string, Pt>): void {
    const g = this.g;
    g.clear();
    this.used.clear();
    const it = st?.items;
    if (!st || !it) { this.prompt.setVisible(false); for (const t of this.labels.values()) t.setVisible(false); return; }
    const pulse = 0.5 + 0.5 * Math.sin(this.scene.time.now / 240);
    const close = (p: Pt, r = 140) => !!me && Math.abs(me.x - p.x) < r && Math.abs(me.y - p.y) < 90;

    for (const s of it.stashes ?? []) {
      const col = TONE_COLOR[stashTone(s)];
      const w = 26, h = 22, top = s.y - h;
      g.fillStyle(0x04101a, 1).fillRect(s.x - w / 2, top, w, h);
      g.fillStyle(col, s.opened ? 0.08 : 0.2 + 0.2 * pulse).fillRect(s.x - w / 2, top, w, h);
      g.lineStyle(2, col, s.opened ? 0.5 : 1).strokeRect(s.x - w / 2, top, w, h);
      g.lineBetween(s.x - w / 2, top + 6, s.x + w / 2, top + 6); // a lid line: marks "container", not "part"
      if (close(s, 110)) this.label(`stash_${s.id}`, `${s.label}${s.opened ? ' (open)' : ''}`, s.x, top - 4, TONE_HEX[stashTone(s)]);
    }

    for (const i of it.items) {
      let pos: Pt | null = null;
      let s = i.slots === 2 ? 15 : 10;
      if (i.state === 'in_world') pos = { x: i.x, y: i.y - 14 };
      else if (i.state === 'installed') pos = { x: i.x + 16, y: i.y - 52 }; // sits beside the target's own marker
      else if (i.carrierId) { const p = where.get(i.carrierId); if (p) { pos = { x: p.x, y: p.y - 58 - (it.players.find((pl) => pl.id === i.carrierId)?.carried.indexOf(i.id) ?? 0) * 22 }; s = 8; } }
      if (!pos) continue;
      const tone = itemTone(i);
      drawShape(g, ITEM_SHAPE[i.kind], pos.x, pos.y, s, TONE_COLOR[tone], i.state === 'in_world' ? 0.2 + 0.15 * pulse : 0.35);
      if (i.cracked === true && i.state !== 'installed') g.lineStyle(2, COLOR.danger, 1).lineBetween(pos.x - s, pos.y - s, pos.x + s, pos.y + s); // crack stroke: red AND a shape cue
      if (i.state === 'in_world' && close(i, 100)) this.label(`item_${i.id}`, `${i.label}${i.cracked === true ? ' (cracked)' : ''}`, pos.x, pos.y - s - 4, TONE_HEX[tone]);
    }

    for (const n of needPrompts(st)) {
      const col = n.satisfied ? TONE_HEX.green : TONE_HEX.amber;
      const y = n.y - 92;
      this.label(`need_${n.targetId}`, n.text, n.x, y, col);
      if (n.hint && close(n, 260)) this.label(`needhint_${n.targetId}`, n.hint, n.x, y - 16, '#9fb6c2', '12px');
    }

    const line = me ? itemPrompt(st, localId, me) : null;
    this.prompt.setVisible(!!line);
    if (line) this.prompt.setText(line);
    for (const [id, t] of this.labels) if (!this.used.has(id)) t.setVisible(false);
  }
}
