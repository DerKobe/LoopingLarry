// Synthesised sound effects (no audio files needed).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.6;
    this.motor = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.startMotor();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 1;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Motor hum: kept well below the effects, a soft drone whose pitch climbs
  // with the arm speed to build up tension over the round.
  startMotor() {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const osc2 = c.createOscillator();
    osc2.type = 'triangle';
    const osc2g = c.createGain();
    osc2g.gain.value = 0.5;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    lp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = 0;
    // gentle propeller flutter (was a harsh 25 % buzz)
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 20;
    lfoG.gain.value = 0.08;
    const am = c.createGain();
    am.gain.value = 0.92;
    lfo.connect(lfoG).connect(am.gain);
    osc.connect(lp);
    osc2.connect(osc2g).connect(lp);
    lp.connect(g).connect(am).connect(this.master);
    osc.start();
    osc2.start();
    lfo.start();
    this.motor = { osc, osc2, g, lp, lfo };
  }

  // omega: arm speed, near: 0..1 how close the plane is to the listener
  updateMotor(omega, near, active) {
    if (!this.motor) return;
    const t = this.ctx.currentTime;
    const f = 48 + omega * 20; // pitch rises with the speed
    this.motor.osc.frequency.setTargetAtTime(f, t, 0.1);
    this.motor.osc2.frequency.setTargetAtTime(f * 2, t, 0.1);
    this.motor.lfo.frequency.setTargetAtTime(12 + omega * 5, t, 0.1);
    this.motor.lp.frequency.setTargetAtTime(220 + near * 350 + omega * 35, t, 0.08);
    const vol = active ? 0.011 + near * 0.014 + Math.min(0.008, omega * 0.001) : 0.006;
    this.motor.g.gain.setTargetAtTime(vol, t, 0.1);
  }

  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noise(t, dur, freq, q, peak, type = 'bandpass') {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, 0.004, peak, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    return f;
  }

  tone(t, type, f0, f1, dur, peak) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, peak, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  lever(power = 0) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.06 + power * 0.06, 1800 - power * 600, 1.5, 0.25 + power * 0.2);
    this.tone(t, 'triangle', 220 + power * 120, 90, 0.08 + power * 0.06, 0.25 + power * 0.15);
  }

  // Rising "spring tension" sound while the lever is charged
  chargeStart() {
    if (!this.ok() || this.chargeOsc) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 140;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 4;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.05);
    o.connect(f).connect(g).connect(this.master);
    o.start();
    this.chargeOsc = { o, f, g };
  }

  chargeUpdate(level) {
    if (!this.chargeOsc) return;
    const t = this.ctx.currentTime;
    const wobble = level >= 0.97 ? Math.sin(t * 60) * 30 : 0;
    this.chargeOsc.o.frequency.setTargetAtTime(140 + level * 520 + wobble, t, 0.02);
    this.chargeOsc.f.frequency.setTargetAtTime(600 + level * 1400, t, 0.02);
  }

  chargeStop() {
    if (!this.chargeOsc) return;
    const { o, g } = this.chargeOsc;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.015);
    o.stop(t + 0.1);
    this.chargeOsc = null;
  }

  hit(q) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.tone(t, 'square', 520, 180, 0.09, 0.18);
    this.noise(t, 0.12, 900, 2, 0.5);
    if (q > 0.55) this.tone(t + 0.03, 'sine', 500, 1400 + q * 600, 0.35, 0.12);
  }

  block() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.tone(t, 'triangle', 300, 120, 0.12, 0.25);
    this.noise(t, 0.08, 600, 1, 0.3);
  }

  knock() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    // bonk
    this.tone(t, 'sine', 180, 60, 0.18, 0.5);
    this.noise(t, 0.1, 2400, 1, 0.3);
    // cluck-cluck-BAGAWK
    const clucks = [
      [0.06, 700, 520, 0.07],
      [0.15, 760, 540, 0.07],
      [0.26, 900, 1300, 0.2],
    ];
    for (const [dt, a, b, d] of clucks) {
      this.tone(t + dt, 'square', a, b, d, 0.07);
      this.tone(t + dt, 'sawtooth', a * 1.5, b * 1.5, d, 0.04);
    }
  }

  looping() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = this.noise(t, 1.1, 400, 1.2, 0.35);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
    f.frequency.exponentialRampToValueAtTime(500, t + 1.1);
    [523, 659, 784, 1047].forEach((n, i) => this.tone(t + 0.1 + i * 0.07, 'triangle', n, n, 0.18, 0.12));
  }

  beep(high) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = high ? 988 : 587;
    this.tone(t, 'square', f, f, high ? 0.45 : 0.18, 0.12);
    this.tone(t, 'sine', f * 2, f * 2, high ? 0.45 : 0.18, 0.06);
  }

  whoosh() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = this.noise(t, 0.6, 300, 0.8, 0.25);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
  }

  win() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((n, i) => {
      const d = i === notes.length - 1 ? 0.6 : 0.13;
      this.tone(t + i * 0.12, 'square', n, n, d, 0.09);
      this.tone(t + i * 0.12, 'triangle', n / 2, n / 2, d, 0.1);
    });
  }

  out() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    [392, 370, 349].forEach((n, i) => this.tone(t + i * 0.32, 'sawtooth', n, n * 0.98, 0.28, 0.08));
    this.tone(t + 0.96, 'sawtooth', 330, 220, 0.8, 0.08);
  }
}
