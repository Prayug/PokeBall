// One process for friends: the page, the websocket, and the rooms.
//   node server/index.js
// Then open http://localhost:8787. A GitHub Pages build can point here with
// POKEBALL_SERVER or with ?server=ws://host:8787 on the address.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { broadcast, dropClient, hello, loadLeagues, onMessage, rooms, snapRoom, stepRoom, addClient, createOnlineLeague, createQuick, resumeClient } from './sim.js';
import { handshake, readFrames, sendText } from './ws.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function safeFile(urlPath) {
  let rel;
  try { rel = decodeURIComponent((urlPath || '/').split('?')[0]); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel.startsWith('/booth/')) {
    const boothRoot = path.join(root, 'booth') + path.sep;
    const distBooth = path.join(dist, 'booth') + path.sep;
    const p = path.normalize(path.join(root, rel));
    if (p.startsWith(boothRoot) || p.startsWith(distBooth)) return fs.existsSync(p) ? p : path.join(dist, rel);
  }
  const base = rel === '/' ? '/index.html' : rel;
  const p = path.normalize(path.join(dist, base));
  if (!p.startsWith(dist + path.sep) && p !== path.join(dist, 'index.html')) return null;
  return p;
}

function listExt(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(ext));
}
function boothIndex() {
  const names = new Set([...listExt(path.join(root, 'booth'), '.mp3'), ...listExt(path.join(dist, 'booth'), '.mp3')]);
  return JSON.stringify([...names]);
}
function modelIndex() {
  return JSON.stringify(listExt(path.join(dist, 'models3d'), '.js'));
}

function serve(req, res) {
  try {
    const pathOnly = (req.url || '/').split('?')[0];
    if (pathOnly === '/booth/index.json' || pathOnly === '/models3d/index.json') {
      const body = pathOnly.startsWith('/booth/') ? boothIndex() : modelIndex();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(body);
      return;
    }
    const file = safeFile(req.url);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found. Build the page with npm run build, then open this server again.');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
    res.on('error', () => stream.destroy());
    stream.pipe(res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
    } else res.destroy();
  }
}

function attach(socket, req) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  handshake(socket, key);
  let client = null, room = null;
  readFrames(socket, (text) => {
    try {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (!client) {
        if (msg.t === 'create') {
          room = msg.mode === 'league' ? createOnlineLeague(msg.setup || {}) : createQuick(msg.name);
          client = addClient(room, msg.name);
        } else if (msg.t === 'join' || msg.t === 'resume') {
          room = rooms.get(String(msg.code || '').toUpperCase());
          if (!room) { sendText(socket, { t: 'err', text: 'No room with that code.' }); return; }
          client = msg.t === 'resume' && msg.token ? resumeClient(room, msg.token) : null;
          if (!client) client = addClient(room, msg.name);
        } else return;
        if (!client) { sendText(socket, { t: 'err', text: 'That room is full.' }); room = null; return; }
        client.online = true;
        client.send = (s) => sendText(socket, s);
        hello(room, client);
        return;
      }
      onMessage(room, client, msg);
    } catch (err) {
      console.error(err);
      try { sendText(socket, { t: 'err', text: 'The server hit an error on that.' }); } catch { /* socket already gone */ }
    }
  }, () => { if (client && room) dropClient(room, client); });
}

export function listen(port = Number(process.env.PORT) || 8787, host = '0.0.0.0') {
  loadLeagues();
  const server = http.createServer(serve);
  server.on('upgrade', (req, socket) => attach(socket, req));
  const timer = setInterval(() => {
    for (const room of rooms.values()) {
      try {
        stepRoom(room);
        const snap = snapRoom(room);
        if (snap) broadcast(room, snap);
      } catch (err) { console.error(room?.code, err); }
    }
  }, 1000 / 60);
  server.closeAll = () => { clearInterval(timer); server.close(); };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const ranDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ranDirect) {
  const port = Number(process.env.PORT) || 8787;
  listen(port).then((server) => {
    const addr = server.address();
    console.log(`PokeBall server on http://localhost:${addr.port}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
