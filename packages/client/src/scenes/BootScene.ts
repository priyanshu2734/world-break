import Phaser from 'phaser';
import { COLOR } from '../palette';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create(): void {
    // Procedurally generated textures: no external assets required.
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
    g.generateTexture('spark', 8, 8);
    g.clear();
    g.fillStyle(COLOR.cyan, 1).fillTriangle(0, 0, 64, 20, 18, 70);
    g.generateTexture('shard', 64, 70);
    g.destroy();
    this.scene.start('Lobby');
  }
}
