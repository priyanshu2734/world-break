import Phaser from 'phaser';
import { ARENA, PLAYER_HEIGHT, PLAYER_WIDTH, type ActiveAbilityId, type GamePlayer, type InputIntent, type StageAction } from '@wb/shared';
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
  private worldView!: WorldView;
  private abilityKeys!: Record<'SIX' | 'SEVEN' | 'EIGHT' | 'NINE' | 'SHIFT', Phaser.Input.Keyboard.Key>;
  private pointerSeen = false;
  private stageKeys!: Record<'E' | 'Q' | 'N' | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE', Phaser.Input.Keyboard.Key>;
  /** Dev-only scripted movement override (set through __WB_DEBUG__ by the browser verification script). */
  private debugInput: InputIntent | null = null;
  /** Real wall-clock time of the previous frame. Phaser's `delta` is smoothed/clamped, so it is NOT used for simulation. */
  private lastFrameAt = 0;

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
    this.stageKeys = kb.addKeys('E,Q,N,ONE,TWO,THREE,FOUR,FIVE') as typeof this.stageKeys;
    this.stageView = new StageView(this);
    this.stageHud = new StageHud(this);
    this.abilityHud = new AbilityHud(this);
    this.worldView = new WorldView(this);
    this.abilityKeys = kb.addKeys('SIX,SEVEN,EIGHT,NINE,SHIFT') as typeof this.abilityKeys;
    this.input.on('pointermove', () => { this.pointerSeen = true; });
    const onBlur = () => kb.resetKeys(); // never leave a key "stuck down" after alt-tab
    this.game.events.on(Phaser.Core.Events.BLUR, onBlur);
    this.events.once('shutdown', () => this.game.events.off(Phaser.Core.Events.BLUR, onBlur));

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
    path(glow, 22, COLOR.amber, 0.12); path(glow, 8, COLOR.amber, 0.25); path(core, 2, 0xfff1c9, 0.9);
    this.tweens.add({ targets: glow, alpha: 0.45, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // solids
    const g = this.add.graphics().setDepth(-5);
    for (const r of ARENA.solids) {
      g.fillStyle(0x0a1822, 1).fillRect(r.x, r.y, r.w, r.h);
      g.lineStyle(1, COLOR.cyanDim, 0.55);
      for (let x = r.x + 40; x < r.x + r.w; x += 40) g.lineBetween(x, r.y + 4, x, r.y + r.h);
      g.fillStyle(COLOR.amberDim, 0.9).fillRect(r.x, r.y + r.h - 2, r.w, 2); // underside warning strip
    }
    const edge = this.add.graphics().setDepth(-4).setBlendMode(Phaser.BlendModes.ADD);
    for (const r of ARENA.solids) {
      edge.lineStyle(8, COLOR.cyan, 0.12).lineBetween(r.x, r.y, r.x + r.w, r.y);
      edge.lineStyle(2, COLOR.cyan, 0.95).lineBetween(r.x, r.y, r.x + r.w, r.y);
    }
    this.tweens.add({ targets: edge, alpha: 0.6, duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
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
    this.hint = this.add.text(W / 2, H - 14, 'A/D move  W/Space jump  E use  1-5 tools  6-9 abilities (mouse aims, Shift = alt)  Q cancel  hold R reset (host)',
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
    return { moveX: (right ? 1 : 0) - (left ? 1 : 0), jump };
  }

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

    // --- local prediction ---
    if (g.phase === 'playing' && me && me.connected) {
      if (!this.predictor.active) { this.predictor.start(me, g.epoch); this.lastSerial = s.gameSerial; }
      if (s.gameSerial !== this.lastSerial) { this.lastSerial = s.gameSerial; this.predictor.reconcile(me, g.epoch); }
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
    for (const p of g.players) {
      live.add(p.id);
      const v = this.ensureView(p);
      const isMe = p.id === s.playerId;
      const pred = isMe ? this.predictor.render() : null;
      const pos = pred ?? sampled.get(p.id) ?? p;
      v.box.setPosition(pos.x, pos.y - PLAYER_HEIGHT / 2);
      v.visor.setX(pos.facing * 6);
      v.box.setAlpha(p.connected ? 1 : 0.35);
      v.glow.setAlpha(p.connected ? 0.28 : 0.05);
      v.label.setText(p.connected ? p.name : `${p.name} (offline)`);
      v.marker.setText(isMe ? '▼ you' : '').setColor('#ffffff');
    }
    for (const [id, v] of this.views) if (!live.has(id)) { v.box.destroy(); this.views.delete(id); }

    // --- HUD ---
    this.hudRows.forEach((row, i) => {
      const p = g.players.find((x) => x.slot === i);
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
    this.stageView.update(st ?? EMPTY_STAGE, g.tick, st ? meNow : null);
    this.stageHud.update(st, g.tick, s.playerId, s);
    this.abilityHud.update(st, g.tick, s.playerId);
    this.worldView.update(g, delta);
    this.handleStageKeys(st, g.phase === 'playing' && !!me?.connected, meNow, me?.facing ?? 1);

    const briefing = g.phase === 'briefing';
    this.bannerBg.setVisible(briefing); this.banner.setVisible(briefing); this.bannerSub.setVisible(briefing);
    if (briefing) {
      this.banner.setText(`Stage ${g.stage}`);
      this.bannerSub.setText(`${ARENA.name}  deploying in ${Math.max(1, Math.ceil(g.briefingMs / 1000))}`);
    }
  }

  private handleStageKeys(st: import('@wb/shared').StageState | null, canAct: boolean, me: { x: number; y: number } | null, facing: 1 | -1): void {
    const K = this.stageKeys, J = Phaser.Input.Keyboard.JustDown;
    const send = (a: StageAction) => { void this.session.stageAction(a); };
    const pressed = {
      E: J(K.E), Q: J(K.Q), tool: [J(K.ONE), J(K.TWO), J(K.THREE), J(K.FOUR), J(K.FIVE)],
    };
    if (!canAct || !st || !me) return;
    if (pressed.Q) send({ kind: 'cancel' });
    if (pressed.E) {
      const id = nearestInteractable(st, me);
      if (id) send({ kind: 'interact', targetId: id });
      else this.session.notice = { text: 'Nothing to use here.', ok: false, at: performance.now() };
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
          stage: this.session.stage, notice: this.session.notice?.text ?? null,
          phase: g?.phase ?? null, tick: g?.tick ?? null, epoch: g?.epoch ?? null, localId: this.session.playerId,
          hostId: this.session.snapshot?.hostId ?? null,
          players: (g?.players ?? []).map((p) => {
            const v = this.views.get(p.id);
            return {
              id: p.id, name: p.name, slot: p.slot, connected: p.connected, grounded: p.grounded, isLocal: p.id === this.session.playerId,
              serverX: p.x, serverY: p.y, renderX: v?.box.x ?? null, renderY: v ? v.box.y + PLAYER_HEIGHT / 2 : null,
            };
          }),
        };
      },
    };
  }
}
