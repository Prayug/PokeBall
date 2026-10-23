// One process for friends: the page, the websocket, and the rooms.
//   node server/index.js
// Then open http://localhost:8787. A GitHub Pages build can point here with
// POKEBALL_SERVER or with ?server=ws://host:8787 on the address.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addClient, canOpenRoom, createOnlineLeague, createQuick, dropClient, hello, loadLeagues, onMessage, resumeClient, roomCount, rooms, saveAll, sweep, tick } from './sim.js';
import { handshake, readFrames, sendFrame, sendText } from './ws.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
};
// A socket that has sent nothing (not even the page's ping) for this long is gone.
const IDLE_MS = 30_000;
const TICK_MS = 1000 / 60;

function safeFile(urlPath) {
  let rel;
  try { rel = decodeURIComponent(String(urlPath || '/').split('?')[0].split('#')[0]); } catch { return null; }
  if (rel.includes('\0')) return null;
  if (rel.startsWith('/booth/')) {
    const p = path.normalize(path.join(root, rel));
    if (p.startsWith(path.join(root, 'booth') + path.sep) && fs.existsSync(p)) return p;
  }
  const base = rel === '/' || rel === '' ? '/index.html' : rel;
  const p = path.normalize(path.join(dist, base));
  if (p !== dist && !p.startsWith(dist + path.sep)) return null;
  return p;
}

function serve(req, res) {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: roomCount(), uptime: Math.round(process.uptime()) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return;
  }
  const file = safeFile(req.url);
  let stat = null;
  try { stat = file && fs.statSync(file); } catch { stat = null; }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(file && file.endsWith('index.html') ? 'Not found. Build the page with npm run build, then open this server again.' : 'Not found.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const sockets = new Set();

function attach(socket, req) {
  socket.on('error', () => { /* readFrames' close handler cleans up */ });
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return;
  }
  handshake(socket, key);
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 15_000);
  socket.seen = Date.now();
  sockets.add(socket);
  let client = null, room = null;
  const reply = (msg) => sendText(socket, msg);
  readFrames(socket, (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    try {
      if (!client) {
        if (msg.t === 'ping') { reply({ t: 'pong', n: Number(msg.n) || 0 }); return; }
        if (msg.t === 'create') {
          if (!canOpenRoom()) { reply({ t: 'err', text: 'The server is full right now. Try again in a few minutes.' }); return; }
          room = msg.mode === 'league' ? createOnlineLeague(msg.setup || {}) : createQuick(msg.name);
          client = addClient(room, msg.name);
        } else if (msg.t === 'join' || msg.t === 'resume') {
          room = rooms.get(String(msg.code || '').toUpperCase().slice(0, 12)) ?? null;
          if (!room) { reply({ t: 'err', code: 'noroom', text: 'No room with that code. It may have closed; start a new one.' }); return; }
          client = msg.t === 'resume' ? resumeClient(room, msg.token) : null;
          if (!client) client = addClient(room, msg.name);
        } else return;
        if (!client) { reply({ t: 'err', code: 'full', text: 'That room is full.' }); room = null; return; }
        // Back on a new socket: the old one is stale, so close it without dropping the seat.
        if (client.socket && client.socket !== socket) {
          const old = client.socket;
          client.socket = null;
          try { old.destroy(); } catch { /* already gone */ }
        }
        client.socket = socket;
        client.online = true;
        client.send = (s) => sendText(socket, s);
        hello(room, client);
        return;
      }
      onMessage(room, client, msg);
    } catch (err) {
      console.error(`message ${msg?.t} in room ${room?.code}:`, err?.stack || err);
      reply({ t: 'err', text: 'The server could not do that. Try again.' });
    }
  }, () => {
    sockets.delete(socket);
    // Only the socket that holds the seat drops it; a stale one closing late does nothing.
    if (client && room && client.socket === socket) {
      client.socket = null;
      try { dropClient(room, client); } catch (err) { console.error('drop:', err?.stack || err); }
    }
  }, () => { socket.seen = Date.now(); });
}

export function listen(port = Number(process.env.PORT) || 8787, host = '0.0.0.0') {
  loadLeagues();
  const server = http.createServer(serve);
  server.on('upgrade', (req, socket) => attach(socket, req));
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ } });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      try { tick(room, now); } catch (err) { console.error(`room ${room.code}:`, err?.stack || err); }
    }
  }, TICK_MS);
  // Ping every socket; one that has gone quiet (a closed laptop, a dropped phone) is closed so its
  // seat shows as disconnected and the game pauses instead of waiting forever.
  const beat = setInterval(() => {
    const now = Date.now();
    for (const s of sockets) {
      if (now - (s.seen || 0) > IDLE_MS) { s.destroy(); continue; }
      sendFrame(s, Buffer.alloc(0), 0x9);
    }
    sweep(now);
  }, 10_000);
  server.closeAll = () => {
    clearInterval(timer);
    clearInterval(beat);
    saveAll();
    for (const s of sockets) s.destroy();
    server.close();
  };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

const ranDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ranDirect) {
  const port = Number(process.env.PORT) || 8787;
  // A bug in one room is logged, not fatal: friends in other rooms keep playing.
  process.on('uncaughtException', (err) => console.error('uncaught:', err?.stack || err));
  process.on('unhandledRejection', (err) => console.error('unhandled:', err?.stack || err));
  listen(port).then((server) => {
    const addr = server.address();
    console.log(`PokeBall server on http://localhost:${addr.port}`);
    const stop = () => { console.log('saving leagues and stopping'); server.closeAll(); setTimeout(() => process.exit(0), 300).unref(); };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }, (err) => {
    console.error(err?.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other server or set PORT.` : err);
    process.exit(1);
  });
}
