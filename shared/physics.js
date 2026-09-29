// Looping Larry – shared, deterministic game simulation.
// Runs on the server (authoritative, with rollback) and on the client (prediction).
//
// Model: a motor in the central tower spins an arm around the vertical axis
// (azimuth `theta`, angular speed `omega`). The arm is hinged at the tower top
// and can swing freely up and down (elevation `phi`). At the tip sits Larry's
// plane. Gravity pulls the plane down onto the table, the spin adds a
// centrifugal term, the players' levers kick it back up. If a kick is strong
// enough the arm swings over the top of the tower – a real looping.
//
// Equation of motion for a point mass on a rigid, driven, hinged arm
// (Lagrange):  phi'' = -cos(phi) * (G + C * omega^2 * sin(phi)) - D * phi'

export const DT = 1 / 120;
export const NUM_SEATS = 4;
export const START_CHICKENS = 3;

// Geometry (world units, y is up, table surface at y = 0)
export const ARM_LEN = 2.4;
export const PIVOT_H = 1.2;
export const PLANE_MIN_H = 0.25; // plane centre height when skidding over the table
export const PLANE_HALF_H = 0.13;
export const PHI_MIN = Math.asin((PLANE_MIN_H - PIVOT_H) / ARM_LEN);
export const PLANE_LOW_R = ARM_LEN * Math.cos(PHI_MIN);

// Arm dynamics
export const GRAVITY = 5.0;
export const CENTRIFUGAL = 0.5;
export const DAMPING = 0.1;
export const RESTITUTION = 0.28;
export const GROUND_FRICTION = 0.0; // omega is motor driven, so nothing to slow down

// Motor
export const OMEGA_START = 1.95; // rad/s at the beginning of a round
export const OMEGA_RAMP = 0.009; // relative speed-up per second of play
export const OMEGA_MAX_FACTOR = 1.6;
export const OMEGA_LOBBY = 1.4;
export const COUNTDOWN_SECS = 3;

// Stations (seat angles). The plane travels towards increasing theta, so it
// passes a player's lever first and their chickens afterwards.
export const PADDLE_OFFSET = 0.2;
export const PADDLE_HALF_WIDTH = 0.17;
export const CHICKEN_OFFSET = 0.2;
export const CHICKEN_HALF_WIDTH = 0.09;
export const CHICKEN_HIT_H = 0.5; // plane centre must be lower than this to knock a chicken
export const CHICKEN_SLOT_R = PLANE_LOW_R;
export const KNOCK_BUMP = 0.6;

// Lever (a see-saw: the player slams the outer end, the inner flap flies up)
export const LEVER_PIVOT_R = 2.95;
export const LEVER_INNER_R = 1.75;
export const LEVER_BASE_H = 0.1;
export const LEVER_MAX = 1.1; // rad
export const PADDLE_UP = 0.07;
export const PADDLE_HOLD = 0.1;
export const PADDLE_DOWN = 0.2;
export const PADDLE_TOTAL = PADDLE_UP + PADDLE_HOLD + PADDLE_DOWN;
export const PADDLE_COOLDOWN = 0.42;

// Kick strength (rad/s of arm elevation speed). Normal hits stay below the
// looping threshold (~4.1); a near perfect hit launches a fast looping that
// lands roughly three stations further.
export const KICK_MIN = 1.9;
export const KICK_MAX = 3.9;
export const KICK_JITTER = 0.2;
export const LOOP_Q = 0.9;
export const LOOP_KICK = 6.0;
export const BLOCK_KICK = 1.4;

const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function seatAngle(seat) {
  return HALF_PI + seat * HALF_PI;
}
export function paddleAngle(seat) {
  return seatAngle(seat) - PADDLE_OFFSET;
}
export function chickenAngle(seat) {
  return seatAngle(seat) + CHICKEN_OFFSET;
}

// Deterministic pseudo random number in [0,1) from two numbers.
export function hash01(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function easeOutQuad(x) {
  return 1 - (1 - x) * (1 - x);
}
function easeInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

// Lever angle as function of time since press (deterministic, no state).
export function paddleAlpha(tau) {
  if (tau < 0 || tau >= PADDLE_TOTAL) return 0;
  if (tau < PADDLE_UP) return LEVER_MAX * easeOutQuad(tau / PADDLE_UP);
  if (tau < PADDLE_UP + PADDLE_HOLD) return LEVER_MAX;
  return LEVER_MAX * (1 - easeInOut((tau - PADDLE_UP - PADDLE_HOLD) / PADDLE_DOWN));
}

// Height of the lever flap surface at radius r.
export function flapHeight(r, alpha) {
  const d = Math.min(LEVER_PIVOT_R - LEVER_INNER_R, Math.max(0, LEVER_PIVOT_R - r));
  return LEVER_BASE_H + d * Math.sin(alpha);
}

export function createState(t = 0) {
  const seats = [];
  for (let i = 0; i < NUM_SEATS; i++) {
    seats.push({ occ: false, active: false, chickens: 0, pressT: -1e9, hitDone: true, gate: false });
  }
  return {
    t,
    tick: 0,
    phase: 'lobby', // lobby | countdown | playing | ended
    releaseT: 0,
    roundId: 0,
    theta: 0,
    omega: OMEGA_LOBBY,
    omega0: OMEGA_START,
    phi: HALF_PI - 0.001,
    phiDot: 0,
    loops: 0,
    seats,
    lastHit: null, // { seat, q, t, pressT, kind }
    knockSeq: 0,
    lastKnock: null, // { seat, t, seq }
  };
}

export function cloneState(s) {
  return {
    ...s,
    seats: s.seats.map((x) => ({ ...x })),
    lastHit: s.lastHit ? { ...s.lastHit } : null,
    lastKnock: s.lastKnock ? { ...s.lastKnock } : null,
  };
}

export function canPress(s, seat, st) {
  const p = s.seats[seat];
  if (!p || !p.occ) return false;
  if (s.phase === 'playing' && (!p.active || p.chickens <= 0)) return false;
  return st - p.pressT >= PADDLE_COOLDOWN;
}

function applyPress(s, seat, st) {
  if (!canPress(s, seat, st)) return;
  const p = s.seats[seat];
  p.pressT = st;
  p.hitDone = false;
}

export function planePose(s) {
  const r = ARM_LEN * Math.cos(s.phi);
  return {
    r,
    h: PIVOT_H + ARM_LEN * Math.sin(s.phi),
    x: r * Math.cos(s.theta),
    z: r * Math.sin(s.theta),
  };
}

export function aliveSeats(s) {
  const out = [];
  s.seats.forEach((p, i) => {
    if (p.active && p.chickens > 0) out.push(i);
  });
  return out;
}

// Advance the simulation by one fixed tick. `inputs` are lever presses
// ({seat, st}) whose timestamp falls inside this tick.
export function step(s, inputs) {
  const dt = DT;
  if (inputs) {
    for (const inp of inputs) applyPress(s, inp.seat, inp.st);
  }
  s.t += dt;
  s.tick++;

  if (s.phase === 'countdown' && s.t >= s.releaseT) {
    s.phase = 'playing';
    s.phi = HALF_PI - 0.03;
    s.phiDot = -0.35;
  }

  // Motor
  if (s.phase === 'playing' || s.phase === 'ended') {
    const el = Math.max(0, s.t - s.releaseT);
    s.omega = s.omega0 * Math.min(OMEGA_MAX_FACTOR, 1 + OMEGA_RAMP * el);
  } else if (s.phase === 'countdown') {
    s.omega += (s.omega0 - s.omega) * Math.min(1, dt * 3);
  } else {
    s.omega += (OMEGA_LOBBY - s.omega) * Math.min(1, dt * 1.5);
  }
  s.theta += s.omega * dt;
  if (s.theta > TAU) s.theta -= TAU;

  // Arm elevation
  if (s.phase === 'lobby' || s.phase === 'countdown') {
    // Motorised lift back to the upright start position (critically damped).
    const k = s.phase === 'countdown' ? 30 : 5;
    const c = 2 * Math.sqrt(k) * 1.05;
    s.phiDot += (k * (HALF_PI - 0.0005 - s.phi) - c * s.phiDot) * dt;
    s.phi += s.phiDot * dt;
    if (s.phi > HALF_PI - 0.0005) {
      s.phi = HALF_PI - 0.0005;
      s.phiDot = 0;
    }
  } else {
    const acc = -Math.cos(s.phi) * (GRAVITY + CENTRIFUGAL * s.omega * s.omega * Math.sin(s.phi)) - DAMPING * s.phiDot;
    s.phiDot += acc * dt;
    s.phi += s.phiDot * dt;
  }

  // Over the top: mirror the arm to the other side of the tower.
  if (s.phi > HALF_PI) {
    s.phi = Math.PI - s.phi;
    s.phiDot = -s.phiDot;
    s.theta = (s.theta + Math.PI) % TAU;
    if (s.phase === 'playing') s.loops++;
  }

  // Table contact
  if (s.phi < PHI_MIN) {
    s.phi = PHI_MIN;
    if (s.phiDot < 0) {
      s.phiDot = -s.phiDot * RESTITUTION;
      if (s.phiDot < 0.15) s.phiDot = 0;
    }
  }

  if (s.phase !== 'playing') {
    for (const p of s.seats) p.gate = false;
    return s;
  }

  const pose = planePose(s);
  const bottom = pose.h - PLANE_HALF_H;

  for (let i = 0; i < NUM_SEATS; i++) {
    const p = s.seats[i];
    if (!p.active || p.chickens <= 0) continue;

    // Lever
    const tau = s.t - p.pressT;
    if (tau >= 0 && tau < PADDLE_TOTAL) {
      const d = wrapAngle(s.theta - paddleAngle(i));
      if (Math.abs(d) < PADDLE_HALF_WIDTH) {
        const a = paddleAlpha(tau);
        const aPrev = paddleAlpha(tau - dt);
        const fh = flapHeight(pose.r, a) + 0.02;
        if (bottom <= fh) {
          if (a > aPrev && !p.hitDone) {
            const q = Math.max(0, 1 - Math.abs(d) / PADDLE_HALF_WIDTH);
            const jitter = (hash01(p.pressT * 1000, i + 1) - 0.5) * 2 * KICK_JITTER;
            const kick =
              q >= LOOP_Q
                ? LOOP_KICK + jitter * 1.5
                : KICK_MIN + (KICK_MAX - KICK_MIN) * Math.pow(q / LOOP_Q, 1.2) + jitter;
            if (kick > s.phiDot) s.phiDot = kick;
            p.hitDone = true;
            s.lastHit = { seat: i, q, t: s.t, pressT: p.pressT, kind: 'hit' };
          } else if (a > LEVER_MAX * 0.5 && s.phiDot < BLOCK_KICK) {
            s.phiDot = BLOCK_KICK;
            if (!p.hitDone) {
              p.hitDone = true;
              s.lastHit = { seat: i, q: 0, t: s.t, pressT: p.pressT, kind: 'block' };
            }
          }
        }
      }
    }

    // Chickens
    const dc = wrapAngle(s.theta - chickenAngle(i));
    if (Math.abs(dc) < CHICKEN_HALF_WIDTH) {
      if (!p.gate && pose.h < CHICKEN_HIT_H) {
        p.gate = true;
        p.chickens--;
        s.knockSeq++;
        s.lastKnock = { seat: i, t: s.t, seq: s.knockSeq };
        if (s.phiDot < KNOCK_BUMP) s.phiDot = KNOCK_BUMP;
      }
    } else {
      p.gate = false;
    }
  }
  return s;
}

// Advance a state to time `t` (fixed ticks) applying the given inputs.
export function simulateTo(s, t, inputs, maxSteps = 240) {
  let n = 0;
  while (s.t + DT <= t + 1e-9 && n < maxSteps) {
    const t0 = s.t;
    const t1 = s.t + DT;
    let tickInputs = null;
    if (inputs && inputs.length) {
      for (const inp of inputs) {
        if (inp.st > t0 && inp.st <= t1) (tickInputs || (tickInputs = [])).push(inp);
      }
    }
    step(s, tickInputs);
    n++;
  }
  return s;
}
