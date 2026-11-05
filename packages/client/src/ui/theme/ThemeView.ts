import Phaser from 'phaser';
import type { Arena, ThemeId } from '@wb/shared';
import { themeLook } from '@wb/shared';
import { drawPrims } from './drawPrims';
import { roomDecor } from './themeLogic';

const DEPTH_WASH = -6.5, DEPTH_PROPS = -6; // behind the platforms (-5), the world art (6), the players (10) and every hazard

/**
 * P3F step 5: the background of the room under its theme: a faint wash and the procedural props. Purely decoration: it reads no rule and no physics, sits behind everything
 * the player must react to, is hidden in the dark view (nothing decorative outside the light), and is drawn once per (theme, room, setting), never every frame.
 */
export class ThemeView {
  private wash: Phaser.GameObjects.Rectangle | null = null;
  private props: Phaser.GameObjects.Graphics | null = null;
  private key = '';
  private visible = true;
  constructor(private scene: Phaser.Scene) {}

  set(theme: ThemeId | undefined, roomId: string | undefined, seed: number, arena: Arena, o: { reducedMotion: boolean; assist: boolean }): void {
    const key = theme === undefined ? '' : JSON.stringify([theme, roomId, seed, arena.id, o.assist]);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (theme === undefined) return;
    const floor = arena.solids.reduce((best, s) => (s.w > best.w ? s : best), arena.solids[0] ?? { x: 0, y: arena.height - 40, w: 0, h: 40 });
    const look = themeLook(theme, o);
    const d = roomDecor(theme, roomId ?? arena.id, seed, { w: arena.width, h: arena.height, floorY: floor.y }, look);
    this.wash = this.scene.add.rectangle(0, 0, arena.width, arena.height, d.wash.color, d.wash.alpha).setOrigin(0).setDepth(DEPTH_WASH).setVisible(this.visible);
    this.props = this.scene.add.graphics().setDepth(DEPTH_PROPS).setVisible(this.visible);
    drawPrims(this.props, d.props);
  }

  /** The dark view shows nothing decorative. */
  setVisible(v: boolean): void { this.visible = v; this.wash?.setVisible(v); this.props?.setVisible(v); }

  private clear(): void { this.wash?.destroy(); this.props?.destroy(); this.wash = null; this.props = null; }
  destroy(): void { this.clear(); this.key = ''; }
}
