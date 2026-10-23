import Phaser from 'phaser';
import { ARENA, type Arena } from '@wb/shared';
import { FONT } from '../palette';
import {
  ASSIST, AMBIENT_STEP, LIGHT, aimAngle, clampAmbient, conePolygon, effectiveAmbient, lightGeometry, type DarkSettings, type LightGeometry,
} from './darkParam';

const W = ARENA.width, H = ARENA.height;
const DEPTH = 50; // above the world (<= 10) and below the HUD (>= 100)
const TEX_RADIUS = 'dark_light_radius';
const TEX_CONE = 'dark_light_cone';
const STORE_KEY = 'wb_assist';
/** World objects drawn between these depths (stage markers, item markers, props and their labels) only show inside the player's light. */
const MASK_MIN_DEPTH = 5, MASK_MAX_DEPTH = 9;

export interface DarkFrame {
  /** The local player's feet position, or null while no stage is running (a plain dark screen). */
  me: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
  facing: 1 | -1;
  /** Ambient brightness outside the light (0..1), from the stage and mode. Ignored only by the dev keys. */
  ambient: number;
  /** Camera scroll (world pixels at the screen's top-left). The dark layer is screen-fixed; lights are placed in screen space. Default 0,0. */
  scroll?: { x: number; y: number };
  /** The stage's vision radius in px (shared `visionRadius`); the flashlight reaches exactly this far. Default: the reference reach. */
  reach?: number;
}

/**
 * A client-side dark layer. A black render texture covers the world; the radius light and the flashlight cone are ERASED from it.
 * Objects at depth 5 to 9 (stage and item markers, props, their labels) are additionally clipped to the light with a geometry mask,
 * so they are not visible outside it at any ambient level. The HUD stays above the layer.
 *
 * Ambient comes from the stage and mode and is the same for everyone. The accessibility assist (V) only improves what is inside the
 * light. The old spike keys (B, [ ]) exist only with `?dark=1&dev=1`.
 * This is presentation only; what a modified client can learn is decided by the server (P3D step 4).
 */
export class Darkness {
  private rt: Phaser.GameObjects.RenderTexture;
  private radiusImg: Phaser.GameObjects.Image;
  private coneImg: Phaser.GameObjects.Image;
  private radiusGlow: Phaser.GameObjects.Image;
  private coneGlow: Phaser.GameObjects.Image;
  private outlines: Phaser.GameObjects.Graphics;
  private maskGfx: Phaser.GameObjects.Graphics;
  private mask: Phaser.Display.Masks.GeometryMask;
  private status: Phaser.GameObjects.Text;
  private masked = new Set<Phaser.GameObjects.GameObject>();
  private labelState = new Map<Phaser.GameObjects.Text, boolean>();
  private arena: Arena = ARENA;
  private outlinesFor = '';
  private assistOn: boolean;
  private devFull = false;
  private devAmbient: number | null;
  private keys: Record<'V' | 'B' | 'OPEN_BRACKET' | 'CLOSED_BRACKET', Phaser.Input.Keyboard.Key>;
  /** Geometry of the light drawn this frame (null with no player). Exposed for tests and the debug hook. */
  geometry: LightGeometry | null = null;
  /** The ambient actually drawn last frame. */
  drawnAmbient = 0;

  constructor(private scene: Phaser.Scene, private settings: DarkSettings) {
    Darkness.makeTextures(scene);
    this.assistOn = settings.assist || Darkness.stored();
    this.devAmbient = settings.ambientOverride;
    this.rt = scene.add.renderTexture(0, 0, W, H).setOrigin(0).setDepth(DEPTH).setScrollFactor(0);
    this.radiusImg = scene.make.image({ key: TEX_RADIUS, add: false }).setOrigin(0.5);
    this.coneImg = scene.make.image({ key: TEX_CONE, add: false }).setOrigin(0, 0.5);
    const glow = (key: string, ox: number) => scene.add.image(0, 0, key).setOrigin(ox, 0.5).setDepth(DEPTH - 1)
      .setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd9a0).setAlpha(ASSIST.baseGlowAlpha).setVisible(false);
    this.radiusGlow = glow(TEX_RADIUS, 0.5); this.coneGlow = glow(TEX_CONE, 0);
    this.outlines = scene.add.graphics().setDepth(6.5);
    this.maskGfx = new Phaser.GameObjects.Graphics(scene);
    this.mask = new Phaser.Display.Masks.GeometryMask(scene, this.maskGfx);
    this.status = scene.add.text(16, H - 14, '', { ...FONT, fontSize: '14px', color: '#9fb6c2', backgroundColor: '#04101acc' })
      .setOrigin(0, 1).setDepth(DEPTH + 60).setScrollFactor(0).setPadding(8, 3).setVisible(settings.dev);
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys('V,B,OPEN_BRACKET,CLOSED_BRACKET') as typeof this.keys;
  }

  private static stored(): boolean {
    try { return window.localStorage.getItem(STORE_KEY) === '1'; } catch { return false; }
  }
  private static store(on: boolean): void {
    try { window.localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable: the setting just lasts for this page */ }
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
      const g = c.createRadialGradient(0, h / 2, 10, 0, h / 2, L);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, h / 2); c.arc(0, h / 2, L, -half, half); c.closePath(); c.fill();
      t.refresh();
    }
  }

  get assist(): boolean { return this.assistOn; }

  setArena(arena: Arena): void { this.arena = arena; this.outlinesFor = ''; }

  update(f: DarkFrame): void {
    const J = Phaser.Input.Keyboard.JustDown;
    if (J(this.keys.V)) { this.assistOn = !this.assistOn; Darkness.store(this.assistOn); }
    if (this.settings.dev) {
      if (J(this.keys.B)) this.devFull = !this.devFull;
      if (J(this.keys.OPEN_BRACKET)) this.devAmbient = clampAmbient((this.devAmbient ?? f.ambient) - AMBIENT_STEP);
      if (J(this.keys.CLOSED_BRACKET)) this.devAmbient = clampAmbient((this.devAmbient ?? f.ambient) + AMBIENT_STEP);
    }
    // The ONLY ways the ambient changes: the stage value, and (dev flag only) the old spike keys.
    const amb = this.settings.dev ? effectiveAmbient(this.devAmbient ?? f.ambient, this.devFull) : clampAmbient(f.ambient);
    this.drawnAmbient = amb;

    this.rt.clear();
    this.rt.fill(0x000000, 1 - amb);
    this.radiusGlow.setVisible(false); this.coneGlow.setVisible(false);
    this.maskGfx.clear();
    this.geometry = null;
    const sc = f.scroll ?? { x: 0, y: 0 };
    if (f.me) {
      const ang = aimAngle(f.me, f.pointer, f.facing);
      const reachK = (f.reach ?? LIGHT.coneLength) / LIGHT.coneLength;
      const g = lightGeometry(f.me, ang, this.assistOn, f.reach);
      this.geometry = g;
      const k = (this.assistOn ? ASSIST.lightScale : 1) * reachK;
      this.radiusImg.setScale(k); this.coneImg.setScale(f.reach !== undefined ? Math.min(k, reachK) : k).setRotation(ang);
      const sx = g.cx - sc.x, sy = g.cy - sc.y; // screen space (the layer does not scroll)
      this.rt.erase(this.radiusImg, sx, sy);
      this.rt.erase(this.coneImg, sx, sy);
      const a = this.assistOn ? ASSIST.glowAlpha : ASSIST.baseGlowAlpha;
      this.radiusGlow.setPosition(sx, sy).setScale(k).setAlpha(a).setVisible(true);
      this.coneGlow.setPosition(sx, sy).setScale(f.reach !== undefined ? Math.min(k, reachK) : k).setRotation(ang).setAlpha(a).setVisible(true);
      this.maskGfx.fillStyle(0xffffff, 1).fillCircle(g.cx, g.cy, g.radius * 0.88).fillPoints(conePolygon(g), true);
    }
    this.drawOutlines();
    this.applyMaskAndLabels();
    this.status.setText(`DARK dev  ambient ${(amb * 100).toFixed(0)}%${this.devFull ? '  (full bright)' : ''}${this.assistOn ? '  assist' : ''}   [B] bright  [ ] ambient  [V] assist`);
  }

  /** Assist: white outlines on the platforms. They live at depth 6.5, so the light mask clips them to what is already in view. */
  private drawOutlines(): void {
    const key = `${this.arena.id}|${this.assistOn}`;
    if (key === this.outlinesFor) return;
    this.outlinesFor = key;
    this.outlines.clear();
    if (!this.assistOn) return;
    this.outlines.lineStyle(2, 0xffffff, 0.9);
    for (const r of this.arena.solids) this.outlines.strokeRect(r.x, r.y, r.w, r.h);
  }

  /** Clip world objects to the light, and (assist) enlarge and outline their labels. Objects are created lazily, so this runs each frame. */
  private applyMaskAndLabels(): void {
    const want = this.assistOn;
    for (const o of this.scene.children.list) {
      const d = (o as Phaser.GameObjects.GameObject & { depth: number }).depth;
      if (d < MASK_MIN_DEPTH || d > MASK_MAX_DEPTH) continue;
      if (!this.masked.has(o)) { (o as Phaser.GameObjects.Graphics).setMask(this.mask); this.masked.add(o); }
      if (o instanceof Phaser.GameObjects.Text && this.labelState.get(o) !== want) {
        this.labelState.set(o, want);
        o.setScale(want ? ASSIST.labelScale : 1).setStroke('#000000', want ? ASSIST.labelStroke : 0);
      }
    }
  }

  destroy(): void {
    for (const o of this.masked) if (o.active) (o as Phaser.GameObjects.Graphics).clearMask();
    for (const [t, on] of this.labelState) if (on && t.active) t.setScale(1).setStroke('#000000', 0);
    this.masked.clear(); this.labelState.clear();
    this.mask.destroy();
    for (const o of [this.rt, this.radiusImg, this.coneImg, this.radiusGlow, this.coneGlow, this.outlines, this.maskGfx, this.status]) o.destroy();
  }
}
