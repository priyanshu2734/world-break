import Phaser from 'phaser';
import type { RoomLayout } from '@wb/shared';
import { COLOR, FONT } from '../palette';

type Doorway = RoomLayout['doors'][number];

/**
 * P3D step 2: draws the doorways of the room the player is in. Depth 6 puts them inside the dark view's light mask, so in a dark
 * room a door is seen only when the player's light reaches it. With lock state (step 3): green when open, red when locked.
 */
export class DoorView {
  private art: Phaser.GameObjects.GameObject[] = [];
  private key = '';
  constructor(private scene: Phaser.Scene) {}

  /** Redraw only when the doorway set changes. */
  set(doors: readonly Doorway[], state?: ReadonlyMap<string, boolean>): void {
    // three states: open, locked, or unknown (the server only tells you a door's state while you can see it)
    const known = (id: string) => state?.has(id) === true;
    const open = (id: string) => state?.get(id) === true;
    const key = doors.map((d) => `${d.id}:${d.x},${d.y},${d.w},${d.h}:${known(d.id) ? (open(d.id) ? 1 : 0) : 2}`).join('|');
    if (key === this.key) return;
    this.key = key;
    for (const o of this.art) o.destroy();
    this.art = [];
    if (doors.length === 0) return;
    const g = this.scene.add.graphics().setDepth(6);
    this.art.push(g);
    for (const d of doors) {
      g.fillStyle(0x061622, 1).fillRect(d.x, d.y, d.w, d.h);
      // colour language: green = open, red = locked, cyan = a doorway whose state you cannot see
      const c = !known(d.id) ? COLOR.cyan : open(d.id) ? COLOR.green : COLOR.danger;
      g.lineStyle(3, c, 0.9).strokeRect(d.x, d.y, d.w, d.h);
      g.lineStyle(1, c, 0.35).lineBetween(d.x + d.w / 2, d.y + 6, d.x + d.w / 2, d.y + d.h - 6);
      this.art.push(this.scene.add.text(d.x + d.w / 2, d.y - 6, 'DOOR', { ...FONT, fontSize: '12px', color: !known(d.id) ? '#9fe9ff' : open(d.id) ? '#9dffcb' : '#ff9a9a' }).setOrigin(0.5, 1).setDepth(6));
    }
  }

  destroy(): void { for (const o of this.art) o.destroy(); this.art = []; this.key = ''; }
}
