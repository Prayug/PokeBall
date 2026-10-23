// A tiny WebSocket server for text frames. The game server speaks JSON and nothing else.
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function acceptKey(key) {
  return createHash('sha1').update(String(key) + GUID).digest('base64');
}

export function handshake(socket, key) {
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
    + acceptKey(key) + '\r\n\r\n',
  );
}

// The page only sends small JSON; anything bigger is a broken or hostile client.
const MAX_FRAME = 1_000_000;
// A client this far behind on reading is not keeping up; drop it rather than buffer forever.
const MAX_BACKLOG = 8_000_000;

// Read masked or unmasked frames off a socket. `onMsg` gets a string. Close and errors call
// `onClose` once. `onAny` hears every frame, pongs included (the heartbeat).
export function readFrames(socket, onMsg, onClose, onAny = () => {}) {
  let buf = Buffer.alloc(0);
  let frags = [];
  let closed = false;
  const done = () => { if (closed) return; closed = true; onClose(); };
  socket.on('data', (chunk) => {
    if (closed) return;
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_FRAME + 16) { socket.destroy(); done(); return; }
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const n = buf.readBigUInt64BE(2);
        if (n > BigInt(MAX_FRAME)) { socket.destroy(); done(); return; }
        len = Number(n); off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      off += maskLen;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);
      onAny(op);
      if (op === 0x8) { sendFrame(socket, payload.subarray(0, 2), 0x8); try { socket.end(); } catch { /* already gone */ } done(); return; }
      if (op === 0x9) { sendFrame(socket, payload, 0xA); continue; }
      if (op === 0xA) continue;
      if (op === 0x1) frags = [payload];
      else if (op === 0x0) { frags.push(payload); if (frags.reduce((n, f) => n + f.length, 0) > MAX_FRAME) { socket.destroy(); done(); return; } }
      else continue;
      if (fin) {
        const text = Buffer.concat(frags).toString('utf8');
        frags = [];
        if (text.length > MAX_FRAME) { socket.destroy(); done(); return; }
        onMsg(text);
      }
    }
  });
  socket.on('close', done);
  socket.on('error', done);
}

export function sendFrame(socket, data, op = 0x1) {
  if (!socket || socket.destroyed || !socket.writable) return;
  if (socket.writableLength > MAX_BACKLOG) { socket.destroy(); return; }
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  try { socket.write(Buffer.concat([head, payload])); } catch { /* the close handler finishes it */ }
}

export function sendText(socket, value) {
  sendFrame(socket, typeof value === 'string' ? value : JSON.stringify(value));
}
