import type { SoundEvent } from './soundScheduler';

/**
 * P3E step 2: procedural WebAudio for the ghost. No audio files. Browsers only allow audio after a user gesture, so the
 * AudioContext is created lazily on the first key press or click (`arm`). If WebAudio is missing or blocked, every call is a no-op.
 */
export class GhostAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted: boolean;

  constructor(muted = false) { this.muted = muted; }

  /** Call from a user gesture (key down or pointer down). Safe to call repeatedly. */
  arm(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
        this.noise = this.makeNoise(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; this.master = null; }
  }

  get ready(): boolean { return this.ctx !== null && this.ctx.state === 'running'; }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  play(e: SoundEvent): void {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return;
    try {
      if (e.kind === 'step') this.step(e.gain, e.pan, e.hunting, e.type);
      else if (e.kind === 'knock') this.knock(e.gain, e.pan);
      else if (e.kind === 'beat') this.beat(e.gain, e.fast);
      else this.whisper();
    } catch { /* a failed sound must never break the frame */ }
  }

  /** P3E step 4: the crack of the Pulse Gun (a falling sine plus a noise burst). Silent if audio is not armed or muted. */
  zap(): void {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return;
    try {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.25);
      const g = this.out(0, 0.5, t, 0.3);
      o.connect(g); o.start(t); o.stop(t + 0.32);
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const g2 = this.out(0, 0.3, t, 0.12);
      src.connect(g2); src.start(t, 0, 0.12);
    } catch { /* a failed sound must never break the frame */ }
  }

  destroy(): void {
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null; this.master = null;
  }

  // ---------------------------------------------------------------- voices
  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let seed = 12345; // a fixed noise table: the same sound every run
    for (let i = 0; i < len; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }
    return buf;
  }

  private out(pan: number, gain: number, t: number, dur: number): GainNode {
    const ctx = this.ctx!, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(this.master!);
    } else g.connect(this.master!);
    return g;
  }

  /** A light patter: a short band-passed noise tick; hunting steps are lower and sharper. */
  private step(gain: number, pan: number, hunting: boolean, type: string): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = (type === 'wisp' ? 1800 : 900) * (hunting ? 0.7 : 1); f.Q.value = 1.4;
    const g = this.out(pan, 0.5 * gain * (hunting ? 1.3 : 1), t, hunting ? 0.12 : 0.09);
    src.connect(f); f.connect(g);
    src.start(t, Math.random() * 1.5, 0.15);
  }

  /** A dull knock on wood: a short low sine with a click. */
  private knock(gain: number, pan: number): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.08);
    const g = this.out(pan, 0.7 * gain, t, 0.14);
    o.connect(g); o.start(t); o.stop(t + 0.18);
  }

  /** Two low thumps: lub-dub. */
  private beat(gain: number, fast: boolean): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    for (const [dt, f, k] of [[0, 62, 1], [fast ? 0.14 : 0.2, 52, 0.75]] as const) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.6, t + dt); o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.08);
      const g = this.out(0, gain * k, t + dt, 0.2);
      o.connect(g); o.start(t + dt); o.stop(t + dt + 0.25);
    }
  }

  /** A breathy whisper: filtered noise with a slow amplitude wobble. */
  private whisper(): void {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(2400, t); f.frequency.linearRampToValueAtTime(1500, t + 1.1);
    const g = this.out(0, 0.22, t, 1.2);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 7; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g);
    src.start(t); src.stop(t + 1.3); lfo.start(t); lfo.stop(t + 1.3);
  }
}
