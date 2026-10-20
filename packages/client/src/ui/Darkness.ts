import Phaser from 'phaser';
import { ARENA } from '@wb/shared';
import { COLOR, FONT } from '../palette';
import { AMBIENT_STEP, LIGHT, aimAngle, clampAmbient, darkParams, effectiveAmbient, type DarkParams } from './darkParam';

const W = ARENA.width, H = ARENA.height;
const DEPTH = 50; // above the world (<= 10) and below the HUD (>= 100)
const TEX_RADIUS = 'dark_light_radius';
const TEX_CONE = 'dark_light_cone';

/**
 * P3D step 1: a client-only dark layer. A full-screen black render texture is drawn over the world; each frame the
 * radius light and the flashlight cone are ERASED from it, so only what they touch is visible. HUD stays above it.
 * This is presentation only: it hides nothing from a modified client (server-side visibility is step 4).
 */
export class Darkness {
  private rt: Phaser.GameObjects.RenderTexture;
  private radiusImg: Phaser.GameObjects.Image;
  private coneImg: Phaser.GameObjects.Image;
  /** Faint warm additive copies of the lights, drawn under the dark layer so lit areas look lit, not just uncovered. */
  private radiusGlow: Phaser.GameObjects.Image;
  private coneGlow: Phaser.GameObjects.Image;
  private status: Phaser.GameObjects.Text;
  private params: DarkParams;
  private keys: Record<'B' | 'OPEN_BRACKET' | 'CLOSED_BRACKET', Phaser.Input.Keyboard.Key>;

  /** Returns null (and creates nothing) unless the URL has ?dark=1. */
  static create(scene: Phaser.Scene, search: string): Darkness | null {
    const p = darkParams(search);
    return p.enabled ? new Darkness(scene, p) : null;
  }

  private constructor(private scene: Phaser.Scene, params: DarkParams) {
    this.params = { ...params };
    Darkness.makeTextures(scene);
    this.rt = scene.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(DEPTH);
    this.radiusImg = scene.make.image({ key: TEX_RADIUS, add: false }).setOrigin(0.5);
    this.coneImg = scene.make.image({ key: TEX_CONE, add: false }).setOrigin(0, 0.5);
    const glow = (key: string, ox: number) => scene.add.image(0, 0, key).setOrigin(ox, 0.5).setDepth(DEPTH - 1)
      .setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd9a0).setAlpha(0.16).setVisible(false);
    this.radiusGlow = glow(TEX_RADIUS, 0.5); this.coneGlow = glow(TEX_CONE, 0);
    this.status = scene.add.text(16, H - 14, '', { ...FONT, fontSize: '14px', color: '#9fb6c2', backgroundColor: '#04101acc' })
      .setOrigin(0, 1).setDepth(DEPTH + 60).setPadding(8, 3);
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('B,OPEN_BRACKET,CLOSED_BRACKET') as typeof this.keys;
  }

  /** Soft-edged light textures, drawn once with the 2D canvas API (no assets). */
  private static makeTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(TEX_RADIUS)) {
      const r = LIGHT.radius, t = scene.textures.createCanvas(TEX_RADIUS, r * 2, r * 2)!;
      const c = t.getContext();
      const g = c.createRadialGradient(r, r, r * 0.15, r, r, r);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, r * 2, r * 2);
      t.refresh();
    }
    if (!scene.textures.exists(TEX_CONE)) {
      const L = LIGHT.coneLength, half = LIGHT.coneAngle / 2, h = Math.ceil(Math.sin(half) * L) * 2 + 4;
      const t = scene.textures.createCanvas(TEX_CONE, L, h)!;
      const c = t.getContext();
      // the beam points along +x from the left-middle edge; brightness falls off with distance
      const g = c.createRadialGradient(0, h / 2, 10, 0, h / 2, L);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, h / 2); c.arc(0, h / 2, L, -half, half); c.closePath(); c.fill();
      t.refresh();
    }
  }

  get ambient(): number { return effectiveAmbient(this.params.ambient, this.params.assist); }
  get assist(): boolean { return this.params.assist; }

  /** `me` is the local player's feet position; null (no snapshot yet, or the stage is not running) shows a plain dark screen. */
  update(me: { x: number; y: number } | null, pointer: { x: number; y: number } | null, facing: 1 | -1): void {
    const J = Phaser.Input.Keyboard.JustDown;
    if (J(this.keys.B)) this.params.assist = !this.params.assist;
    if (J(this.keys.OPEN_BRACKET)) this.params.ambient = clampAmbient(this.params.ambient - AMBIENT_STEP);
    if (J(this.keys.CLOSED_BRACKET)) this.params.ambient = clampAmbient(this.params.ambient + AMBIENT_STEP);

    const amb = this.ambient;
    this.rt.clear();
    this.rt.fill(0x000000, 1 - amb);
    this.radiusGlow.setVisible(false); this.coneGlow.setVisible(false);
    if (me) {
      const cx = me.x, cy = me.y - 28; // chest height
      const ang = aimAngle(me, pointer, facing);
      this.coneImg.setRotation(ang);
      this.radiusGlow.setPosition(cx, cy).setVisible(true);
      this.coneGlow.setPosition(cx, cy).setRotation(ang).setVisible(true);
      this.rt.erase(this.radiusImg, cx, cy);
      this.rt.erase(this.coneImg, cx, cy);
    }
    this.status.setText(`DARK  ambient ${(amb * 100).toFixed(0)}%${this.params.assist ? '  (assist ON)' : ''}   [B] assist  [ ] ambient`);
  }

  destroy(): void {
    this.rt.destroy(); this.radiusImg.destroy(); this.coneImg.destroy(); this.radiusGlow.destroy(); this.coneGlow.destroy(); this.status.destroy();
  }
}

