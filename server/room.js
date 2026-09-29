// The farm: players, seats (2-5 stations), spectators, bots, authoritative
// simulation with rollback lag compensation, and WebRTC signalling relay.
import * as P from '../shared/physics.js';

const MAX_REWIND = 0.25; // seconds a lever press may be applied in the past
const SNAPSHOT_INTERVAL = 1 / 30;
const END_CONFIRM = MAX_REWIND + 0.05;
const MAX_CLIENTS = 8; // players + spectators

const BOT_NAMES = ['Bot Berta', 'Bot Bruno', 'Bot Hilde', 'Bot Kurt', 'Bot Frieda', 'Bot Otto'];

export function serverNow() {
  return performance.now() / 1000;
}

export class Room {
  constructor(id, onEmpty = () => {}) {
    this.id = id;
    this.onEmpty = onEmpty;
    this.clients = new Map(); // id -> { id, ws, name, seat (-1 = spectator), media, score }
    this.bots = new Map(); // seat -> { name, skill, plan, score }
    this.hostId = null;
    this.state = P.createState(serverNow());
    this.history = []; // states after each tick, newest last
    this.inputLog = []; // { seat, st }
    this.pendingInputs = []; // future inputs (bots, early clients)
    this.lastSnap = 0;
    this.endCandidate = null;
    this.winner = null;
    this.phaseTimer = null;
    this.timer = setInterval(() => this.update(), 4);
  }

  destroy() {
    clearInterval(this.timer);
    clearTimeout(this.phaseTimer);
  }

  inLobby() {
    return this.state.phase === 'lobby' || this.state.phase === 'ended';
  }

  // ---------------------------------------------------------------- clients

  addClient(ws, id, name) {
    if (this.clients.size >= MAX_CLIENTS) return { error: 'Der Hof ist voll.' };
    const client = { id, ws, name, seat: -1, media: { mic: false, cam: false }, score: 0 };
    this.clients.set(id, client);
    if (!this.hostId) this.hostId = id;
    if (this.inLobby()) this.reseat();
    else {
      // mid-round: take a free station if there is one, but only play from the next round
      const seat = this.freeSeat();
      if (seat !== -1) {
        client.seat = seat;
        this.state.seats[seat].occ = true;
        this.history = [];
      }
    }
    return { client };
  }

  removeClient(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (c.seat >= 0) this.vacateSeat(c.seat);
    if (this.hostId === id) this.hostId = this.clients.size ? this.clients.keys().next().value : null;
    this.broadcast({ t: 'peer-left', id });
    if (this.clients.size === 0) {
      this.reset();
      this.onEmpty(this);
      return;
    }
    if (this.inLobby()) this.reseat();
    this.checkRoundAfterLeave();
    this.sendLobby();
  }

  // Everybody left: back to a clean farm (the chosen number of stations stays).
  reset() {
    clearTimeout(this.phaseTimer);
    this.bots.clear();
    this.state.phase = 'lobby';
    for (const seat of this.state.seats) {
      seat.occ = false;
      seat.active = false;
      seat.chickens = 0;
    }
    this.winner = null;
    this.resetHistory();
  }

  freeSeat() {
    for (let i = 0; i < this.state.n; i++) {
      if (!this.seatTaken(i)) return i;
    }
    return -1;
  }

  seatTaken(i) {
    if (this.bots.has(i)) return true;
    for (const c of this.clients.values()) if (c.seat === i) return true;
    return false;
  }

  vacateSeat(seat) {
    const s = this.state.seats[seat];
    s.occ = false;
    s.active = false;
    s.chickens = 0;
    this.history = [];
  }

  // (Re)assign stations in the lobby: humans keep their seat if it still exists,
  // then fill free seats in join order, replacing bots if needed. The rest watch.
  reseat() {
    const n = this.state.n;
    for (const seat of [...this.bots.keys()]) if (seat >= n) this.bots.delete(seat);
    for (const c of this.clients.values()) if (c.seat >= n) c.seat = -1;
    for (const c of this.clients.values()) {
      if (c.seat >= 0) continue;
      let seat = this.freeSeat();
      if (seat === -1 && this.bots.size) {
        seat = Math.max(...this.bots.keys());
        this.bots.delete(seat);
      }
      if (seat === -1) break;
      c.seat = seat;
    }
    for (let i = 0; i < P.MAX_SEATS; i++) {
      const st = this.state.seats[i];
      st.occ = i < n && this.seatTaken(i);
      st.active = false;
      st.chickens = st.occ ? P.START_CHICKENS : 0;
    }
    this.resetHistory();
  }

  setSeatCount(n) {
    if (!this.inLobby()) return;
    n = Math.max(P.MIN_SEATS, Math.min(P.MAX_SEATS, Math.round(n)));
    if (!Number.isFinite(n) || n === this.state.n) return;
    clearTimeout(this.phaseTimer);
    this.state.phase = 'lobby';
    this.state.n = n;
    this.reseat();
    this.sendLobby();
    this.broadcastSnapshot();
  }

  addBot() {
    if (!this.inLobby()) return;
    const seat = this.freeSeat();
    if (seat === -1) return;
    const used = new Set([...this.bots.values()].map((b) => b.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
    this.bots.set(seat, { name, skill: 0.55 + Math.random() * 0.35, plan: null, score: 0 });
    this.reseat();
    this.sendLobby();
    this.broadcastSnapshot();
  }

  removeBot(seat) {
    if (!this.bots.has(seat) || !this.inLobby()) return;
    this.bots.delete(seat);
    this.reseat();
    this.sendLobby();
    this.broadcastSnapshot();
  }

  seatedCount() {
    let n = this.bots.size;
    for (const c of this.clients.values()) if (c.seat >= 0) n++;
    return n;
  }

  lobbyInfo() {
    const players = [];
    for (const c of this.clients.values()) {
      players.push({ id: c.id, name: c.name, seat: c.seat, bot: false, media: c.media, score: c.score });
    }
    for (const [seat, b] of this.bots) {
      players.push({ id: 'bot-' + seat, name: b.name, seat, bot: true, media: { mic: false, cam: false }, score: b.score });
    }
    players.sort((a, b) => (a.seat < 0 ? 99 : a.seat) - (b.seat < 0 ? 99 : b.seat));
    return { t: 'lobby', hostId: this.hostId, n: this.state.n, players, phase: this.state.phase, winner: this.winner };
  }

  sendLobby() {
    this.broadcast(this.lobbyInfo());
  }

  // ---------------------------------------------------------------- messages

  handle(client, msg) {
    const isHost = client.id === this.hostId;
    switch (msg.t) {
      case 'flip':
        if (client.seat >= 0) this.onFlip(client.seat, Number(msg.st));
        break;
      case 'start':
        if (isHost) this.startRound();
        break;
      case 'seats':
        if (isHost) this.setSeatCount(Number(msg.n));
        break;
      case 'addBot':
        if (isHost) this.addBot();
        break;
      case 'removeBot':
        if (isHost) this.removeBot(Number(msg.seat));
        break;
      case 'media':
        client.media = { mic: !!msg.mic, cam: !!msg.cam };
        this.sendLobby();
        break;
      case 'signal': {
        const target = this.clients.get(msg.to);
        if (target) this.send(target, { t: 'signal', from: client.id, data: msg.data });
        break;
      }
      case 'emote': {
        const e = String(msg.e || '').slice(0, 8);
        this.broadcast({ t: 'emote', id: client.id, e });
        break;
      }
    }
  }

  // ---------------------------------------------------------------- rounds

  startRound() {
    if (!this.inLobby()) return;
    if (this.seatedCount() < this.state.n) return; // all stations need a pilot
    clearTimeout(this.phaseTimer);
    this.reseat();
    const s = this.state;
    s.roundId++;
    s.phase = 'countdown';
    s.releaseT = s.t + P.COUNTDOWN_SECS + 0.6;
    s.omega0 = P.OMEGA_START * (0.95 + Math.random() * 0.1);
    s.loops = 0;
    s.lastHit = null;
    for (let i = 0; i < P.MAX_SEATS; i++) {
      const seat = s.seats[i];
      seat.active = seat.occ;
      seat.chickens = seat.occ ? P.START_CHICKENS : 0;
      seat.gate = false;
      seat.hitDone = true;
    }
    for (const b of this.bots.values()) b.plan = null;
    this.winner = null;
    this.endCandidate = null;
    this.resetHistory();
    this.sendLobby();
    this.broadcastSnapshot();
  }

  endRound(winnerSeat) {
    const s = this.state;
    s.phase = 'ended';
    this.resetHistory();
    let winnerName = null;
    if (winnerSeat !== undefined && winnerSeat !== null) {
      const bot = this.bots.get(winnerSeat);
      if (bot) {
        bot.score++;
        winnerName = bot.name;
      }
      for (const c of this.clients.values()) {
        if (c.seat === winnerSeat) {
          c.score++;
          winnerName = c.name;
        }
      }
    }
    this.winner = { seat: winnerSeat, name: winnerName };
    this.broadcast({ t: 'roundEnd', seat: winnerSeat, name: winnerName });
    this.sendLobby();
    this.broadcastSnapshot();
    clearTimeout(this.phaseTimer);
    this.phaseTimer = setTimeout(() => {
      if (this.state.phase === 'ended') {
        this.state.phase = 'lobby';
        this.reseat(); // spectators take free stations now
        this.sendLobby();
        this.broadcastSnapshot();
      }
    }, 6000);
  }

  checkRoundAfterLeave() {
    const s = this.state;
    if (s.phase === 'countdown' || s.phase === 'playing') {
      const alive = s.seats.filter((x) => x.active && (s.phase === 'countdown' || x.chickens > 0));
      if (alive.length <= 1) this.endRound(alive.length ? s.seats.indexOf(alive[0]) : null);
    }
  }

  resetHistory() {
    this.history = [];
    this.inputLog = [];
    this.pendingInputs = [];
  }

  // ---------------------------------------------------------------- simulation

  onFlip(seat, st) {
    if (seat === undefined || seat < 0) return;
    const s = this.state;
    if (!Number.isFinite(st)) st = s.t;
    const oldest = this.history.length ? this.history[0].t : s.t;
    st = Math.min(Math.max(st, s.t - MAX_REWIND, oldest + 1e-6), serverNow() + 0.05);
    const input = { seat, st };
    if (st > s.t) {
      this.pendingInputs.push(input);
      return;
    }
    this.rollbackWith(input);
  }

  rollbackWith(input) {
    const s = this.state;
    // find the last stored state before the input time
    let idx = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].t < input.st) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      // nothing to rewind to – apply now
      input.st = s.t + 1e-6;
      this.pendingInputs.push(input);
      return;
    }
    this.inputLog.push(input);
    const target = s.t;
    const base = P.cloneState(this.history[idx]);
    this.history.length = idx + 1;
    const relevant = this.inputLog.filter((x) => x.st > base.t);
    let cur = base;
    while (cur.t + P.DT <= target + 1e-9) {
      const t0 = cur.t;
      const t1 = t0 + P.DT;
      const ins = relevant.filter((x) => x.st > t0 && x.st <= t1);
      P.step(cur, ins.length ? ins : null);
      this.history.push(P.cloneState(cur));
    }
    this.state = cur;
  }

  tickOnce() {
    const s = this.state;
    const t0 = s.t;
    const t1 = t0 + P.DT;
    this.runBots();
    let ins = null;
    if (this.pendingInputs.length) {
      const keep = [];
      for (const inp of this.pendingInputs) {
        if (inp.st <= t1) {
          if (inp.st <= t0) inp.st = t0 + 1e-6;
          (ins || (ins = [])).push(inp);
          this.inputLog.push(inp);
        } else keep.push(inp);
      }
      this.pendingInputs = keep;
    }
    P.step(s, ins);
    this.history.push(P.cloneState(s));
    const cutoff = s.t - MAX_REWIND - 0.05;
    while (this.history.length && this.history[0].t < cutoff) this.history.shift();
    if (this.inputLog.length > 64) this.inputLog = this.inputLog.filter((x) => x.st > cutoff - 1);
  }

  update() {
    const now = serverNow();
    let n = 0;
    while (this.state.t + P.DT <= now && n < 60) {
      this.tickOnce();
      n++;
    }
    if (n === 60) this.state.t = now; // we fell far behind (suspended process) – skip ahead

    // Round end detection (confirmed after the rollback window)
    const s = this.state;
    if (s.phase === 'playing') {
      const alive = P.aliveSeats(s);
      if (alive.length <= 1) {
        if (this.endCandidate === null) this.endCandidate = s.t;
        else if (s.t - this.endCandidate > END_CONFIRM) this.endRound(alive.length ? alive[0] : null);
      } else this.endCandidate = null;
    }

    if (now - this.lastSnap >= SNAPSHOT_INTERVAL) {
      this.lastSnap = now;
      this.broadcastSnapshot();
    }
  }

  runBots() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    for (const [seat, bot] of this.bots) {
      const me = s.seats[seat];
      if (!me.active || me.chickens <= 0) continue;
      if (bot.plan && s.t > bot.plan.until) bot.plan = null;
      if (bot.plan) continue;
      const d = P.wrapAngle(s.theta - P.paddleAngle(seat, s.n));
      if (d < -0.95 || d > -0.12) continue;
      // Look ahead: how high is the plane at my lever, and will it dive onto my chickens?
      const sim = P.cloneState(s);
      let arrive = null;
      let hLever = 0;
      let hMin = Infinity;
      for (let i = 0; i < 160; i++) {
        P.step(sim, null);
        const dd = P.wrapAngle(sim.theta - P.paddleAngle(seat, s.n));
        const h = P.planePose(sim).h;
        if (arrive === null && dd >= 0 && dd < 0.5) {
          arrive = sim.t;
          hLever = h;
        }
        if (dd > -P.PADDLE_HALF_WIDTH && dd < 0.6) hMin = Math.min(hMin, h);
        if (arrive !== null && P.wrapAngle(sim.theta - P.chickenAngle(seat, s.n)) > 0) break;
      }
      // re-evaluate a few times per approach – another player may kick the plane meanwhile
      if (arrive === null) {
        bot.plan = { until: s.t + 0.05 };
        continue;
      }
      const threat = hLever < 0.8 && (hLever < 0.6 || hMin < P.CHICKEN_HIT_H + 0.08);
      if (!threat) {
        bot.plan = { until: s.t + 0.05 };
        continue;
      }
      bot.plan = { until: arrive + 0.35 };
      const missChance = 0.2 - bot.skill * 0.17;
      if (Math.random() < missChance) continue;
      const sigma = 0.075 - bot.skill * 0.055;
      const noise = gauss() * sigma;
      const pressT = Math.max(s.t + P.DT * 0.5, arrive - P.PADDLE_UP * 0.55 + noise);
      this.pendingInputs.push({ seat, st: pressT });
    }
  }

  // ---------------------------------------------------------------- networking

  snapshotMsg() {
    return { t: 's', s: this.state, now: serverNow() };
  }

  broadcastSnapshot() {
    this.broadcast(this.snapshotMsg());
  }

  send(client, msg) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(msg));
  }

  broadcast(msg) {
    const str = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.ws.readyState === 1) c.ws.send(str);
  }
}

function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
