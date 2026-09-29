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
  room: null,
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

const params = new URLSearchParams(location.search);
$('#in-room').value = (params.get('room') || '').toUpperCase();
$('#in-name').value = localStorage.getItem('ll-name') || '';
if ($('#in-room').value) $('#btn-join').textContent = 'Raum beitreten ✈️';

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

function randomRoom() {
  const words = ['HUHN', 'EI', 'LARRY', 'HOF', 'FARM', 'FLUG', 'GACK'];
  return words[Math.floor(Math.random() * words.length)] + Math.floor(10 + Math.random() * 89);
}

$('#join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#in-name').value.trim() || 'Pilot';
  let room = $('#in-room').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!room) room = randomRoom();
  localStorage.setItem('ll-name', name);
  $('#btn-join').disabled = true;
  $('#join-error').textContent = '';
  sfx.init();
  hud.setAudioContext(sfx.ctx);
  if (!mesh.localStream) await enableMedia();
  try {
    if (!net.ws || net.ws.readyState > 1) await net.connect();
    net.send({ t: 'join', room, name });
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
  app.room = m.room;
  predictor.mySeat = m.seat;
  world.roundId = -1; // leave the demo: rebuild chickens from the real state
  $('#join').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#room-code').textContent = m.room;
  history.replaceState(null, '', `?room=${m.room}`);
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
    app.mySeat = me.seat;
    predictor.mySeat = me.seat;
  }
  hud.setPlayers(info.players, app.myId);
  world.setSeatInfo(info.players, app.mySeat);
  hud.renderLobby(info, app.myId, info.phase);
});

net.addEventListener('s', (e) => predictor.addSnapshot(e.detail.s));

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

net.addEventListener('emote', (e) => hud.emote(e.detail.seat, e.detail.e));

net.addEventListener('close', () => {
  if (app.joined) {
    toast('Verbindung verloren – lade neu …');
    setTimeout(() => location.reload(), 2500);
  }
});

mesh.addEventListener('stream', (e) => hud.setStream(e.detail.id, e.detail.stream));

// ------------------------------------------------------------------ controls

function flip() {
  if (!app.joined || app.mySeat < 0) return;
  const now = net.serverNow();
  if (!predictor.canPress(now)) return;
  predictor.press(now);
  net.send({ t: 'flip', st: now });
  sfx.lever();
}

const EMOTES = ['👍', '😂', '😱', '😡'];
window.addEventListener('keydown', (e) => {
  if (!app.joined) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    if (!e.repeat) flip();
  } else if (e.code === 'KeyM') toggleMic();
  else if (e.code === 'KeyV') toggleCam();
  else if (/^Digit[1-4]$/.test(e.code) && !e.repeat) {
    net.send({ t: 'emote', e: EMOTES[Number(e.code.slice(5)) - 1] });
  }
});
$('#game').addEventListener('mousedown', (e) => {
  if (e.button === 0) flip();
});
$('#tiles').addEventListener('mousedown', (e) => {
  if (e.button === 0) flip();
});

$('#btn-start').addEventListener('click', () => net.send({ t: 'start' }));
$('#btn-bot').addEventListener('click', () => net.send({ t: 'addBot' }));
$('#lobby-players').addEventListener('click', (e) => {
  const b = e.target.closest('.rm');
  if (b) net.send({ t: 'removeBot', seat: Number(b.dataset.seat) });
});
$('#btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${app.room}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Einladungslink kopiert 📋');
  } catch {
    prompt('Link zum Teilen:', url);
  }
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

function hitLabel(q, kind) {
  if (kind === 'block') return ['Abgeblockt!', ''];
  if (q > 0.85) return ['PERFEKT!', 'big'];
  if (q > 0.6) return ['Stark!', ''];
  if (q > 0.3) return ['Gut!', ''];
  return ['Knapp!', ''];
}

function handleState(state, now, events) {
  // Round change
  if (state.roundId !== app.lastRoundId) {
    app.lastRoundId = state.roundId;
    app.lastLoops = 0;
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
        const [txt, cls] = hitLabel(h.q, h.kind);
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
  const events = world.update(state, rem, dt);
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
