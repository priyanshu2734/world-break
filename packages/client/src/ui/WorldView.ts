import Phaser from 'phaser';
import { SERVER_TICK_HZ, type GameSnapshot, type Prop } from '@wb/shared';
import { COLOR, FONT } from '../palette';

const ICE = 0x9fe8ff;
/** Rendered position eases toward the latest snapshot (props are server-simulated and are not predicted). */
const SMOOTH_MS = 70;

/** Draws the physical world: props (crates and their copies). Pure presentation; the server owns every outcome. */
export class WorldView {
  private g: Phaser.GameObjects.Graphics;
  private shown = new Map<string, { x: number; y: number }>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private used = new Set<string>();

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(7);
  }

  private label(id: string, text: string, x: number, y: number, color: string) {
    let t = this.labels.get(id);
    if (!t) { t = this.scene.add.text(0, 0, '', { ...FONT, fontSize: '12px', color }).setOrigin(0.5, 1).setDepth(8); this.labels.set(id, t); }
    if (t.text !== text) t.setText(text);
    t.setColor(color).setPosition(x, y).setVisible(true);
    this.used.add(id);
  }

  update(game: GameSnapshot | null, dtMs: number): void {
    const g = this.g;
    g.clear();
    this.used.clear();
    const tick = game?.tick ?? 0;
    const props: readonly Prop[] = game?.world?.props ?? [];
    const k = 1 - Math.exp(-dtMs / SMOOTH_MS);
    const live = new Set<string>();
    for (const p of props) {
      live.add(p.id);
      let s = this.shown.get(p.id);
      if (!s || Math.hypot(s.x - p.x, s.y - p.y) > 200) { s = { x: p.x, y: p.y }; this.shown.set(p.id, s); }
      s.x += (p.x - s.x) * k; s.y += (p.y - s.y) * k;
      const clone = p.cloneOf !== null, frozen = p.frozenUntilTick > tick;
      const col = frozen ? ICE : clone ? COLOR.cyan : COLOR.amber;
      const x = s.x - p.w / 2, y = s.y - p.h;
      g.fillStyle(0x04101a, 1).fillRect(x, y, p.w, p.h);
      g.fillStyle(col, clone ? 0.22 : 0.3).fillRect(x, y, p.w, p.h);
      g.lineStyle(2, col, clone ? 0.7 : 1).strokeRect(x, y, p.w, p.h);
      g.lineStyle(1, col, 0.6).lineBetween(x, y, x + p.w, y + p.h).lineBetween(x + p.w, y, x, y + p.h);
      if (frozen) {
        g.fillStyle(ICE, 0.25).fillRect(x - 3, y - 3, p.w + 6, p.h + 6);
        this.label(`f_${p.id}`, `frozen ${Math.max(0, (p.frozenUntilTick - tick) / SERVER_TICK_HZ).toFixed(1)}s`, s.x, y - 4, '#9fe8ff');
      }
      if (clone && p.expiresTick !== null) {
        const frac = Math.max(0, Math.min(1, (p.expiresTick - tick) / (8 * SERVER_TICK_HZ)));
        g.fillStyle(COLOR.cyan, 0.9).fillRect(x, y - 7, p.w * frac, 3);
        this.label(`c_${p.id}`, 'copy', s.x, y - 10, '#3de8ff');
      }
    }
    for (const id of [...this.shown.keys()]) if (!live.has(id)) this.shown.delete(id);
    for (const [id, t] of this.labels) if (!this.used.has(id)) t.setVisible(false);
  }
}
