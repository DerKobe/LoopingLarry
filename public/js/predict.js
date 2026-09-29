// Client side prediction: extrapolate the latest authoritative snapshot to the
// current server time with the shared simulation, including our own lever
// presses that the server has not confirmed yet.
import * as P from '/shared/physics.js';

export class Predictor {
  constructor() {
    this.snaps = [];
    this.pending = [];
    this.mySeat = -1;
  }

  addSnapshot(s) {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t < last.t - 0.5) this.snaps = []; // server clock jumped
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    const me = s.seats[this.mySeat];
    this.pending = this.pending.filter((p) => !(me && me.pressT >= p.st - 1e-6) && p.st > s.t - 0.6);
  }

  latest() {
    return this.snaps[this.snaps.length - 1] || null;
  }

  canPress(now) {
    const s = this.predict(now).state;
    if (!s || this.mySeat < 0) return false;
    return P.canPress(s, this.mySeat, now);
  }

  press(st) {
    this.pending.push({ seat: this.mySeat, st });
  }

  // Returns { state, rem } – state advanced in fixed ticks, rem = leftover seconds (< DT)
  predict(now) {
    const latest = this.latest();
    if (!latest) return { state: null, rem: 0 };
    let base = latest;
    if (this.pending.length) {
      const minSt = Math.min(...this.pending.map((p) => p.st));
      base = null;
      for (let i = this.snaps.length - 1; i >= 0; i--) {
        if (this.snaps[i].t < minSt) {
          base = this.snaps[i];
          break;
        }
      }
      if (!base) {
        this.pending = [];
        base = latest;
      }
    }
    const s = P.cloneState(base);
    const target = Math.min(now, s.t + 0.6);
    P.simulateTo(s, target, this.pending);
    return { state: s, rem: Math.max(0, Math.min(P.DT, now - s.t)) };
  }
}
