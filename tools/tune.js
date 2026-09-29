// Prints flight characteristics for a range of kicks – used to tune the physics.
import * as P from '../shared/physics.js';

function flight(kick, omegaFactor = 1) {
  const s = P.createState(0);
  s.phase = 'playing';
  s.releaseT = -1e6; // motor at max ramp is irrelevant here, we pin omega below
  s.omega0 = P.OMEGA_START * omegaFactor;
  s.phi = P.PHI_MIN;
  s.phiDot = kick;
  s.releaseT = 0;
  let maxH = 0;
  let travelled = 0;
  let tLand = null;
  let loops = 0;
  let lastTheta = s.theta;
  for (let i = 0; i < 1200; i++) {
    const before = s.theta;
    P.step(s, null);
    s.omega = P.OMEGA_START * omegaFactor; // freeze ramp
    let dth = s.theta - before;
    if (dth < 0) dth += Math.PI * 2;
    travelled += dth;
    const h = P.planePose(s).h;
    maxH = Math.max(maxH, h);
    if (s.phiDot < 0 && h < P.CHICKEN_HIT_H && tLand === null) {
      tLand = s.t;
      break;
    }
    lastTheta = s.theta;
  }
  loops = s.loops;
  return { kick, maxH: maxH.toFixed(2), t: tLand?.toFixed(2), stations: (travelled / (Math.PI / 2)).toFixed(2), loops };
}

console.log('PHI_MIN deg', ((P.PHI_MIN * 180) / Math.PI).toFixed(1), 'low radius', P.PLANE_LOW_R.toFixed(2));
for (const f of [1, 1.3, 1.6]) {
  console.log('--- omega factor', f);
  for (let k = 1.5; k <= 8.01; k += 0.25) console.log(flight(k, f));
}

// Charge power -> kick -> landing distance
console.log('--- charge power (q = timing quality)');
for (const q of [0.3, 0.8]) {
  for (const pw of [0, 0.25, 0.5, 0.75, 1]) {
    const k = P.kickFor(pw, q, 0);
    const f = flight(k);
    console.log(`power ${pw.toFixed(2)} q ${q}: kick ${k.toFixed(2)} maxH ${f.maxH} lands after ${f.stations} stations${f.loops ? ' (LOOPING)' : ''}`);
  }
}

// Release from upright
const s = P.createState(0);
s.phase = 'countdown';
s.releaseT = 0.001;
for (let i = 0; i < 600; i++) {
  P.step(s, null);
  if (P.planePose(s).h < P.CHICKEN_HIT_H) {
    console.log('release -> reaches chicken height after', s.t.toFixed(2), 's');
    break;
  }
}
