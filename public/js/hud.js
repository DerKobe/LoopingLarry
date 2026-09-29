// DOM overlay: video tiles around the table, lobby panel, messages.
import { SEAT_CSS } from './models.js';
import * as P from '/shared/physics.js';

const $ = (sel) => document.querySelector(sel);
const SPECTATOR_CSS = '#8d99ae';

// Where the other stations appear from my point of view (seat + k, k = 1..n-1).
// The camera sits behind my own station, so seat + 1 is on the left.
const LAYOUTS = {
  2: ['top'],
  3: ['left', 'right'],
  4: ['left', 'top', 'right'],
  5: ['left', 'topleft', 'topright', 'right'],
};
const POSITIONS = ['self', 'left', 'top', 'right', 'topleft', 'topright', 'spec'];

export class Hud {
  constructor() {
    this.tiles = new Map(); // playerId -> { el, video, avatar, seat, ... }
    this.players = [];
    this.n = P.DEFAULT_SEATS;
    this.mySeat = -1;
    this.myId = null;
    this.streams = new Map(); // playerId -> MediaStream
    this.analysers = new Map(); // playerId -> { analyser, data }
    this.audioCtx = null;
    this.centerText = '';
  }

  setAudioContext(ctx) {
    this.audioCtx = ctx;
  }

  // ---------------------------------------------------------------- tiles

  setPlayers(players, myId, n) {
    this.players = players;
    this.myId = myId;
    this.n = n;
    const me = players.find((p) => p.id === myId);
    this.mySeat = me ? me.seat : -1;
    for (const p of players) {
      let tile = this.tiles.get(p.id);
      if (!tile) {
        tile = this.createTile(p);
        this.tiles.set(p.id, tile);
      }
      this.updateTile(tile, p);
    }
    const ids = new Set(players.map((p) => p.id));
    for (const [id, tile] of this.tiles) {
      if (!ids.has(id)) {
        tile.el.remove();
        this.tiles.delete(id);
      }
    }
  }

  tileBySeat(seat) {
    for (const tile of this.tiles.values()) if (tile.seat === seat) return tile;
    return null;
  }

  createTile(p) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.innerHTML = `
      <video autoplay playsinline></video>
      <div class="avatar"></div>
      <div class="flash"></div>
      <div class="stamp">RAUS!</div>
      <div class="badges"></div>
      <div class="nameplate"><span class="nm"></span><span class="hens"></span></div>`;
    const tile = {
      el,
      playerId: p.id,
      seat: p.seat,
      video: el.querySelector('video'),
      avatar: el.querySelector('.avatar'),
      flash: el.querySelector('.flash'),
      badges: el.querySelector('.badges'),
      name: el.querySelector('.nm'),
      hens: el.querySelector('.hens'),
      henCount: -1,
      stream: null,
    };
    if (p.id === this.myId) {
      tile.video.muted = true;
      el.classList.add('self');
    }
    const s = this.streams.get(p.id);
    if (s) this.attachStream(tile, s);
    return tile;
  }

  positionFor(p) {
    if (p.seat < 0) return 'spec';
    if (p.id === this.myId) return 'self';
    if (this.mySeat < 0) {
      // spectating: show the stations as seen from seat 0
      return p.seat === 0 ? 'self' : LAYOUTS[this.n][p.seat - 1];
    }
    const k = (p.seat - this.mySeat + this.n) % this.n;
    return LAYOUTS[this.n][k - 1] || 'spec';
  }

  updateTile(tile, p) {
    if (tile.seat !== p.seat) tile.henCount = -1;
    tile.seat = p.seat;
    const pos = this.positionFor(p);
    for (const x of POSITIONS) tile.el.classList.toggle('pos-' + x, x === pos);
    const parent = pos === 'spec' ? $('#spectators') : $('#tiles');
    if (tile.el.parentElement !== parent) parent.appendChild(tile.el);
    tile.el.style.setProperty('--seat', p.seat >= 0 ? SEAT_CSS[p.seat] : SPECTATOR_CSS);
    tile.el.classList.toggle('spectator', p.seat < 0);
    tile.name.textContent = p.id === this.myId ? `${p.name} (du)` : p.name;
    tile.avatar.textContent = p.bot ? '🤖' : (p.name[0] || '?').toUpperCase();
    const hasVideo = !!(tile.stream && tile.stream.getVideoTracks().length);
    const camOn = p.id === this.myId ? this.localCamOn : p.media.cam;
    tile.video.style.visibility = hasVideo && camOn ? 'visible' : 'hidden';
    tile.avatar.style.display = hasVideo && camOn ? 'none' : 'flex';
    const badges = [];
    if (p.seat < 0) badges.push('👀');
    if (p.score) badges.push(`🏆 ${p.score}`);
    if (!p.bot && !p.media.mic) badges.push('🔇');
    tile.badges.innerHTML = badges.map((b) => `<span>${b}</span>`).join('');
    if (p.seat < 0) tile.hens.innerHTML = '<small>schaut zu</small>';
  }

  refreshTiles() {
    for (const p of this.players) {
      const tile = this.tiles.get(p.id);
      if (tile) this.updateTile(tile, p);
    }
  }

  setStream(playerId, stream) {
    this.streams.set(playerId, stream);
    for (const tile of this.tiles.values()) {
      if (tile.playerId === playerId) this.attachStream(tile, stream);
    }
    this.setupAnalyser(playerId, stream);
    this.refreshTiles();
  }

  attachStream(tile, stream) {
    if (tile.stream === stream && tile.video.srcObject === stream) return;
    tile.stream = stream;
    tile.video.srcObject = stream;
    tile.video.play().catch(() => {});
  }

  removeStream(playerId) {
    this.streams.delete(playerId);
    this.analysers.delete(playerId);
  }

  setupAnalyser(playerId, stream) {
    if (!this.audioCtx || !stream.getAudioTracks().length) return;
    const existing = this.analysers.get(playerId);
    if (existing && existing.stream === stream) return;
    try {
      const src = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this.analysers.set(playerId, { stream, analyser, data: new Uint8Array(analyser.fftSize), level: 0 });
    } catch (e) {
      console.warn('analyser', e);
    }
  }

  updateSpeaking() {
    for (const tile of this.tiles.values()) {
      const a = this.analysers.get(tile.playerId);
      if (!a) {
        tile.el.classList.remove('speaking');
        continue;
      }
      a.analyser.getByteTimeDomainData(a.data);
      let sum = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const v = (a.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / (a.data.length / 4));
      a.level = Math.max(rms, a.level * 0.9);
      const muted = tile.playerId === this.myId ? !this.localMicOn : false;
      tile.el.classList.toggle('speaking', !muted && a.level > 0.04);
    }
  }

  updateHens(state) {
    for (const tile of this.tiles.values()) {
      if (tile.seat < 0 || tile.seat >= state.n) continue;
      const seat = state.seats[tile.seat];
      const n = seat.chickens;
      const inRound = state.phase === 'lobby' || seat.active;
      const shown = inRound ? n : -2;
      if (shown !== tile.henCount) {
        tile.henCount = shown;
        if (!inRound) tile.hens.innerHTML = '<small>wartet</small>';
        else {
          let html = '';
          for (let i = 0; i < P.START_CHICKENS; i++) html += `<span class="${i < n ? '' : 'lost'}">🐔</span>`;
          tile.hens.innerHTML = html;
        }
      }
      tile.el.classList.toggle('out', (state.phase === 'playing' || state.phase === 'ended') && seat.active && n <= 0);
    }
  }

  flashTile(seat, gold = false) {
    const tile = this.tileBySeat(seat);
    if (!tile) return;
    tile.flash.classList.toggle('gold', gold);
    tile.flash.classList.remove('go');
    void tile.flash.offsetWidth;
    tile.flash.classList.add('go');
    if (!gold) {
      tile.el.classList.remove('hit');
      void tile.el.offsetWidth;
      tile.el.classList.add('hit');
    }
  }

  emote(playerId, e) {
    const tile = this.tiles.get(playerId);
    if (!tile) return;
    const d = document.createElement('div');
    d.className = 'emote';
    d.textContent = e;
    tile.el.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }

  tileCenter(seat) {
    const tile = this.tileBySeat(seat);
    if (!tile) return null;
    const r = tile.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 };
  }

  // ---------------------------------------------------------------- charge meter

  // level < 0 hides the meter
  chargeMeter(level, pos) {
    const el = $('#charge-meter');
    if (level < 0 || !pos) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    el.style.setProperty('--p', (level * 100).toFixed(1));
    el.style.setProperty('--hue', String(Math.round(120 - level * 120)));
    el.classList.toggle('full', level >= P.FULL_POWER);
    el.querySelector('span').textContent = level >= P.FULL_POWER ? 'MAX' : Math.round(level * 100) + '%';
  }

  // ---------------------------------------------------------------- messages

  popup(text, x, y, cls = '') {
    const d = document.createElement('div');
    d.className = 'popup ' + cls;
    d.textContent = text;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    $('#popups').appendChild(d);
    setTimeout(() => d.remove(), 1350);
  }

  center(text, { pop = true, small = false } = {}) {
    const el = $('#center-msg');
    if (text === this.centerText) return;
    this.centerText = text;
    el.textContent = text;
    el.classList.toggle('small', small);
    el.classList.remove('pop');
    if (pop && text) {
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  showWinner(name, seat) {
    const w = $('#winner');
    w.classList.remove('hidden');
    w.querySelector('.winner-card').style.setProperty('--seat', seat >= 0 ? SEAT_CSS[seat] : '#ffb703');
    $('#winner-text').textContent = name ? `${name} gewinnt!` : 'Unentschieden!';
    $('#winner-sub').textContent = seat === this.mySeat ? 'Deine Hühner sind die Helden des Hofes 🐔✨' : 'Gleich geht’s weiter …';
  }

  hideWinner() {
    $('#winner').classList.add('hidden');
  }

  // ---------------------------------------------------------------- lobby

  renderLobby(info, myId, phase) {
    const panel = $('#lobby-panel');
    const show = phase === 'lobby';
    panel.classList.toggle('hidden', !show);
    if (!show) return;
    const isHost = info.hostId === myId;
    const host = info.players.find((p) => p.id === info.hostId);
    const n = info.n;

    // Player count selector (host only)
    for (const b of document.querySelectorAll('#seat-count button')) {
      const v = Number(b.dataset.n);
      b.classList.toggle('active', v === n);
      b.disabled = !isHost;
    }

    const list = $('#lobby-players');
    list.innerHTML = '';
    for (let seat = 0; seat < n; seat++) {
      const p = info.players.find((x) => x.seat === seat);
      const li = document.createElement('li');
      if (!p) {
        li.className = 'empty';
        li.innerHTML = `<span class="dot" style="background:${SEAT_CSS[seat]}"></span><span class="nm">freier Platz</span>`;
      } else {
        const tags = [];
        if (p.id === myId) tags.push('du');
        if (p.id === info.hostId) tags.push('Host');
        if (p.bot) tags.push('Bot');
        li.innerHTML = `<span class="dot" style="background:${SEAT_CSS[seat]}"></span><span class="nm"></span><span class="tag">${tags.join(' · ')}</span>`;
        li.querySelector('.nm').textContent = p.name;
        if (p.bot && isHost) {
          const b = document.createElement('button');
          b.className = 'rm';
          b.textContent = '✕';
          b.title = 'Bot entfernen';
          b.dataset.seat = seat;
          li.appendChild(b);
        }
      }
      list.appendChild(li);
    }
    const watchers = info.players.filter((p) => p.seat < 0);
    const spec = $('#lobby-spectators');
    spec.classList.toggle('hidden', !watchers.length);
    spec.textContent = watchers.length ? `👀 Zuschauer: ${watchers.map((p) => p.name).join(', ')}` : '';

    const seated = info.players.filter((p) => p.seat >= 0).length;
    const free = n - seated;
    $('#btn-bot').classList.toggle('hidden', !isHost);
    $('#btn-bot').disabled = free <= 0;
    $('#btn-start').classList.toggle('hidden', !isHost);
    $('#btn-start').disabled = free > 0;
    $('#lobby-title').textContent = free > 0 ? `Warte auf Mitspieler … (${seated}/${n})` : 'Bereit zum Abheben!';
    let hint;
    if (!isHost) hint = `Warte, bis ${host ? host.name : 'der Host'} die Runde startet.`;
    else if (free > 0) hint = `Noch ${free === 1 ? 'ein Platz' : free + ' Plätze'} frei – auf Freunde warten, Bot hinzufügen oder weniger Spieler wählen.`;
    else if (watchers.length) hint = 'Alle Plätze besetzt – für mehr Mitspieler die Spielerzahl erhöhen.';
    else hint = 'Alle da? Dann los!';
    $('#lobby-hint').textContent = hint;
  }
}
