import Phaser from 'phaser';
import { labRequested } from '../net/labParam';
import { MAX_PLAYERS, DIFFICULTIES, isDifficultyUnlocked } from '@wb/shared';
import { Session } from '../net/session';
import { COLOR, FONT } from '../palette';

const W = 1280, H = 720;

/** Real multiplayer lobby: every value shown is the server's snapshot. */
export class LobbyScene extends Phaser.Scene {
  private session!: Session;
  private shards: Phaser.GameObjects.Image[] = [];
  private status!: Phaser.GameObjects.Text;
  private code!: Phaser.GameObjects.Text;
  private diff!: Phaser.GameObjects.Text;
  private slots: Phaser.GameObjects.Text[] = [];
  private joining = false;

  constructor() { super('Lobby'); }

  create(): void {
    this.session = new Session();
    this.cameras.main.setBackgroundColor(COLOR.void);

    // Atmosphere: drifting fractured shards + cyan/amber glow.
    const glow = this.add.graphics();
    glow.fillGradientStyle(COLOR.cyanDim, COLOR.void, COLOR.amberDim, COLOR.void, 0.55, 0, 0.35, 0);
    glow.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const s = this.add.image(Math.random() * W, Math.random() * H, 'shard')
        .setScale(0.4 + Math.random() * 1.6).setAlpha(0.05 + Math.random() * 0.18)
        .setTint(Math.random() < 0.2 ? COLOR.amber : COLOR.cyan).setAngle(Math.random() * 360);
      this.shards.push(s);
      this.tweens.add({ targets: s, angle: s.angle + (Math.random() < 0.5 ? 40 : -40), y: s.y + 30,
        duration: 4000 + Math.random() * 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    this.add.text(W / 2, 110, 'WORLD//BREAK', { ...FONT, fontSize: '84px', color: '#3de8ff' })
      .setOrigin(0.5).setShadow(0, 0, '#3de8ff', 24, true, true);
    this.add.text(W / 2, 175, 'T H E   R E A L I T Y   R E L A Y', { ...FONT, fontSize: '22px', color: '#ffb02e' }).setOrigin(0.5);

    this.code = this.add.text(W / 2, 250, 'CONNECTING…', { ...FONT, fontSize: '28px', color: COLOR.text }).setOrigin(0.5);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const y = 320 + i * 62;
      this.add.rectangle(W / 2, y, 560, 50, 0x0b1a24, 0.8).setStrokeStyle(2, COLOR.cyanDim);
      this.slots.push(this.add.text(W / 2 - 260, y, '', { ...FONT, fontSize: '22px', color: COLOR.text }).setOrigin(0, 0.5));
    }
    this.diff = this.add.text(W / 2, 600, '', { ...FONT, fontSize: '22px', color: '#ffb02e' }).setOrigin(0.5);
    this.status = this.add.text(W / 2, 660, '', { ...FONT, fontSize: '18px', color: COLOR.text }).setOrigin(0.5);
    this.add.text(W / 2, 698, '[R] ready   [D] difficulty (host)   [ENTER] start (host)', { ...FONT, fontSize: '14px', color: '#5f8da0' }).setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-R', () => {
      const me = this.me();
      if (me && !me.isHost) void this.session.setReady(!me.ready);
    });
    kb.on('keydown-D', () => {
      const snap = this.session.snapshot;
      if (!snap) return;
      const next = DIFFICULTIES[(DIFFICULTIES.indexOf(snap.difficulty) + 1) % DIFFICULTIES.length]!;
      void this.session.setDifficulty(next);
    });
    kb.on('keydown-ENTER', () => { void this.session.start(); });

    const hash = window.location.hash.replace('#', '').toUpperCase();
    this.joining = true;
    void this.session.join(`Operator-${Math.floor(Math.random() * 900 + 100)}`, hash || undefined, labRequested(window.location.search))
      .finally(() => { this.joining = false; });
  }

  private me() { return this.session.snapshot?.players.find((p) => p.id === this.session.playerId); }

  override update(): void {
    const snap = this.session.snapshot;
    if (!snap) {
      this.code.setText(this.joining ? 'CONNECTING…' : 'OFFLINE');
      this.status.setText(this.session.error);
      return;
    }
    if (snap.phase !== 'lobby') {
      // The server started the run: hand the live session to gameplay.
      this.scene.start('Game', { session: this.session });
      return;
    }
    window.location.hash = snap.code;
    this.code.setText(`ROOM  ${snap.code}   (share the URL to invite up to ${MAX_PLAYERS - 1} more)`);
    this.slots.forEach((t, i) => {
      const p = snap.players[i];
      t.setText(p ? `${p.isHost ? '★ ' : '  '}${p.name}${p.id === this.session.playerId ? ' (you)' : ''}   ${p.ready ? 'READY' : 'not ready'}` : '  — open slot —');
      t.setColor(p ? (p.ready ? '#3de8ff' : '#ffb02e') : '#35505c');
    });
    const locked = DIFFICULTIES.filter((d) => !isDifficultyUnlocked(d, snap.highestStage));
    this.diff.setText(`${snap.lab ? 'ABILITY LAB (dev)   ' : ''}DIFFICULTY: ${snap.difficulty.toUpperCase()}   (locked: ${locked.join(', ') || 'none'})`);
    this.status.setText(this.session.error || 'Waiting in lobby');
  }
}
