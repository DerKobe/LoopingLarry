// Looping Larry – HTTP(S) + WebSocket server.
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, serverNow } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
let iceServers = DEFAULT_ICE;
if (process.env.ICE_SERVERS) {
  try {
    iceServers = JSON.parse(process.env.ICE_SERVERS);
  } catch (e) {
    console.warn('ICE_SERVERS is not valid JSON – using default STUN servers');
  }
}

const app = express();
app.use(express.static(path.join(root, 'public')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three')));
app.get('/health', (req, res) => res.json({ ok: true, players: farm.clients.size, phase: farm.state.phase }));

let server;
if (process.env.SSL_KEY && process.env.SSL_CERT) {
  server = https.createServer({ key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) }, app);
} else {
  server = http.createServer(app);
}

// There is exactly one farm – everybody who opens the page plays together.
const farm = new Room('HOF');
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

function cleanName(n) {
  n = String(n || '').replace(/[<>\n\r\t]/g, '').trim().slice(0, 16);
  return n || 'Pilot';
}

wss.on('connection', (ws) => {
  const id = crypto.randomUUID().slice(0, 8);
  let room = null;
  let client = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: msg.c, s: serverNow() }));
      return;
    }

    if (msg.t === 'join') {
      if (client) return;
      const res = farm.addClient(ws, id, cleanName(msg.name));
      if (res.error) {
        ws.send(JSON.stringify({ t: 'error', message: res.error }));
        return;
      }
      room = farm;
      client = res.client;
      const peers = [...room.clients.values()].filter((c) => c.id !== id).map((c) => c.id);
      ws.send(JSON.stringify({ t: 'welcome', id, seat: client.seat, peers, iceServers }));
      room.broadcast({ t: 'peer-joined', id, name: client.name });
      room.sendLobby();
      room.broadcastSnapshot();
      return;
    }

    if (room && client) room.handle(client, msg);
  });

  ws.on('close', () => {
    if (room && client) room.removeClient(client.id);
  });
});

// Drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.listen(PORT, () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`Looping Larry läuft auf ${proto}://localhost:${PORT}`);
});

// Graceful shutdown (Docker/Dokku send SIGTERM when replacing the container)
function shutdown(signal) {
  console.log(`${signal} erhalten – fahre herunter …`);
  for (const ws of wss.clients) ws.close(1012, 'Server-Neustart');
  farm.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
