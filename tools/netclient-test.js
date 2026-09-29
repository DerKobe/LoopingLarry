// Headless integration test: a scripted "human" client with artificial network
// latency plays against a bot. Verifies clock sync, lag compensated lever hits
// and the round flow.  Usage: node tools/netclient-test.js [latencyMs] [port]
import WebSocket from 'ws';
import * as P from '../shared/physics.js';

const LAT = Number(process.argv[2] ?? 80) / 1000; // one-way latency in seconds
const PORT = Number(process.argv[3] ?? 3000);

const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
const now = () => performance.now() / 1000;
const send = (m) => setTimeout(() => ws.send(JSON.stringify(m)), LAT * 1000);
let offset = 0;
let best = Infinity;
let latest = null;
let mySeat = -1;
let prevD = null;
let presses = 0;
let hits = 0;
let lastHitKey = '';
let knocksMe = 0;
let lastChickens = null;
let started = false;

ws.on('open', () => {
  for (let i = 0; i < 6; i++) setTimeout(() => send({ t: 'ping', c: now() }), i * 60);
  setTimeout(() => send({ t: 'join', name: 'Tester' }), 400);
});

ws.on('message', (raw) => {
  setTimeout(() => {
    const m = JSON.parse(raw);
    if (m.t === 'pong') {
      const rtt = now() - m.c;
      if (rtt < best) {
        best = rtt;
        offset = m.s + rtt / 2 - now();
      }
    } else if (m.t === 'welcome') {
      mySeat = m.seat;
      send({ t: 'seats', n: 2 });
      send({ t: 'addBot' });
      setTimeout(() => send({ t: 'start' }), 300);
    } else if (m.t === 's') {
      latest = m.s;
      const me = latest.seats[mySeat];
      if (latest.phase === 'playing') started = true;
      if (lastChickens !== null && me.chickens < lastChickens) knocksMe++;
      lastChickens = me.chickens;
      if (latest.lastHit && latest.lastHit.seat === mySeat) {
        const k = latest.lastHit.pressT.toFixed(4);
        if (k !== lastHitKey) {
          lastHitKey = k;
          hits++;
          console.log(`  hit q=${latest.lastHit.q.toFixed(2)} kind=${latest.lastHit.kind}`);
        }
      }
    } else if (m.t === 'roundEnd') {
      console.log(`round end – winner seat ${m.seat} (${m.name})`);
      finish();
    }
  }, LAT * 1000);
});

const timer = setInterval(() => {
  if (!latest || latest.phase !== 'playing') return;
  const t = now() + offset;
  const s = P.cloneState(latest);
  P.simulateTo(s, t, null);
  const d = P.wrapAngle(s.theta - P.paddleAngle(mySeat, s.n));
  const h = P.planePose(s).h;
  if (prevD !== null && prevD < -0.04 && d >= -0.04 && h < 0.6) {
    presses++;
    send({ t: 'flip', st: t });
  }
  prevD = d;
}, 2);

function finish() {
  clearInterval(timer);
  console.log(`latency ${LAT * 1000}ms one-way: presses=${presses} hits=${hits} myKnocks=${knocksMe} clockErr≈${(best / 2 * 1000).toFixed(1)}ms`);
  ws.close();
  process.exit(0);
}
setTimeout(() => {
  console.log('timeout');
  finish();
}, 90000);
