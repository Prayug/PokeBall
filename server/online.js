// The server plus a public link, so friends can join from anywhere, not only this computer.
//   npm run online
// It starts the server, then opens a free Cloudflare quick tunnel to it and prints the
// https://….trycloudflare.com address. Room links on the page use that address.
// The tunnel lasts as long as this process; a restart gives a new address.
import { spawn } from 'node:child_process';
import { listen } from './index.js';
import { setPublicUrl } from './sim.js';

const port = Number(process.env.PORT) || 8787;
process.on('uncaughtException', (err) => console.error('uncaught:', err?.stack || err));
process.on('unhandledRejection', (err) => console.error('unhandled:', err?.stack || err));

async function cloudflaredBin() {
  try {
    const cf = await import('cloudflared');
    const fs = await import('node:fs');
    if (!fs.existsSync(cf.bin)) { console.log('Downloading cloudflared (one time)…'); await cf.install(cf.bin); }
    return cf.bin;
  } catch {
    return 'cloudflared'; // installed on the system instead
  }
}

const server = await listen(port).catch((err) => {
  console.error(err?.code === 'EADDRINUSE' ? `Port ${port} is in use. Stop the other server or set PORT.` : err);
  process.exit(1);
});
console.log(`PokeBall server on http://localhost:${port}`);

let tunnel = null;
let tries = 0;
async function openTunnel() {
  const bin = await cloudflaredBin();
  tunnel = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const read = (buf) => {
    const m = String(buf).match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
    if (m) {
      tries = 0;
      setPublicUrl(m[0]);
      console.log(`\n  Public link: ${m[0]}\n  Open it, start a room, and send your friends the room link.\n`);
    }
  };
  tunnel.stdout.on('data', read);
  tunnel.stderr.on('data', read);
  tunnel.on('error', (err) => {
    console.error(err.code === 'ENOENT' ? 'cloudflared is missing. Run npm install, or install cloudflared, then try again.' : err);
  });
  tunnel.on('exit', (code) => {
    setPublicUrl(null);
    if (stopping) return;
    if (++tries > 5) { console.error('The public link keeps failing. The server still works on this computer.'); return; }
    console.log(`The tunnel closed (${code}). Opening a new one…`);
    setTimeout(openTunnel, 2000 * tries);
  });
}
let stopping = false;
const stop = () => {
  stopping = true;
  console.log('saving leagues and stopping');
  try { tunnel?.kill(); } catch { /* gone */ }
  server.closeAll();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
openTunnel();
