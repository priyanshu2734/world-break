import { HUM_MAX_GAIN, themeLook, themeOrLab, type ThemeId } from '@wb/shared';

/**
 * P3F step 5: the ambient hum of a theme (procedural WebAudio, no files). One or two oscillators at a very low gain (never above `HUM_MAX_GAIN`) that slowly change when the
 * theme changes. Like all audio here it starts only after a user gesture (`arm`), follows the M mute, and every call is a no-op without WebAudio. Reduced motion: the hum does not wobble.
 */
export class ThemeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private osc: OscillatorNode[] = [];
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private theme: ThemeId | undefined;
  private reduced = false;
  muted: boolean;
  constructor(muted = false) { this.muted = muted; }

  /** From a user gesture. Safe to call repeatedly. */
  arm(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.ctx.destination);
        this.apply();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; this.master = null; }
  }

  set(theme: ThemeId | undefined, reducedMotion: boolean): void {
    if (theme === this.theme && reducedMotion === this.reduced) return;
    this.theme = theme; this.reduced = reducedMotion;
    this.apply();
  }
  setMuted(m: boolean): void { this.muted = m; this.apply(); }

  private apply(): void {
    if (!this.ctx || !this.master) return;
    try {
      const t = this.ctx.currentTime;
      for (const o of this.osc) { try { o.stop(); } catch { /* already stopped */ } }
      try { this.lfo?.stop(); } catch { /* already stopped */ }
      this.osc = []; this.lfo = null; this.lfoGain = null;
      if (this.theme === undefined || this.muted) { this.master.gain.setTargetAtTime(0, t, 0.2); return; }
      const d = themeOrLab(this.theme), look = themeLook(this.theme, { reducedMotion: this.reduced, assist: false });
      const make = (hz: number, gain: number): OscillatorNode => {
        const o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
        o.type = d.hum.wave; o.frequency.value = hz; g.gain.value = gain;
        o.connect(g); g.connect(this.master!); o.start();
        return o;
      };
      this.osc.push(make(d.hum.hz, 1));
      if (d.hum.partial > 0) this.osc.push(make(d.hum.hz * d.hum.partial, 0.35));
      if (look.humWobble > 0 && this.osc[0]) {
        this.lfo = this.ctx.createOscillator(); this.lfoGain = this.ctx.createGain();
        this.lfo.frequency.value = look.humWobble; this.lfoGain.gain.value = 0.6;
        this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.osc[0].frequency); this.lfo.start();
      }
      this.master.gain.setTargetAtTime(Math.min(HUM_MAX_GAIN, look.humGain), t, 0.4);
    } catch { /* a failed hum must never break the frame */ }
  }

  destroy(): void {
    for (const o of this.osc) { try { o.stop(); } catch { /* already stopped */ } }
    try { this.lfo?.stop(); void this.ctx?.close(); } catch { /* already closed */ }
    this.osc = []; this.ctx = null; this.master = null;
  }
}
