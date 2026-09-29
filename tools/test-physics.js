// Offline balance test: simulates full rounds with four bots (no network, fast-forward).
import * as P from '../shared/physics.js';
import { Room } from '../server/room.js';

const ROUNDS = Number(process.argv[2] ?? 30);
const SEATS = Number(process.argv[3] ?? 4);
let totalTime = 0;
let totalLoops = 0;
let totalHits = 0;
let totalKnocks = 0;
const wins = new Array(SEATS).fill(0);

for (let r = 0; r < ROUNDS; r++) {
  const room = new Room('TEST', () => {});
  room.destroy(); // stop the real-time loop, we tick manually
  room.broadcast = () => {};
  room.setSeatCount(SEATS);
  for (let i = 0; i < SEATS; i++) room.addBot();
  room.startRound();
  const s0 = room.state;
  let hitKey = '';
  let knocks = 0;
  let steps = 0;
  while (steps < 120 * 600) {
    room.tickOnce();
    steps++;
    const s = room.state;
    if (s.lastHit && s.lastHit.kind === 'hit' && s.lastHit.pressT + ':' + s.lastHit.seat !== hitKey) {
      hitKey = s.lastHit.pressT + ':' + s.lastHit.seat;
      totalHits++;
    }
    if (s.phase === 'playing' && P.aliveSeats(s).length <= 1) break;
  }
  const s = room.state;
  knocks = s.knockSeq;
  const dur = s.t - s.releaseT;
  totalTime += dur;
  totalLoops += s.loops;
  totalKnocks += knocks;
  const alive = P.aliveSeats(s);
  if (alive.length === 1) wins[alive[0]]++;
  const skills = [...room.bots.values()].map((b) => b.skill.toFixed(2)).join(' ');
  console.log(`round ${r + 1}: ${dur.toFixed(1)}s, loops ${s.loops}, winner seat ${alive[0]}  (skills ${skills})`);
}
console.log(
  `\n${SEATS} Spieler: avg round ${(totalTime / ROUNDS).toFixed(1)}s, loops/round ${(totalLoops / ROUNDS).toFixed(1)}, hits/round ${(totalHits / ROUNDS).toFixed(1)}, knocks/round ${(totalKnocks / ROUNDS).toFixed(1)}, wins ${wins}`
);
