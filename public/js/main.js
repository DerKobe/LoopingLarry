// Looping Larry – client entry point.
import * as P from '/shared/physics.js';
import { Net } from './net.js';
import { Predictor } from './predict.js';
import { Mesh } from './rtc.js';
import { World } from './scene.js';
import { Sfx } from './audio.js';
import { Hud } from './hud.js';

const $ = (sel) => document.querySelector(sel);

const net = new Net();
const predictor = new Predictor();
const mesh = new Mesh(net);
const world = new World($('#game'));
const sfx = new Sfx();
const hud = new Hud();

const app = {
  joined: false,
  myId: null,
  mySeat: -1,
  lobby: null,
  micOn: true,
  camOn: true,
  lastPhase: null,
  lastRoundId: -1,
  lastLoops: 0,
  seenHits: new Set(),
  countdownShown: null,
  goUntil: 0,
};
window.__app = app; // handy for debugging
window.__dbg = { net, predictor, world, P };

// ------------------------------------------------------------------ join screen

$('#in-name').value = localStorage.getItem('ll-name') || '';

async function enableMedia() {
  try {
    const stream = await mesh.getMedia();
    $('#preview').srcObject = stream;
    $('#preview-empty').classList.add('hidden');
    app.camOn = mesh.hasTrack('video');
    app.micOn = mesh.hasTrack('audio');
    return true;
  } catch (err) {
    console.warn(err);
    $('#preview-empty').querySelector('small').textContent =
      err && err.name === 'NotAllowedError'
        ? 'Zugriff verweigert – du kannst trotzdem spielen und die anderen sehen.'
        : window.isSecureContext
          ? 'Keine Kamera gefunden – du kannst trotzdem mitspielen.'
          : 'Kamera braucht HTTPS (oder localhost).';
    app.camOn = false;
    app.micOn = false;
    return false;
  }
}

$('#btn-media').addEventListener('click', () => enableMedia());
// Try right away – browsers remember the permission
if (navigator.permissions) {
  navigator.permissions
    .query({ name: 'camera' })
    .then((r) => {
      if (r.state === 'granted') enableMedia();
    })
    .catch(() => {});
}

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#in-name').value.trim() || 'Pilot';
  localStorage.setItem('ll-name', name);
  $('#btn-join').disabled = true;
  $('#join-error').textContent = '';
  sfx.init();
  hud.setAudioContext(sfx.ctx);
  if (!mesh.localStream) await enableMedia();
  try {
    if (!net.ws || net.ws.readyState > 1) await net.connect();
    net.send({ t: 'join', name });
  } catch (err) {
    $('#join-error').textContent = 'Keine Verbindung zum Server.';
    $('#btn-join').disabled = false;
  }
});

// ------------------------------------------------------------------ network events

net.addEventListener('error', (e) => {
  $('#join-error').textContent = e.detail.message;
  $('#btn-join').disabled = false;
});

net.addEventListener('welcome', (e) => {
  const m = e.detail;
  app.joined = true;
  app.myId = m.id;
  app.mySeat = m.seat;
  predictor.mySeat = m.seat;
  world.roundId = -1; // leave the demo: rebuild chickens from the real state
  $('#join').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  if (location.search) history.replaceState(null, '', '/');
  mesh.start(m.id, m.iceServers, m.peers);
  if (mesh.localStream) hud.setStream(app.myId, mesh.localStream);
  hud.localCamOn = app.camOn;
  hud.localMicOn = app.micOn;
  updateMediaButtons();
  sendMedia();
});

net.addEventListener('lobby', (e) => {
  const info = e.detail;
  app.lobby = info;
  const me = info.players.find((p) => p.id === app.myId);
  if (me) {
    if (me.seat !== app.mySeat && app.lobby && me.seat >= 0) toast('Du hast jetzt einen Platz am Hof 🐔');
    app.mySeat = me.seat;
    predictor.mySeat = me.seat;
  }
  if (world.n !== info.n) world.layout(info.n);
  hud.setPlayers(info.players, app.myId, info.n);
  world.setSeatInfo(info.players, app.mySeat);
  hud.renderLobby(info, app.myId, info.phase);
});

net.addEventListener('s', (e) => {
  predictor.addSnapshot(e.detail.s);
  predictor.charging = e.detail.ch || {};
});

net.addEventListener('peer-joined', (e) => {
  if (e.detail.id !== app.myId) {
    mesh.ensurePeer(e.detail.id);
    toast(`${e.detail.name} ist gelandet 🛬`);
  }
});

net.addEventListener('peer-left', (e) => {
  mesh.removePeer(e.detail.id);
  hud.removeStream(e.detail.id);
});

net.addEventListener('roundEnd', (e) => {
  const { seat, name } = e.detail;
  hud.showWinner(name, seat === null || seat === undefined ? -1 : seat);
  sfx.win();
  world.confetti();
  if (seat !== null && seat !== undefined) hud.flashTile(seat, true);
  setTimeout(() => hud.hideWinner(), 5500);
});

net.addEventListener('emote', (e) => hud.emote(e.detail.id, e.detail.e));

net.addEventListener('close', () => {
  if (app.joined) {
    toast('Verbindung verloren – lade neu …');
    setTimeout(() => location.reload(), 2500);
  }
});

mesh.addEventListener('stream', (e) => hud.setStream(e.detail.id, e.detail.stream));

// ------------------------------------------------------------------ controls

// ------------------------------------------------------------------ lever charging
// Hold to wind up the lever, release to fire. The longer you hold, the harder
// Larry flies – but after CHARGE_MAX the lever fires on its own.
const charge = { active: false, start: 0, source: null, timer: null };

function mayUseLever() {
  const s = predictor.latest();
  if (!app.joined || !s || app.mySeat < 0) return false;
  const p = s.seats[app.mySeat];
  if (!p || !p.occ) return false;
  return !(s.phase === 'playing' && (!p.active || p.chickens <= 0));
}

function startCharge(source) {
  if (charge.active || !mayUseLever()) return;
  charge.active = true;
  charge.source = source;
  charge.start = net.serverNow();
  // fire on our own at full charge (the frame loop checks too, the timer is the safety net)
  charge.timer = setTimeout(() => charge.active && fire(1), P.CHARGE_MAX * 1000);
  net.send({ t: 'charge', st: charge.start });
  sfx.chargeStart();
}

function releaseCharge(source) {
  if (!charge.active || (source && charge.source !== source)) return;
  fire(Math.min(1, (net.serverNow() - charge.start) / P.CHARGE_MAX));
}

function fire(power) {
  charge.active = false;
  clearTimeout(charge.timer);
  sfx.chargeStop();
  const now = net.serverNow();
  if (predictor.canPress(now)) return flipNow(power);
  // Lever still swinging back from the last shot: fire as soon as it is ready
  const s = predictor.predict(now).state;
  const wait = s ? s.seats[app.mySeat].pressT + P.PADDLE_COOLDOWN - now : 1;
  if (wait > 0 && wait < 0.5) setTimeout(() => flipNow(power), wait * 1000 + 5);
}

function flipNow(power) {
  const now = net.serverNow();
  if (!predictor.canPress(now)) return;
  predictor.press(now, power);
  net.send({ t: 'flip', st: now, power });
  sfx.lever(power);
}

function chargeLevel(now) {
  return charge.active ? Math.min(1, (now - charge.start) / P.CHARGE_MAX) : 0;
}

const EMOTES = ['👍', '😂', '😱', '😡'];
window.addEventListener('keydown', (e) => {
  if (!app.joined) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (!e.repeat) startCharge('key');
  } else if (e.code === 'KeyM') toggleMic();
  else if (e.code === 'KeyV') toggleCam();
  else if (/^Digit[1-4]$/.test(e.code) && !e.repeat) {
    net.send({ t: 'emote', e: EMOTES[Number(e.code.slice(5)) - 1] });
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') releaseCharge('key');
});
$('#game').addEventListener('mousedown', (e) => {
  if (e.button === 0) startCharge('mouse');
});
$('#tiles').addEventListener('mousedown', (e) => {
  if (e.button === 0) startCharge('mouse');
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) releaseCharge('mouse');
});
window.addEventListener('blur', () => releaseCharge(null));

$('#btn-start').addEventListener('click', () => net.send({ t: 'start' }));
$('#btn-bot').addEventListener('click', () => net.send({ t: 'addBot' }));
$('#lobby-players').addEventListener('click', (e) => {
  const b = e.target.closest('.rm');
  if (b) net.send({ t: 'removeBot', seat: Number(b.dataset.seat) });
});
$('#seat-count').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && !b.disabled) net.send({ t: 'seats', n: Number(b.dataset.n) });
});
$('#btn-leave').addEventListener('click', () => {
  location.href = '/';
});
$('#btn-mic').addEventListener('click', () => toggleMic());
$('#btn-cam').addEventListener('click', () => toggleCam());
$('#in-vol').addEventListener('input', (e) => sfx.setVolume(Number(e.target.value)));
$('#in-vol').addEventListener('keydown', (e) => e.stopPropagation());

async function ensureLocalMedia() {
  if (mesh.localStream) return true;
  const ok = await enableMedia();
  if (ok) {
    hud.setStream(app.myId, mesh.localStream);
    for (const id of mesh.peers.keys()) mesh.addLocalTracks(mesh.peers.get(id).pc);
  }
  return ok;
}

async function toggleMic() {
  if (!(await ensureLocalMedia())) return;
  app.micOn = !app.micOn;
  mesh.setEnabled('audio', app.micOn);
  hud.localMicOn = app.micOn;
  updateMediaButtons();
  sendMedia();
}
async function toggleCam() {
  if (!(await ensureLocalMedia())) return;
  app.camOn = !app.camOn;
  mesh.setEnabled('video', app.camOn);
  hud.localCamOn = app.camOn;
  updateMediaButtons();
  sendMedia();
  hud.refreshTiles();
}
function updateMediaButtons() {
  $('#btn-mic').classList.toggle('off', !(app.micOn && mesh.hasTrack('audio')));
  $('#btn-cam').classList.toggle('off', !(app.camOn && mesh.hasTrack('video')));
  $('#btn-mic').textContent = app.micOn && mesh.hasTrack('audio') ? '🎙️' : '🔇';
}
function sendMedia() {
  net.send({ t: 'media', mic: app.micOn && mesh.hasTrack('audio'), cam: app.camOn && mesh.hasTrack('video') });
}

let toastTimer = null;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ game loop

function hitLabel(q, kind, power) {
  if (kind === 'block') return ['Abgeblockt!', ''];
  const loop = power >= P.FULL_POWER && q >= P.LOOP_Q;
  if (loop) return ['PERFEKT!', 'big'];
  if (power >= P.FULL_POWER) return ['Volle Ladung!', 'big'];
  if (power >= 0.6) return ['Kräftig!', ''];
  if (power >= 0.3) return ['Mittel', ''];
  return ['Stupser', ''];
}

function handleState(state, now, events) {
  // Round change
  if (state.roundId !== app.lastRoundId) {
    app.lastRoundId = state.roundId;
    app.lastLoops = state.loops; // don't celebrate loopings that happened before we looked
    app.seenHits.clear();
    hud.hideWinner();
  }

  // Phase transitions
  if (state.phase !== app.lastPhase) {
    if (state.phase === 'playing' && app.lastPhase === 'countdown') {
      hud.center('LOS!');
      sfx.beep(true);
      sfx.whoosh();
      app.goUntil = now + 0.9;
    }
    app.lastPhase = state.phase;
    if (app.lobby) hud.renderLobby(app.lobby, app.myId, state.phase);
  }

  // Countdown
  if (state.phase === 'countdown') {
    const remain = state.releaseT - now;
    const n = Math.ceil(remain);
    if (n > P.COUNTDOWN_SECS) hud.center('Achtung …', { small: true });
    else if (n >= 1) {
      if (app.countdownShown !== n) {
        app.countdownShown = n;
        sfx.beep(false);
      }
      hud.center(String(n));
    }
  } else if (state.phase === 'playing' && now < app.goUntil) {
    // keep "LOS!"
  } else {
    app.countdownShown = null;
    hud.center('');
  }

  // Hits
  const h = state.lastHit;
  if (h && now - h.t < 0.6) {
    const key = h.seat + ':' + h.pressT.toFixed(4);
    if (!app.seenHits.has(key)) {
      app.seenHits.add(key);
      world.hitEffect(h.q, h.kind);
      if (h.kind === 'block') sfx.block();
      else sfx.hit(h.q);
      if (h.seat === app.mySeat) {
        const [txt, cls] = hitLabel(h.q, h.kind, h.power ?? 0);
        const p = world.planeScreenPos();
        hud.popup(txt, p.x, p.y - 40, cls);
      }
      if (h.q > 0.85) hud.flashTile(h.seat, true);
    }
  }

  // Loopings
  if (state.loops > app.lastLoops) {
    app.lastLoops = state.loops;
    sfx.looping();
    const p = world.planeScreenPos();
    hud.popup('LOOPING!', p.x, p.y, 'big');
  }

  // Chickens knocked
  for (const ev of events) {
    if (ev.type !== 'knock') continue;
    sfx.knock();
    hud.flashTile(ev.seat);
    const c = hud.tileCenter(ev.seat) || world.seatScreenPos(ev.seat);
    hud.popup(ev.left > 0 ? '-1 🐔' : 'RAUS!', c.x, c.y, 'bad');
    if (ev.left === 0) {
      setTimeout(() => sfx.out(), 350);
      if (ev.seat === app.mySeat) setTimeout(() => toast('Alle Hühner weg – du bist raus! 🐔💨'), 400);
    }
  }

  hud.updateHens(state);
  updateTempo(state);
}

let lastTempoText = '';
function updateTempo(state) {
  const el = $('#tempo');
  const show = state.phase === 'playing';
  el.classList.toggle('hidden', !show);
  if (!show) return;
  const factor = state.omega / state.omega0;
  const text = '×' + factor.toFixed(1).replace('.', ',');
  if (text !== lastTempoText) {
    lastTempoText = text;
    el.querySelector('b').textContent = text;
    // green -> yellow -> red as the motor speeds up (red at x3)
    el.style.setProperty('--heat', String(Math.max(0, Math.round(120 - (factor - 1) * 60))));
  }
}

// Background demo while on the join screen: Larry flies around on his own.
let attract = null;
function attractState(now) {
  if (!attract) {
    attract = P.createState(now);
    attract.roundId = -99;
    attract.phase = 'playing';
    attract.releaseT = now;
    attract.phi = 0.4;
    for (const seat of attract.seats) {
      seat.occ = true;
      seat.chickens = P.START_CHICKENS;
    }
  }
  const s = attract;
  if (Math.abs(now - s.t) > 1) s.t = now - P.DT; // clock sync kicked in
  while (s.t + P.DT <= now) {
    P.step(s, null);
    s.omega = P.OMEGA_START;
    const pose = P.planePose(s);
    if (pose.h < 0.3 && Math.random() < 0.05) s.phiDot = 2 + Math.random() * 2.8;
  }
  return { state: s, rem: now - s.t };
}

let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const tNow = performance.now();
  const dt = Math.min(0.05, (tNow - last) / 1000);
  last = tNow;
  const now = net.serverNow();
  let { state, rem } = predictor.predict(now);
  const live = !!state;
  if (!state) ({ state, rem } = attractState(now));

  // Lever charging: auto-fire at full charge, show everybody's wind-up
  if (charge.active && now - charge.start >= P.CHARGE_MAX) fire(1);
  const charges = {};
  if (live) {
    for (const [seat, st] of Object.entries(predictor.charging)) {
      if (Number(seat) !== app.mySeat) charges[seat] = Math.min(1, Math.max(0, (now - st) / P.CHARGE_MAX));
    }
  }
  if (charge.active) charges[app.mySeat] = chargeLevel(now);
  const events = world.update(state, rem, dt, charges);
  hud.chargeMeter(charge.active ? chargeLevel(now) : -1, charge.active ? world.leverScreenPos(app.mySeat) : null);
  if (charge.active) sfx.chargeUpdate(chargeLevel(now));
  if (live) {
    handleState(state, now, events);
    const pose = P.planePose(state);
    const cam = world.camera.position;
    const dist = Math.hypot(pose.x - cam.x, pose.h - cam.y, pose.z - cam.z);
    sfx.updateMotor(state.omega, Math.max(0, Math.min(1, (13.5 - dist) / 4)), state.phase === 'playing');
  }
  if (app.joined) hud.updateSpeaking();
  netInfo();
}

let lastInfo = 0;
function netInfo() {
  const t = performance.now();
  if (t - lastInfo < 1000 || !app.joined) return;
  lastInfo = t;
  $('#net-info').textContent = `Ping ${Math.round(net.rtt * 1000)} ms`;
}

requestAnimationFrame(frame);
