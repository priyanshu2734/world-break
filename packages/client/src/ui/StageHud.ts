import Phaser from 'phaser';
import { TICK_DT, TOOL_SPECS, type StageState } from '@wb/shared';
import type { Session } from '../net/session';
import { COLOR, FONT } from '../palette';
import { TOOL_KEYS } from './targeting';
import { disasterLines } from './disasterText';

const W = 1280, H = 720, D = 100;
const TPS = Math.round(1 / TICK_DT);
const TONE: Record<string, string> = { info: '#9fb6c2', good: '#3de8ff', warn: '#ffb02e', bad: '#ff6b6b', clue: '#ffe9a8' };
const SYMBOL: Record<string, string> = { complete: '[x]', active: '[>]', locked: '[ ]' };

/**
 * A pool of text rows stacked by their MEASURED height (so wrapped rows never overprint the next one).
 * Content is only rewritten when it changes. `anchor` decides whether rows grow down from `y` or up from it.
 */
class Lines {
  private t: Phaser.GameObjects.Text[] = [];
  constructor(scene: Phaser.Scene, private x: number, private y: number, n: number, size: string, width: number, private anchor: 'top' | 'bottom' = 'top') {
    for (let i = 0; i < n; i++) this.t.push(scene.add.text(x, y, '', { ...FONT, fontSize: size, color: COLOR.text, wordWrap: { width } }).setOrigin(0, 0).setDepth(D));
  }
  /** Returns the total stacked height. */
  set(lines: { text: string; color?: string }[], gap = 3): number {
    const shown: Phaser.GameObjects.Text[] = [];
    this.t.forEach((t, i) => {
      const l = lines[i];
      if (!l) { if (t.visible) t.setVisible(false); return; }
      if (t.text !== l.text) t.setText(l.text);
      const c = l.color ?? COLOR.text;
      if (t.style.color !== c) t.setColor(c);
      t.setVisible(true);
      shown.push(t);
    });
    const total = shown.reduce((h, t) => h + t.height + gap, 0);
    let cursor = this.anchor === 'top' ? this.y : this.y - total;
    for (const t of shown) { t.setPosition(this.x, cursor); cursor += t.height + gap; }
    return total;
  }
}

const mmss = (ticks: number) => { const s = Math.max(0, Math.floor(ticks / TPS)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Objectives, symptoms, tools, feed, score and result overlay. Reads server state only. */
export class StageHud {
  private panel: Phaser.GameObjects.Rectangle;
  private objectives: Lines;
  private feed: Lines;
  private toolBox: Phaser.GameObjects.Rectangle[] = [];
  private toolText: Phaser.GameObjects.Text[] = [];
  private score: Phaser.GameObjects.Text;
  private notice: Phaser.GameObjects.Text;
  private barBg: Phaser.GameObjects.Rectangle;
  private bar: Phaser.GameObjects.Rectangle;
  private barText: Phaser.GameObjects.Text;
  private resultBg: Phaser.GameObjects.Rectangle;
  private result: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.panel = scene.add.rectangle(W - 396, 44, 380, 100, 0x04101a, 0.78).setOrigin(0).setDepth(D - 1).setStrokeStyle(1, COLOR.cyanDim);
    this.objectives = new Lines(scene, W - 386, 52, 40, '13px', 360);
    this.feed = new Lines(scene, 16, H - 84, 6, '14px', 520, 'bottom');
    this.score = scene.add.text(W / 2, 52, '', { ...FONT, fontSize: '16px', color: COLOR.text }).setOrigin(0.5, 0).setDepth(D);
    this.notice = scene.add.text(W / 2, 90, '', { ...FONT, fontSize: '18px', color: '#fff1c9', backgroundColor: '#04101acc' }).setOrigin(0.5, 0).setDepth(D + 2).setPadding(10, 4);
    TOOL_KEYS.forEach((tool, i) => {
      const x = 16 + i * 118, y = H - 74;
      this.toolBox.push(scene.add.rectangle(x, y, 110, 46, 0x04101a, 0.85).setOrigin(0).setDepth(D).setStrokeStyle(1, COLOR.cyanDim));
      this.toolText.push(scene.add.text(x + 6, y + 4, '', { ...FONT, fontSize: '13px', color: COLOR.text, lineSpacing: 2 }).setDepth(D + 1));
      void tool;
    });
    this.barBg = scene.add.rectangle(W / 2 - 160, H - 118, 320, 12, 0x04101a, 0.9).setOrigin(0).setDepth(D).setStrokeStyle(1, COLOR.cyanDim);
    this.bar = scene.add.rectangle(W / 2 - 158, H - 116, 0, 8, COLOR.cyan).setOrigin(0).setDepth(D + 1);
    this.barText = scene.add.text(W / 2, H - 134, '', { ...FONT, fontSize: '14px', color: COLOR.text }).setOrigin(0.5).setDepth(D + 1);
    this.resultBg = scene.add.rectangle(W / 2, H / 2, 620, 330, 0x020509, 0.92).setDepth(D + 6).setStrokeStyle(2, COLOR.cyan);
    this.result = scene.add.text(W / 2, H / 2, '', { ...FONT, fontSize: '20px', color: COLOR.text, align: 'center', lineSpacing: 6 }).setOrigin(0.5).setDepth(D + 7);
  }

  update(st: StageState | null, tick: number, localId: string, session: Session): void {
    const show = !!st;
    const minimal = !!st?.escape; // an escape stage has no objectives, symptoms or tool bar: one goal line, hands, notes and keys
    this.panel.setVisible(show && !minimal);
    this.toolBox.forEach((b) => b.setVisible(!minimal)); this.toolText.forEach((t) => t.setVisible(!minimal));
    this.notice.setY(minimal ? 112 : 90);
    if (!st) { this.objectives.set([]); this.feed.set([]); this.resultBg.setVisible(false); this.result.setVisible(false); return; }

    const obj: { text: string; color?: string }[] = [...disasterLines(st, tick), { text: 'OBJECTIVES', color: '#ffb02e' }];
    for (const o of st.objectives) {
      const pct = o.status === 'active' && o.progress > 0 ? ` ${Math.round(o.progress * 100)}%` : '';
      obj.push({ text: `${SYMBOL[o.status]} ${o.label}${pct}`, color: o.status === 'complete' ? '#3de8ff' : o.status === 'locked' ? '#6f8794' : '#ffffff' });
    }
    obj.push({ text: ' ' });
    obj.push({ text: 'SYMPTOMS', color: '#ffb02e' });
    for (const s of st.symptoms) {
      const tag = s.state === 'resolved' ? 'resolved' : s.state === 'mitigated' ? `eased, returns in ${mmss((s.mitigatedUntilTick ?? tick) - tick)}` : 'active';
      obj.push({ text: `${s.label} (${tag})`, color: s.state === 'resolved' ? '#3de8ff' : s.state === 'mitigated' ? '#ffe27a' : '#ff9d6b' });
      if (s.state !== 'resolved') obj.push({ text: `   ${s.hint}`, color: '#7f97a3' });
    }
    if (minimal) { this.objectives.set([]); } else this.panel.setSize(380, this.objectives.set(obj) + 16);

    this.feed.set(st.feed.slice(-6).map((f) => ({ text: f.text, color: TONE[f.tone] })));
    this.score.setText(`Score ${st.score.total}    Time left ${mmss(st.deadlineTick - tick)}${st.expired ? '  OVERRUN' : ''}`).setColor(st.expired ? '#ff6b6b' : COLOR.text);

    const mine = st.players.find((p) => p.id === localId);
    TOOL_KEYS.forEach((tool, i) => {
      const inv = mine?.tools.find((t) => t.tool === tool);
      const spec = TOOL_SPECS[tool];
      const cd = inv ? Math.max(0, inv.cooldownUntilTick - tick) : 0;
      const status = !inv ? 'n/a' : inv.charges === 0 ? 'empty' : cd > 0 ? `${(cd / TPS).toFixed(1)}s` : 'ready';
      this.toolText[i]!.setText(`${i + 1} ${spec.label.split(' ')[1] ?? spec.label}\n${inv ? `${inv.charges}/${inv.maxCharges}` : '-'}  ${status}`)
        .setColor(!inv || inv.charges === 0 ? '#6f8794' : cd > 0 ? '#ffb02e' : '#d8f6ff');
    });

    const ch = st.channels.find((c) => c.playerId === localId);
    this.barBg.setVisible(!!ch); this.bar.setVisible(!!ch); this.barText.setVisible(!!ch);
    if (ch) { this.bar.width = 316 * ch.progress; this.barText.setText(`Working... ${Math.round(ch.progress * 100)}%   (Q to cancel)`); }

    const n = session.notice;
    const fresh = !!n && performance.now() - n.at < 2800;
    this.notice.setVisible(fresh);
    if (fresh && n) this.notice.setText(n.text).setColor(n.ok ? '#d8fff4' : '#ffb3a6');

    const done = st.status === 'stabilized';
    this.resultBg.setVisible(done); this.result.setVisible(done);
    if (done) {
      const rows = Object.entries(st.score.breakdown).filter(([, v]) => v !== 0).map(([k, v]) => `${k.replace('_', ' ')}: ${v > 0 ? '+' : ''}${v}`);
      const isHost = session.snapshot?.hostId === localId;
      const next = isHost ? 'Press N for the next stage' : 'Waiting for the host to start the next stage';
      this.result.setText([minimal ? 'YOU ESCAPED' : 'RELAY CORE STABILISED', '', `Final score ${st.score.total}`, `Cleared in ${mmss(st.tick)}`, '', ...rows, '', next].join('\n'));
      this.resultBg.setSize(620, this.result.height + 64); // the panel always fits its text
    }
  }
}
