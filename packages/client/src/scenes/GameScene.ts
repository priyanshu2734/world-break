import Phaser from 'phaser';
import { ARENA, getArena, PLAYER_HEIGHT, PLAYER_WIDTH, visionRadius, quantiseAim, type ActiveAbilityId, type GamePlayer, type InputIntent, type StageAction } from '@wb/shared';
import type { Session } from '../net/session';
import { INTERP_DELAY_MS } from '../net/interpolation';
import { LocalPredictor } from '../sim/prediction';
import { COLOR, FONT, SLOT_COLORS, SLOT_HEX } from '../palette';
import { StageView } from '../ui/StageView';
import { StageHud } from '../ui/StageHud';
import { AbilityHud } from '../ui/AbilityHud';
import { WorldView } from '../ui/WorldView';
import { buildAbilityAction } from '../ui/abilityView';
import { TOOL_KEYS, nearestInteractable, targetForTool } from '../ui/targeting';
import { ItemHud } from '../ui/ItemHud';
import { ItemMarkers } from '../ui/ItemMarkers';
import { Darkness } from '../ui/Darkness';
import { DoorView } from '../ui/DoorView';
import { EscapeView } from '../ui/EscapeView';
import { CodePad } from '../ui/CodePad';
import { ESCAPE_KEYS_HINT, goalLine, nearestUse, stateForRoom, takesCode, useIntent, usablesIn, type EscapeUse } from '../ui/escapeUse';
import { cameraScroll, pickArena } from '../ui/roomMath';
import { aimAngle as aimOf, darkSettings, resolveAmbient, type DarkSettings } from '../ui/darkParam';
import { carriedItems, carryChanges, dropIntent, handoverIntent, installIntent, itemPrompt, pickIntent, type ItemIntent } from '../ui/itemView';
import { GhostAudio } from '../ui/ghost/GhostAudio';
import { GhostView } from '../ui/ghost/GhostView';
import { SoundScheduler } from '../ui/ghost/soundScheduler';
import { cueIndicator } from '../ui/ghost/cueMath';
import { lightScale } from '../ui/ghost/flicker';
import { ghostFlags } from '../ui/ghost/ghostParam';

/** P3E: Shift = sneak. The move axis is scaled to this before it is predicted and sent, so prediction and server see the same value
 *  (it lies in the server's "sneak" gait band, 0.01 to 0.4, which is quiet). */
const SNEAK_AXIS = 0.35;
const W = ARENA.width, H = ARENA.height;
const RESET_HOLD_MS = 1000;
/** Rendered while no stage state has arrived yet (keeps the overlay code free of null checks). */
const EMPTY_STAGE = {
  rev: 0, stageId: '', name: '', status: 'running', tick: 0, deadlineTick: 0, expired: false, score: { total: 0, breakdown: {} },
  objectives: [], symptoms: [], breakpoints: [], entities: [], power: { capacity: 1, load: 0, nodes: [], conduits: [] },
  hazards: [], effects: [], channels: [], players: [], clues: [], feed: [],
} as import('@wb/shared').StageState;

interface PlayerView {
  box: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  visor: Phaser.GameObjects.Rectangle;
  glow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  marker: Phaser.GameObjects.Text;
}

/** Renders server snapshots and sends input intents. Holds no authoritative game logic. */
export class GameScene extends Phaser.Scene {
  private session!: Session;
  private predictor!: LocalPredictor;
  private views = new Map<string, PlayerView>();
  private keys!: Record<'W' | 'A' | 'D' | 'SPACE' | 'R', Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private lastSerial = -1;
  private lastEpoch = 0;
  private resetHeld = 0;
  private stageView!: StageView;
  private stageHud!: StageHud;
  private abilityHud!: AbilityHud;
  private itemHud!: ItemHud;
  private itemMarkers!: ItemMarkers;
  /** P3D: the dark view. Created when the URL has ?dark=1 or the stage publishes `darkness`; removed when neither holds. */
  private darkness: Darkness | null = null;
  private darkCfg: DarkSettings = darkSettings('');
  /** Backdrop decorations (shards, the amber fracture). Hidden while the view is dark. */
  private decor: Phaser.GameObjects.GameObject[] = [];
  private solidsDark = false;
  /** P3D rooms: doorways of the current room. */
  private doors!: DoorView;
  /** P3D escape stages: keypads, safes, clues, switches, the exit, the E prompt and the player's notes. */
  private escapeView!: EscapeView;
  private pad!: CodePad;
  /** What E would act on this frame (null = nothing in reach). */
  private escapeNearest: EscapeUse | null = null;
  private notesStage = -1;
  private layoutSeenSeq = 0;
  private readonly defaultHint = 'A/D move  W/Space jump  E use/pick up  1-5 tools  6-9 abilities (mouse aims, Shift = alt)  Q cancel  hold R reset (host)';
  private prevItems: import('@wb/shared').ItemsPublic | undefined;
  /** Rendered feet position of every player this frame (parts hover above their carrier; hand-overs pick the nearest teammate). */
  private where = new Map<string, { x: number; y: number }>();
  private worldView!: WorldView;
  private abilityKeys!: Record<'SIX' | 'SEVEN' | 'EIGHT' | 'NINE' | 'SHIFT', Phaser.Input.Keyboard.Key>;
  private pointerSeen = false;
  /** P3B: the arena currently drawn and predicted against (a stage may play on its own, e.g. the Ability Lab). */
  private arena: import('@wb/shared').Arena = ARENA;
  private arenaId = ARENA.id;
  private solidsArt: Phaser.GameObjects.GameObject[] = [];
  private stageKeys!: Record<'E' | 'Q' | 'N' | 'G' | 'F' | 'H' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE', Phaser.Input.Keyboard.Key>;
  /** Dev-only scripted movement override (set through __WB_DEBUG__ by the browser verification script). */
  private debugInput: InputIntent | null = null;
  /** Real wall-clock time of the previous frame. Phaser's `delta` is smoothed/clamped, so it is NOT used for simulation. */
  private lastFrameAt = 0;
  /** P3E: ghost look and sound. Sound needs a user gesture before the browser lets it play (armed on the first key or click). */
  private ghostView!: GhostView;
  private ghostAudio!: GhostAudio;
  private sounds = new SoundScheduler();
  private ghostFlags = ghostFlags('');
  private cueText!: Phaser.GameObjects.Text;
  private muteKey!: Phaser.Input.Keyboard.Key;

  private hudRows: { swatch: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text; dot: Phaser.GameObjects.Arc }[] = [];
  private hudStage!: Phaser.GameObjects.Text;
  private hudRoom!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private bannerSub!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Rectangle;
  private toast!: Phaser.GameObjects.Text;
  private holdBar!: Phaser.GameObjects.Rectangle;
  private lost!: Phaser.GameObjects.Text;

  constructor() { super('Game'); }

  init(data: { session?: Session }): void {
    if (data.session) this.session = data.session;
  }

  create(): void {
    if (!this.session) { this.scene.start('Lobby'); return; }
    this.predictor = new LocalPredictor((seq, input) => this.session.sendInput(seq, input));
    this.drawWorld();
    this.buildHud();

    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,D,SPACE,R') as typeof this.keys;
    this.stageKeys = kb.addKeys('E,Q,N,G,F,H,ONE,TWO,THREE,FOUR,FIVE') as typeof this.stageKeys;
    this.stageView = new StageView(this);
    this.stageHud = new StageHud(this);
    this.abilityHud = new AbilityHud(this);
    this.itemHud = new ItemHud(this);
    this.itemMarkers = new ItemMarkers(this);
    this.worldView = new WorldView(this);
    this.darkCfg = darkSettings(window.location.search);
    this.doors = new DoorView(this);
    this.escapeView = new EscapeView(this);
    this.events.once('shutdown', () => this.escapeView.destroy());
    this.pad = new CodePad(this, (t, code) => { void this.session.escapeAction({ action: 'enter_code', targetId: t.id, code }); });
    this.events.once('shutdown', () => this.doors.destroy());
    this.events.once('shutdown', () => { this.darkness?.destroy(); this.darkness = null; });
    this.abilityKeys = kb.addKeys('SIX,SEVEN,EIGHT,NINE,SHIFT') as typeof this.abilityKeys;
    this.input.on('pointermove', () => { this.pointerSeen = true; });
    const onBlur = () => kb.resetKeys(); // never leave a key "stuck down" after alt-tab
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.events.once('shutdown', () => this.game.events.off(Phaser.Core.Events.BLUR, onBlur));

    // P3E: ghost look and sound
    this.ghostFlags = ghostFlags(window.location.search);
    this.ghostView = new GhostView(this);
    this.ghostAudio = new GhostAudio(this.ghostFlags.muted);
    this.muteKey = kb.addKey('M');
    this.cueText = this.add.text(W / 2, H - 44, '', { ...FONT, fontSize: '18px', color: '#cfe8ff', backgroundColor: '#04101acc' })
      .setOrigin(0.5, 1).setDepth(105).setPadding(10, 4).setVisible(false);
    const arm = () => this.ghostAudio.arm();
    this.input.on('pointerdown', arm);
    kb.on('keydown', arm);
    this.events.once('shutdown', () => { this.input.off('pointerdown', arm); kb.off('keydown', arm); this.ghostView.destroy(); this.ghostAudio.destroy(); });

    this.exposeDebug();
  }

  // ---------------------------------------------------------------- world art
  private drawWorld(): void {
    const bg = this.add.graphics().setDepth(-10);
    bg.fillGradientStyle(0x061424, 0x04070d, 0x1a1006, 0x04070d, 1, 1, 1, 1);
    bg.fillRect(0, 0, W, H);

    // drifting shards give depth
    for (let i = 0; i < 18; i++) {
      const s = this.add.image(Math.random() * W, Math.random() * H, 'shard').setDepth(-9)
        .setScale(0.5 + Math.random() * 2).setAlpha(0.04 + Math.random() * 0.1)
        .setTint(Math.random() < 0.25 ? COLOR.amber : COLOR.cyan).setAngle(Math.random() * 360);
      this.decor.push(s);
      this.tweens.add({ targets: s, y: s.y + 40, angle: s.angle + 25, duration: 6000 + Math.random() * 5000,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    // the one memorable element: a pulsing amber fracture splitting reality behind the arena
    const crack = [[-20, 120], [180, 230], [150, 300], [420, 380], [380, 430], [640, 470], [610, 540], [880, 600], [850, 650], [1300, 740]];
    const glow = this.add.graphics().setDepth(-8).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.add.graphics().setDepth(-7);
    const path = (g: Phaser.GameObjects.Graphics, w: number, c: number, a: number) => {
      g.lineStyle(w, c, a).beginPath().moveTo(crack[0]![0]!, crack[0]![1]!);
      for (const [x, y] of crack.slice(1)) g.lineTo(x!, y!);
      g.strokePath();
    };
    this.decor.push(glow, core);
    path(glow, 22, COLOR.amber, 0.12); path(glow, 8, COLOR.amber, 0.25); path(core, 2, 0xfff1c9, 0.9);
    this.tweens.add({ targets: glow, alpha: 0.45, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.drawSolids();
  }

  /** Platforms of the current arena. Redrawn when the server switches arena or the view turns dark. */
  private drawSolids(): void {
    for (const o of this.solidsArt) o.destroy();
    this.solidsArt = [];
    const arena = this.arena;
    const dark = this.solidsDark;
    const g = this.add.graphics().setDepth(-5);
    this.solidsArt.push(g);
    for (const r of arena.solids) {
      g.fillStyle(0x0a1822, 1).fillRect(r.x, r.y, r.w, r.h);
      if (dark) continue; // dark view: plain slabs, no grid lines or warning strip (nothing decorative outside the light)
      g.lineStyle(1, COLOR.cyanDim, 0.55);
      for (let x = r.x + 40; x < r.x + r.w; x += 40) g.lineBetween(x, r.y + 4, x, r.y + r.h);
      g.fillStyle(COLOR.amberDim, 0.9).fillRect(r.x, r.y + r.h - 2, r.w, 2); // underside warning strip
    }
    const edge = this.add.graphics().setDepth(-4).setBlendMode(Phaser.BlendModes.ADD);
    this.solidsArt.push(edge);
    for (const r of arena.solids) {
      if (dark) { edge.lineStyle(2, COLOR.cyan, 0.5).lineBetween(r.x, r.y, r.x + r.w, r.y); continue; } // steady, no glow, no pulse
      edge.lineStyle(8, COLOR.cyan, 0.12).lineBetween(r.x, r.y, r.x + r.w, r.y);
      edge.lineStyle(2, COLOR.cyan, 0.95).lineBetween(r.x, r.y, r.x + r.w, r.y);
    }
    if (!dark) this.tweens.add({ targets: edge, alpha: 0.6, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** P3D: switch the dark view on or off as the URL flag and the stage's published `darkness` dictate. */
  private syncDarkness(wantDark: boolean): void {
    if (wantDark === (this.darkness !== null)) return;
    if (wantDark) {
      this.darkness = new Darkness(this, this.darkCfg);
      this.darkness.setArena(this.arena);
    } else {
      this.darkness?.destroy();
      this.darkness = null;
    }
    for (const d of this.decor) (d as unknown as { setVisible(v: boolean): void }).setVisible(!wantDark);
    this.solidsDark = wantDark;
    this.drawSolids();
  }

  // ---------------------------------------------------------------- HUD
  private buildHud(): void {
    const D = 100;
    const panel = this.add.rectangle(16, 16, 300, 20 + 4 * 28, 0x04101a, 0.72).setOrigin(0).setDepth(D)
      .setStrokeStyle(1, COLOR.cyanDim);
    void panel;
    for (let i = 0; i < 4; i++) {
      const y = 38 + i * 28;
      const swatch = this.add.rectangle(34, y, 12, 12, SLOT_COLORS[i]).setDepth(D);
      const text = this.add.text(50, y, '', { ...FONT, fontSize: '16px', color: COLOR.text }).setOrigin(0, 0.5).setDepth(D);
      const dot = this.add.circle(298, y, 5, COLOR.cyan).setDepth(D);
      this.hudRows.push({ swatch, text, dot });
    }
    this.hudStage = this.add.text(W / 2, 22, '', { ...FONT, fontSize: '22px', color: '#ffb02e' }).setOrigin(0.5, 0).setDepth(D);
    this.hudRoom = this.add.text(W - 16, 18, '', { ...FONT, fontSize: '15px', color: COLOR.text }).setOrigin(1, 0).setDepth(D);
    this.hint = this.add.text(W / 2, H - 14, this.defaultHint,
      { ...FONT, fontSize: '14px', color: '#5f8da0' }).setOrigin(0.5, 1).setDepth(D);

    this.bannerBg = this.add.rectangle(W / 2, H / 2 - 40, W, 170, 0x020509, 0.78).setDepth(D + 1);
    this.banner = this.add.text(W / 2, H / 2 - 70, '', { ...FONT, fontSize: '64px', color: '#3de8ff' })
      .setOrigin(0.5).setDepth(D + 2).setShadow(0, 0, '#3de8ff', 20, true, true);
    this.bannerSub = this.add.text(W / 2, H / 2 - 12, '', { ...FONT, fontSize: '24px', color: '#ffb02e' }).setOrigin(0.5).setDepth(D + 2);
    this.toast = this.add.text(W / 2, 80, '', { ...FONT, fontSize: '20px', color: '#fff1c9' }).setOrigin(0.5).setDepth(D).setAlpha(0);
    this.holdBar = this.add.rectangle(W / 2 - 100, H - 44, 0, 6, COLOR.amber).setOrigin(0, 0.5).setDepth(D);
    this.lost = this.add.text(W / 2, H / 2, 'Connection lost. Reload the page to rejoin.',
      { ...FONT, fontSize: '28px', color: '#ff4d4d', backgroundColor: '#020509' }).setOrigin(0.5).setDepth(D + 5).setPadding(18).setVisible(false);
  }

  private formatTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------- entities
  private ensureView(p: GamePlayer): PlayerView {
    let v = this.views.get(p.id);
    if (v) return v;
    const color = SLOT_COLORS[p.slot] ?? COLOR.cyan;
    const glow = this.add.image(0, 0, 'spark').setScale(9).setTint(color).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD);
    const body = this.add.rectangle(0, 0, PLAYER_WIDTH, PLAYER_HEIGHT, color).setStrokeStyle(2, 0xffffff, 0.8);
    const visor = this.add.rectangle(6, -10, 14, 7, 0x04070d);
    const label = this.add.text(0, -PLAYER_HEIGHT / 2 - 14, p.name, { ...FONT, fontSize: '14px', color: SLOT_HEX[p.slot] ?? '#fff' }).setOrigin(0.5);
    const marker = this.add.text(0, -PLAYER_HEIGHT / 2 - 32, '', { ...FONT, fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    const box = this.add.container(0, 0, [glow, body, visor, label, marker]).setDepth(10);
    v = { box, body, visor, glow, label, marker };
    this.views.set(p.id, v);
    return v;
  }

  private readInput(): InputIntent {
    if (this.debugInput) return this.debugInput;
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const jump = this.cursors.up.isDown || this.keys.W.isDown || this.keys.SPACE.isDown;
    const axis = (right ? 1 : 0) - (left ? 1 : 0);
    return { moveX: this.sneaking() ? axis * SNEAK_AXIS : axis, jump };
  }

  /** Shift sneaks on an escape stage only (on the other stages Shift keeps its old meaning as the ability modifier and nothing else). */
  private sneaking(): boolean { return !!this.session.stage?.escape && this.abilityKeys.SHIFT.isDown; }

  // ---------------------------------------------------------------- frame
  override update(): void {
    const frameNow = performance.now();
    const delta = this.lastFrameAt === 0 ? 0 : frameNow - this.lastFrameAt;
    this.lastFrameAt = frameNow;
    const s = this.session;
    const g = s.game, room = s.snapshot;
    this.lost.setVisible(!s.connected); // the session clears its snapshots when the socket drops
    if (!g || !room) { this.bannerBg.setVisible(false); this.banner.setVisible(false); this.bannerSub.setVisible(false); return; }

    const me = g.players.find((p) => p.id === s.playerId);

    // --- P3B/P3D: the arena the local player is simulated in. The server may switch arena between stages (the Ability Lab), and on a
    //     multi-room stage each player is in one room, whose layout the server sent to this player only. Unknown yet = wait, do not guess. ---
    const myRoom = me?.roomId;
    if (this.layoutSeenSeq !== s.layoutSeq) { // a door just moved the player (a gate moves them within one room): predict afresh from the server's position
      this.layoutSeenSeq = s.layoutSeq;
      if (myRoom !== undefined) this.predictor.stop();
    }
    const wantArena = pickArena(myRoom, g.arenaId, s.layouts);
    if (wantArena && wantArena.id !== this.arenaId) {
      this.arenaId = wantArena.id;
      this.arena = wantArena;
      this.predictor.setArena(this.arena);
      if (myRoom !== undefined) this.predictor.stop(); // a door moved the body: start prediction afresh from the server's position
      this.drawSolids();
      this.darkness?.setArena(this.arena);
    }
    const es = s.stage?.escape;
    this.doors.set(myRoom !== undefined ? s.layouts.get(myRoom)?.doors ?? [] : [], es ? new Map(es.doors.map((d) => [d.id, d.open])) : undefined);
    // Stage content lives in the start room on a plain multi-room stage; on an escape stage every room has its own (filtered by room below).
    const contentHere = myRoom === undefined || myRoom === g.arenaId || es !== undefined;
    if (this.notesStage !== g.stage) { this.notesStage = g.stage; s.notes.length = 0; } // clues are per stage

    // --- local prediction ---
    if (g.phase === 'playing' && me && me.connected && wantArena) {
      const ctx = { tick: g.tick, playerId: s.playerId, world: contentHere ? g.world : undefined }; // P3B: the same zones/impulses the server steps with
      if (!this.predictor.active) { this.predictor.start(me, g.epoch, ctx); this.lastSerial = s.gameSerial; }
      if (s.gameSerial !== this.lastSerial) { this.lastSerial = s.gameSerial; this.predictor.reconcile(me, g.epoch, ctx); }
      const ptr0 = this.input.activePointer;
      this.session.inputExtra = {
        aim: quantiseAim(aimOf(me, this.pointerSeen ? { x: ptr0.worldX, y: ptr0.worldY } : null, me.facing)),
        sneak: this.sneaking(),
      };
      this.predictor.advance(delta, this.readInput());
    } else {
      this.predictor.stop();
      this.lastSerial = s.gameSerial;
    }

    // --- reset toast ---
    if (g.epoch !== this.lastEpoch) { this.lastEpoch = g.epoch; this.flash(g.phase === 'briefing' ? `Stage ${g.stage}` : 'Arena reset to its initial state'); }

    // --- hold R to reset (host only; server re-validates) ---
    const isHost = room.hostId === s.playerId;
    if (this.keys.R.isDown && isHost && g.phase === 'playing') this.resetHeld += delta; else this.resetHeld = 0;
    // --- P3A: host presses N on the result panel to start the next stage (the game is endless) ---
    if (Phaser.Input.Keyboard.JustDown(this.stageKeys.N) && isHost && room.phase === 'stage_complete') void s.nextStage();
    this.holdBar.width = Math.min(1, this.resetHeld / RESET_HOLD_MS) * 200;
    if (this.resetHeld >= RESET_HOLD_MS) { this.resetHeld = 0; void s.resetArena(); }

    // --- entities ---
    const sampled = s.buffer.sample(performance.now() - INTERP_DELAY_MS);
    const live = new Set<string>();
    this.where.clear();
    for (const p of g.players) {
      live.add(p.id);
      const v = this.ensureView(p);
      const isMe = p.id === s.playerId;
      const sameRoom = !p.roomId || !myRoom || p.roomId === myRoom; // a player in another room is not drawn here (different coordinates)
      v.box.setVisible(sameRoom);
      const pred = isMe ? this.predictor.render() : null;
      const pos = pred ?? sampled.get(p.id) ?? p;
      if (sameRoom) this.where.set(p.id, { x: pos.x, y: pos.y });
      v.box.setPosition(pos.x, pos.y - PLAYER_HEIGHT / 2);
      v.visor.setX(pos.facing * 6);
      v.box.setAlpha(p.connected ? 1 : 0.35);
      v.glow.setAlpha(p.connected ? 0.28 : 0.05);
      v.label.setText(p.connected ? p.name : `${p.name} (offline)`);
      v.marker.setText(isMe ? '▼ you' : '').setColor('#ffffff');
    }
    for (const [id, v] of this.views) if (!live.has(id)) { v.box.destroy(); this.views.delete(id); }

    // --- HUD ---
    // the team panel reads the team list (every teammate, no positions); `players` is only who the server lets you see
    const roster: readonly { id: string; name: string; slot: number; connected: boolean }[] = g.team ?? g.players;
    this.hudRows.forEach((row, i) => {
      const p = roster.find((x) => x.slot === i);
      row.swatch.setVisible(!!p); row.dot.setVisible(!!p); row.text.setVisible(!!p);
      if (!p) return;
      const tag = p.id === s.playerId ? ' (you)' : '';
      const host = p.id === room.hostId ? ' host' : '';
      row.text.setText(`${p.name}${tag}${host}`).setAlpha(p.connected ? 1 : 0.45);
      row.dot.setFillStyle(p.connected ? COLOR.cyan : COLOR.danger);
    });
    this.hudStage.setText(`Stage ${g.stage}   ${room.difficulty}   ${this.formatTime(g.simTimeMs)}`);
    this.hudRoom.setText(`Room ${room.code}   ${s.connected ? 'online' : 'offline'}`);

    // --- P2: stage overlay, HUD and action keys (all outcomes are decided by the server) ---
    const meNow = this.predictor.render() ?? sampled.get(s.playerId) ?? me ?? null;
    const st = s.stage;
    const stHere = stateForRoom(contentHere ? st : null, myRoom); // only what lies in the player's room is drawn
    const uses = myRoom !== undefined ? usablesIn(myRoom, st?.escape, s.layouts.get(myRoom)) : [];
    this.escapeNearest = meNow ? nearestUse(meNow, uses) : null;
    // one prompt at a time: what E picks up or opens (items first) wins over doors, keypads, notes and switches
    const itemLine = stHere && meNow ? itemPrompt(stHere, s.playerId, meNow) : null;
    const goal = goalLine(st?.escape, myRoom, carriedItems(st, s.playerId).map((i) => i.kind), s.notes.length);
    this.escapeView.update(myRoom, st?.escape, st?.tick ?? 0, this.escapeNearest, g.phase === 'playing' && !this.pad.isOpen && !itemLine, s.notes, goal);
    const keysText = st?.escape ? `${ESCAPE_KEYS_HINT}  Shift sneak  M mute ghost` : this.defaultHint;
    if (this.hint.text !== keysText) this.hint.setText(keysText);
    this.pad.update(g.phase === 'playing' ? meNow : null);
    this.stageView.update(stHere ?? EMPTY_STAGE, g.tick, stHere ? meNow : null);
    this.stageHud.update(st, g.tick, s.playerId, s);
    this.abilityHud.update(st?.escape ? null : st, g.tick, s.playerId); // no ability bar on an escape stage
    this.itemHud.update(st, s.playerId);
    this.itemMarkers.update(stHere, s.playerId, stHere ? meNow : null, this.where);
    // P3C hand-over and loss feedback: said to both people involved, from the public state alone
    const heard = carryChanges(this.prevItems, st?.items, s.playerId, (id) => g.players.find((x) => x.id === id)?.name ?? 'A teammate');
    this.prevItems = st?.items;
    // on an escape stage a part only leaves your hands when a lock takes it, and the lock says so itself: no generic "is gone"
    const lines = st?.escape ? heard.filter((h) => !h.endsWith(' is gone.')) : heard;
    if (lines.length) s.notice = { text: lines.join(' '), ok: true, at: performance.now() };
    if (contentHere) this.worldView.update(g, delta);
    else { const { world: _unused, ...noWorld } = g; void _unused; this.worldView.update(noWorld, delta); }
    // --- P3E: the ghost (drawn only if the server put it in my view), its sound, the visual cue and the WARNING flicker ---
    const nowMs = performance.now();
    this.ghostView.update(g.ghosts ?? [], myRoom, nowMs, delta);
    if (Phaser.Input.Keyboard.JustDown(this.muteKey)) { this.ghostAudio.setMuted(!this.ghostAudio.muted); this.flash(this.ghostAudio.muted ? 'Ghost sounds muted (M)' : 'Ghost sounds on (M)'); }
    const cue = g.phase === 'playing' ? s.ghostCue : null;
    for (const ev of this.sounds.tick(cue, s.ghostCueAt, nowMs)) this.ghostAudio.play(ev);
    const cueLine = cueIndicator(cue && nowMs - s.ghostCueAt < 1600 ? cue : null);
    this.cueText.setText(cueLine).setVisible(cueLine !== '');
    if (this.pad.isOpen) this.drainKeys(); // typing into the pad must not trigger tools or abilities afterwards
    // keys act on what lies in the player's own room only (a part in another room has the same coordinates as nothing here)
    this.handleStageKeys(stateForRoom(st, myRoom), g.phase === 'playing' && !!me?.connected && contentHere && !this.pad.isOpen, meNow, me?.facing ?? 1);

    // --- P3D: the camera follows the local player inside the room (a room no bigger than the screen never scrolls) ---
    if (meNow) {
      const sc = cameraScroll({ x: meNow.x, y: meNow.y - PLAYER_HEIGHT / 2 }, this.arena);
      this.cameras.main.setScroll(sc.x, sc.y);
    }
    this.pinHud();
    this.syncDarkness(this.darkCfg.enabled || !!st?.darkness);
    if (this.darkness) {
      const ptr = this.input.activePointer;
      const flick = lightScale(!!s.ghostCue?.warning && g.phase === 'playing' && nowMs - s.ghostCueAt < 1600, nowMs, this.ghostFlags.reduceFlash); // never above the server's radius
      this.darkness.update({
        me: g.phase === 'playing' ? meNow : null,
        pointer: this.pointerSeen ? { x: ptr.worldX, y: ptr.worldY } : null,
        facing: me?.facing ?? 1,
        ambient: resolveAmbient(st?.darkness?.ambient, room.difficulty, g.stage) * flick,
        scroll: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY },
        reach: visionRadius(room.difficulty, g.stage) * flick, // the light reaches exactly as far as the server publishes
      });
    }

    const briefing = g.phase === 'briefing';
    this.bannerBg.setVisible(briefing); this.banner.setVisible(briefing); this.bannerSub.setVisible(briefing);
    if (briefing) {
      this.banner.setText(`Stage ${g.stage}`);
      this.bannerSub.setText(`${this.arena.name}  deploying in ${Math.max(1, Math.ceil(g.briefingMs / 1000))}`);
    }
  }

  /** HUD objects are drawn in screen space: they must not scroll with the camera. Depth 90+ is the HUD; objects appear lazily, so check every frame. */
  private pinHud(): void {
    for (const o of this.children.list) {
      const h = o as Phaser.GameObjects.GameObject & { depth: number; scrollFactorX?: number; setScrollFactor?: (x: number, y?: number) => unknown };
      if (h.depth >= 90 && h.scrollFactorX !== undefined && h.scrollFactorX !== 0) h.setScrollFactor?.(0);
    }
  }

  /** E on a door, keypad, safe, clue or switch (P3D). The server decides; keypads and safes open the typing pad first. */
  private useEscape(u: EscapeUse, tick: number): void {
    if ((u.kind === 'keypad' || u.kind === 'safe') && takesCode(u, tick)) { this.pad.open({ id: u.id, kind: u.kind, length: u.length, x: u.x, y: u.y }); return; }
    const intent = useIntent(u);
    if (intent) void this.session.escapeAction(intent);
    else this.session.notice = { text: u.kind === 'keypad' || u.kind === 'safe' ? 'Not now.' : 'Nothing to do.', ok: false, at: performance.now() };
  }

  /** Read and discard every action key press (a key press is remembered until read). */
  private drainKeys(): void {
    for (const k of [...Object.values(this.stageKeys), ...Object.values(this.abilityKeys)]) Phaser.Input.Keyboard.JustDown(k);
  }

  private handleStageKeys(st: import('@wb/shared').StageState | null, canAct: boolean, me: { x: number; y: number } | null, facing: 1 | -1): void {
    const K = this.stageKeys, J = Phaser.Input.Keyboard.JustDown;
    const send = (a: StageAction) => { void this.session.stageAction(a); };
    const pressed = {
      E: J(K.E), Q: J(K.Q), tool: [J(K.ONE), J(K.TWO), J(K.THREE), J(K.FOUR), J(K.FIVE)],
    };
    if (!canAct || !st || !me) return;
    if (pressed.Q) send({ kind: 'cancel' });
    // P3C salvage keys: E pick up / open (else use), G drop or swap (Shift = the older part), F fit a part, H hand over
    const itemSend = (r: ItemIntent) => {
      if (r.ok) void this.session.itemAction(r.action);
      else this.session.notice = { text: r.reason, ok: false, at: performance.now() };
    };
    if (pressed.E) {
      const mine = pickIntent(st, me);
      if (mine) itemSend(mine);
      else if (this.escapeNearest) this.useEscape(this.escapeNearest, st.tick);
      else {
        const id = nearestInteractable(st, me);
        if (id) send({ kind: 'interact', targetId: id });
        else this.session.notice = { text: 'Nothing to use here.', ok: false, at: performance.now() };
      }
    }
    if (st.items) {
      const localId = this.session.playerId;
      if (J(K.G)) itemSend(dropIntent(st, localId, me, this.abilityKeys.SHIFT.isDown));
      if (J(K.F)) itemSend(installIntent(st, localId, me));
      if (J(K.H)) itemSend(handoverIntent(st, localId, me, [...this.where].map(([id, p]) => ({ id, x: p.x, y: p.y }))));
    }
    pressed.tool.forEach((p, i) => {
      if (!p) return;
      const tool = TOOL_KEYS[i]!;
      send({ kind: 'use_tool', tool, targetId: targetForTool(st, me, tool) });
    });

    // P3B reality abilities: 6 Gravity Well, 7 Freeze, 8 Duplicate, 9 Momentum. The mouse aims; Shift = reduce / cancel.
    const AK = this.abilityKeys;
    const abilityPresses: [Phaser.Input.Keyboard.Key, ActiveAbilityId][] = [[AK.SIX, 'gravity_well'], [AK.SEVEN, 'freeze'], [AK.EIGHT, 'duplicate'], [AK.NINE, 'momentum']];
    for (const [key, ability] of abilityPresses) {
      if (!J(key)) continue;
      const ptr = this.input.activePointer;
      const r = buildAbilityAction(ability, {
        me: { x: me.x, y: me.y, facing },
        pointer: this.pointerSeen ? { x: ptr.worldX, y: ptr.worldY } : null,
        props: this.session.game?.world?.props ?? [],
        hazards: st.hazards,
        dir: { up: this.cursors.up.isDown || this.keys.W.isDown, down: this.cursors.down.isDown, left: this.cursors.left.isDown || this.keys.A.isDown, right: this.cursors.right.isDown || this.keys.D.isDown },
        modifier: AK.SHIFT.isDown,
      });
      if (r.ok) void this.session.abilityUse(r.action);
      else this.session.notice = { text: r.reason, ok: false, at: performance.now() };
    }
  }

  private flash(msg: string): void {
    this.toast.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.toast, alpha: 0, duration: 1600, delay: 600 });
  }

  /** Read-only diagnostics for automated browser verification (dev builds only). */
  private exposeDebug(): void {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __WB_DEBUG__: unknown }).__WB_DEBUG__ = {
      setInput: (i: InputIntent | null) => { this.debugInput = i; },
      state: () => {
        const g = this.session.game;
        return {
          fps: Math.round(this.game.loop.actualFps), predActive: this.predictor.active, sent: this.predictor.sentCount, pending: this.predictor.pendingCount,
          ghost: { drawn: this.ghostView.count, cue: this.session.ghostCue, audioReady: this.ghostAudio.ready, muted: this.ghostAudio.muted, sneaking: this.sneaking(), extra: this.session.inputExtra },
          dark: this.darkness ? { ambient: this.darkness.drawnAmbient, assist: this.darkness.assist } : null,
          view: { roomId: g?.players.find((p) => p.id === this.session.playerId)?.roomId ?? null, arena: this.arena.id, scroll: { x: this.cameras.main.scrollX, y: this.cameras.main.scrollY }, layouts: [...this.session.layouts.keys()] },
          stage: this.session.stage, notice: this.session.notice?.text ?? null,
          phase: g?.phase ?? null, tick: g?.tick ?? null, epoch: g?.epoch ?? null, localId: this.session.playerId,
          hostId: this.session.snapshot?.hostId ?? null,
          players: (g?.players ?? []).map((p) => {
            const v = this.views.get(p.id);
            return {
              id: p.id, name: p.name, slot: p.slot, connected: p.connected, grounded: p.grounded, isLocal: p.id === this.session.playerId,
              roomId: p.roomId ?? null, hidden: v ? !v.box.visible : null, serverX: p.x, serverY: p.y, renderX: v?.box.x ?? null, renderY: v ? v.box.y + PLAYER_HEIGHT / 2 : null,
            };
          }),
        };
      },
    };
  }
}
