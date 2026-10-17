import Phaser from 'phaser';
import { TICK_DT, type StageState } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { conduitMid, interactPrompt } from './targeting';
import { threatFor } from './disasterText';

const TPS = Math.round(1 / TICK_DT);
const GREY = 0x5a6b75;

/** Draws the public stage state over the arena. Pure presentation: nothing here decides an outcome. */
export class StageView {
  private g: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private used = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(5);
  }

  private label(id: string, text: string, x: number, y: number, color = '#d8f6ff') {
    let t = this.labels.get(id);
    if (!t) { t = this.scene.add.text(0, 0, '', { ...FONT, fontSize: '13px', color }).setOrigin(0.5, 1).setDepth(6); this.labels.set(id, t); }
    if (t.text !== text) t.setText(text);
    t.setColor(color).setPosition(x, y).setVisible(true);
    this.used.add(id);
  }

  update(st: StageState, tick: number, me: { x: number; y: number } | null): void {
    const g = this.g, now = this.scene.time.now;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    g.clear();
    this.used.clear();
    const close = (x: number, y: number, r = 170) => !!me && Math.abs(me.x - x) < r && Math.abs(me.y - y) < 120;

    // ---- hazards ----
    for (const h of st.hazards) {
      const flux = h.kind === 'gravity_flux';
      const base = flux ? 0x8a6bff : COLOR.amber;
      g.fillStyle(base, flux ? 0.07 : h.armed ? 0.05 + 0.05 * pulse : 0.02).fillCircle(h.x, h.y, h.r);
      g.lineStyle(flux && h.stabilized ? 3 : 2, flux && h.stabilized ? COLOR.cyan : base, h.armed || flux ? 0.7 : 0.25).strokeCircle(h.x, h.y, h.r);
      if (!flux && h.armed && h.nextPulseTick !== null) {
        const left = h.nextPulseTick - tick;
        if (left <= TPS) { // telegraph: a ring closes in during the last second
          g.lineStyle(4, 0xff4d4d, 0.9).strokeCircle(h.x, h.y, h.r * (left / TPS));
        }
      }
      // P3A: a hazard that belongs to a disaster always carries a visible marker with its warning, even before it is armed
      if (threatFor(st, h.id)) this.label(`thr_${h.id}`, `! ${h.label}${h.armed ? '' : ' (incoming)'}`, h.x, h.y - h.r - 6, h.armed ? '#ff6b6b' : '#ffe27a');
      if (close(h.x, h.y, h.r)) this.label(`h_${h.id}`, `${h.label}${flux ? (h.stabilized ? ' (anchored)' : ' (unstable)') : h.armed ? ' (armed)' : ''}`, h.x, h.y - h.r + 18, flux ? '#b8a6ff' : '#ffb02e');
    }

    // ---- power grid ----
    const node = (id: string) => st.power.nodes.find((n) => n.id === id)!;
    for (const c of st.power.conduits) {
      const a = node(c.from), b = node(c.to);
      const ax = a.x, ay = a.y - 14, bx = b.x, by = b.y - 14;
      const open = c.switchEntityId !== null && !c.closed;
      if (c.condition === 'melted') {
        g.lineStyle(3, 0x7a2222, 0.9).lineBetween(ax, ay, bx, by);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        g.lineStyle(3, 0xff4d4d, 1).lineBetween(mx - 7, my - 7, mx + 7, my + 7).lineBetween(mx - 7, my + 7, mx + 7, my - 7);
      } else if (c.condition === 'damaged') {
        for (let i = 0; i < 12; i += 2) {
          g.lineStyle(3, COLOR.amber, 0.9).lineBetween(ax + (bx - ax) * i / 12, ay + (by - ay) * i / 12, ax + (bx - ax) * (i + 1) / 12, ay + (by - ay) * (i + 1) / 12);
        }
      } else if (c.live) {
        g.lineStyle(7, COLOR.cyan, 0.15).lineBetween(ax, ay, bx, by);
        g.lineStyle(3, COLOR.cyan, 0.95).lineBetween(ax, ay, bx, by);
      } else {
        g.lineStyle(2, open ? GREY : COLOR.cyanDim, open ? 0.5 : 0.8).lineBetween(ax, ay, bx, by);
      }
    }
    for (const n of st.power.nodes) {
      const x = n.x, y = n.y - 14;
      const col = n.source === 'cell' ? COLOR.amber : n.powered ? COLOR.cyan : GREY;
      g.fillStyle(0x04101a, 1);
      if (n.kind === 'generator') { g.fillRect(x - 11, y - 11, 22, 22).lineStyle(3, COLOR.amber, 1).strokeRect(x - 11, y - 11, 22, 22); }
      else if (n.kind === 'junction') { g.fillCircle(x, y, 7).lineStyle(2, col, 1).strokeCircle(x, y, 7); }
      else {
        g.fillCircle(x, y, 11).lineStyle(3, col, 1).strokeCircle(x, y, 11);
        if (n.powered) g.fillStyle(col, 0.3 + 0.2 * pulse).fillCircle(x, y, 8);
      }
      if (close(n.x, n.y)) this.label(`n_${n.id}`, `${n.label}${n.kind === 'consumer' ? (n.source === 'cell' ? ' (cell)' : n.powered ? ' (on)' : ' (no power)') : ''}`, x, y - 16, n.powered ? '#3de8ff' : '#8aa0ab');
    }
    if (st.power.nodes.some((n) => n.kind === 'generator') && me && close(900, 590, 400)) {
      this.label('load', `Load ${st.power.load}/${st.power.capacity}`, 900, 540, st.power.load >= st.power.capacity ? '#ffb02e' : '#8aa0ab');
    }

    // ---- entities ----
    const prompt = me ? interactPrompt(st, me) : null;
    for (const e of st.entities) {
      const x = e.x, top = e.y - 30;
      let col: number = COLOR.cyan, fill = 0.25;
      if (e.kind === 'supply_cache') col = 0x6dffb0;
      else if (e.kind === 'power_switch') { col = e.state === 'closed' ? COLOR.cyan : e.state === 'sealed' ? COLOR.cyanDim : GREY; fill = e.state === 'closed' ? 0.5 : 0.1; }
      else if (e.kind === 'sync_console') { col = e.state === 'armed' ? COLOR.amber : e.state === 'locked' ? COLOR.cyan : e.locked ? GREY : 0xb98a2a; fill = e.state === 'armed' ? 0.5 : 0.15; }
      else if (e.kind === 'core_console') { col = e.state === 'dead' ? 0xff4d4d : e.state === 'channeling' ? 0xffffff : COLOR.cyan; fill = e.state === 'channeling' ? 0.6 : 0.2; }
      else if (e.kind === 'decoy_panel') { col = e.state === 'flickering' ? 0xffe27a : 0x7a8a60; fill = e.state === 'flickering' ? (Math.sin(now / 90) > 0 ? 0.6 : 0.05) : 0.1; }
      const w = e.kind === 'core_console' ? 36 : 24;
      g.fillStyle(0x04101a, 1).fillRect(x - w / 2, top, w, 30);
      g.fillStyle(col, fill).fillRect(x - w / 2, top, w, 30);
      g.lineStyle(2, col, 1).strokeRect(x - w / 2, top, w, 30);
      if (e.state === 'armed' && e.armedUntilTick !== null) {
        const frac = Math.max(0, Math.min(1, (e.armedUntilTick - tick) / 300));
        g.fillStyle(COLOR.amber, 1).fillRect(x - w / 2, top - 7, w * frac, 4);
      }
      if (prompt?.id === e.id) { g.lineStyle(2, 0xffffff, 0.9).strokeRect(x - w / 2 - 4, top - 4, w + 8, 38); this.label(`e_${e.id}`, `[E] ${e.label} (${e.state})`, x, top - 10, '#ffffff'); }
      else if (close(e.x, e.y, 120)) this.label(`e_${e.id}`, e.label, x, top - 10, '#8aa0ab');
    }

    // ---- revealed breakpoints ----
    for (const b of st.breakpoints) {
      const x = b.x, y = b.y - 22;
      const col = b.repaired ? COLOR.cyan : COLOR.amber;
      g.fillStyle(col, b.repaired ? 0.2 : 0.2 + 0.3 * pulse).fillPoints([{ x, y: y - 14 }, { x: x + 12, y }, { x, y: y + 14 }, { x: x - 12, y }], true);
      g.lineStyle(2, col, 1).strokePoints([{ x, y: y - 14 }, { x: x + 12, y }, { x, y: y + 14 }, { x: x - 12, y }], true);
      this.label(`b_${b.id}`, `${b.label}${b.repaired ? ' (repaired)' : ''}`, x, y - 20, b.repaired ? '#3de8ff' : '#ffb02e');
    }

    // ---- effects ----
    for (const f of st.effects) {
      const anchor = f.tool === 'gravity_anchor';
      const col = anchor ? COLOR.cyan : 0xb6ffd9;
      const left = Math.max(0, (f.expiresTick - tick) / (anchor ? 400 : 160));
      g.fillStyle(col, 0.05 + 0.05 * pulse).fillCircle(f.x, f.y - 20, f.r);
      g.lineStyle(2, col, 0.4 + 0.5 * left).strokeCircle(f.x, f.y - 20, f.r);
    }

    // ---- channel progress bars above their targets ----
    const where = (id: string) => {
      const b = st.breakpoints.find((x) => x.id === id) ?? st.entities.find((x) => x.id === id);
      if (b) return { x: b.x, y: b.y };
      const c = st.power.conduits.find((x) => x.id === id);
      return c ? conduitMid(st, c) : null;
    };
    const seen = new Set<string>();
    for (const c of st.channels) {
      if (seen.has(c.targetId)) continue; seen.add(c.targetId);
      const p = where(c.targetId); if (!p) continue;
      g.fillStyle(0x04101a, 0.9).fillRect(p.x - 32, p.y - 78, 64, 8);
      g.fillStyle(COLOR.cyan, 1).fillRect(p.x - 31, p.y - 77, 62 * c.progress, 6);
    }

    for (const [id, t] of this.labels) if (!this.used.has(id)) t.setVisible(false);
  }
}
