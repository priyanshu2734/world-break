import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { LobbyScene } from './scenes/LobbyScene';
import { GameScene } from './scenes/GameScene';

new Phaser.Game({
  // `?renderer=canvas` forces the 2D canvas renderer (useful on machines without usable WebGL, and for headless tests).
  type: new URLSearchParams(window.location.search).get('renderer') === 'canvas' ? Phaser.CANVAS : Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: '#04070d',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, LobbyScene, GameScene],
});
