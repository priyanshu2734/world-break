import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LobbyScene } from './scenes/LobbyScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#04070d',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, LobbyScene],
});
