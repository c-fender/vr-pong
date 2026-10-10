// Synthesized sound effects (no audio files needed).
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _ok() { return this.ctx && !this.muted; }

  _tone(freq, dur, vol, type = 'sine', endFreq = freq) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  _noise(dur, vol, freq, q = 1) {
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur);
  }

  bounce(surface, speed) {
    if (!this._ok()) return;
    const v = Math.min(1, speed / 4);
    if (surface === 'table') { this._tone(1900, 0.06, 0.35 * v); this._noise(0.02, 0.4 * v, 3500, 2); }
    else if (surface === 'floor') { this._tone(1400, 0.05, 0.2 * v); this._noise(0.02, 0.25 * v, 2500, 2); }
    else { this._tone(900, 0.08, 0.3 * v, 'triangle', 700); this._noise(0.03, 0.3 * v, 1800, 3); }
  }

  sink() {
    if (!this._ok()) return;
    this._tone(520, 0.18, 0.4, 'sine', 160);
    this._noise(0.25, 0.35, 900, 0.8);
  }

  throw() { if (this._ok()) this._noise(0.12, 0.12, 700, 0.7); }

  cheer() {
    if (!this._ok()) return;
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._tone(f, 0.25, 0.18, 'triangle'), i * 90));
  }
}
