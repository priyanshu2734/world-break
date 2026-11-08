import Phaser from 'phaser';
import { DIFFICULTY_UNLOCK_STAGE, type AuthConfig } from '@wb/shared';
import { COLOR } from '../../palette';
import { continueLabel, deleteAccount, profileLines, runChoiceLine, sessionTokens, signIn, signOut } from './accountLogic';
import type { Session } from '../../net/session';

const FONT = { fontFamily: 'monospace' } as const;
interface GoogleId { accounts: { id: { initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void; renderButton(el: HTMLElement, o: Record<string, string>): void } } }

/**
 * P6 C: the lobby's sign-in button, profile and progress panel, "Continue stage N" / "New run", and "Delete my account and data".
 * Everything shown is what the server sent (`session.profile`). Guest play stays first-class: nothing here is required to start a run.
 * `rebuild` is called after the account changes (the lobby is rebuilt so the socket reconnects with, or without, the session token).
 */
export class AccountPanel {
  private readonly info: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly signBtn: Phaser.GameObjects.Text;
  private readonly contBtn: Phaser.GameObjects.Text;
  private readonly newBtn: Phaser.GameObjects.Text;
  private readonly delBtn: Phaser.GameObjects.Text;
  private googleBox: HTMLDivElement | null = null;
  private lastKey = '';
  private busy = false;

  constructor(private readonly scene: Phaser.Scene, private readonly session: Session, private readonly cfg: AuthConfig, private readonly rebuild: () => void) {
    const x = 28;
    scene.add.rectangle(x - 10, 214, 380, 270, 0x04101a, 0.7).setOrigin(0).setStrokeStyle(1, COLOR.cyanDim);
    scene.add.text(x, 222, 'PROFILE', { ...FONT, fontSize: '14px', color: '#9dffcb' });
    this.info = scene.add.text(x, 246, '', { ...FONT, fontSize: '13px', color: COLOR.text, wordWrap: { width: 350 } });
    this.signBtn = this.button(x, 396, '', () => void this.onSign());
    this.contBtn = this.button(x, 424, '', () => void this.session.chooseRun('continue'));
    this.newBtn = this.button(x, 452, '[N] New run (stage 1)', () => void this.session.chooseRun('new'));
    this.delBtn = this.button(x, 480, 'Delete my account and data', () => void this.onDelete(), '#ff9a9a');
    this.note = scene.add.text(x, 508, '', { ...FONT, fontSize: '12px', color: '#ffb02e', wordWrap: { width: 350 } });
    const kb = scene.input.keyboard!;
    kb.on('keydown-C', () => { if (this.contBtn.visible) void this.session.chooseRun('continue'); });
    kb.on('keydown-N', () => { if (this.newBtn.visible) void this.session.chooseRun('new'); });
    if (cfg.mode === 'google' && cfg.googleClientId) this.mountGoogle(cfg.googleClientId);
    scene.events.once('shutdown', () => this.destroy());
  }

  private button(x: number, y: number, text: string, on: () => void, color = '#d8f6ff'): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, { ...FONT, fontSize: '14px', color, backgroundColor: '#0b2a36', padding: { x: 6, y: 3 } }).setInteractive({ useHandCursor: true }).on('pointerdown', on);
  }

  private async onSign(): Promise<void> {
    if (this.busy) return;
    if (sessionTokens.get()) { await this.leave(false); return; }
    if (this.cfg.mode === 'dev') {
      const name = window.prompt('Dev sign-in: pick a display name');
      if (name) await this.finish(name);
    } else if (this.cfg.mode === 'google') this.note.setText('Use the Google button below.');
  }
  private async finish(credential: string): Promise<void> {
    this.busy = true;
    const r = await signIn(credential);
    this.busy = false;
    if (!r.ok) { this.note.setText(r.error); return; }
    sessionTokens.set(r.session.token);
    this.rebuild();
  }
  private async leave(deleteIt: boolean): Promise<void> {
    this.busy = true;
    const t = sessionTokens.get();
    if (deleteIt && t) {
      const r = await deleteAccount(t);
      if (!r.ok) { this.busy = false; this.note.setText(r.error ?? 'Could not delete the account.'); return; }
    } else await signOut();
    sessionTokens.set(null);
    this.busy = false;
    this.rebuild();
  }
  private async onDelete(): Promise<void> {
    if (this.busy || !sessionTokens.get()) return;
    if (window.confirm('Delete your account and everything saved for it? This cannot be undone.')) await this.leave(true);
  }

  private mountGoogle(clientId: string): void {
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'fixed', left: '28px', bottom: '60px', zIndex: '5' });
    document.body.appendChild(box);
    this.googleBox = box;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      const g = (window as unknown as { google?: GoogleId }).google;
      if (!g) return;
      g.accounts.id.initialize({ client_id: clientId, callback: (r) => void this.finish(r.credential) });
      g.accounts.id.renderButton(box, { theme: 'filled_blue', size: 'medium', text: 'signin_with' });
    };
    s.onerror = () => this.note.setText('Google sign-in could not load. You can still play as a guest.');
    document.head.appendChild(s);
  }

  update(isHost: boolean): void {
    const p = this.session.profile, signedIn = !!sessionTokens.get() && p?.signedIn === true;
    const label = continueLabel(p, isHost);
    const key = JSON.stringify([p, isHost, this.cfg.mode, !!sessionTokens.get()]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.info.setText([...profileLines(p, DIFFICULTY_UNLOCK_STAGE), '', runChoiceLine(p)].join('\n'));
    const canSign = this.cfg.mode !== 'off';
    this.signBtn.setVisible(canSign && (this.cfg.mode === 'dev' || !!sessionTokens.get())).setText(sessionTokens.get() ? 'Sign out' : 'Sign in (dev)');
    if (this.googleBox) this.googleBox.style.display = sessionTokens.get() ? 'none' : 'block';
    this.contBtn.setVisible(label !== null).setText(label ? `[C] ${label}` : '');
    this.newBtn.setVisible(isHost && p?.room !== undefined);
    this.delBtn.setVisible(signedIn);
    if (!canSign) this.note.setText('Sign-in is not enabled on this server. Guests can play everything.');
  }

  destroy(): void { this.googleBox?.remove(); this.googleBox = null; }
}
