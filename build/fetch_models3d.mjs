// Fetches the 3D models into dist/models3d/ (they are not in git, to keep the clone small).
//
//   node build/fetch_models3d.mjs           download the release named in build/models3d.json
//   node build/fetch_models3d.mjs --pack    pack dist/models3d/ into dist/models3d.tar.gz to
//                                           upload as a new release (see README, "3D models")
//
// The models are a .tar.gz on a GitHub release; `tar` ships with macOS, Linux and Windows 10+.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'build/models3d.json'), 'utf8'));

if (process.argv.includes('--pack')) {
  const out = path.join(dist, cfg.asset);
  execFileSync('tar', ['-czf', out, '-C', dist, 'models3d'], { stdio: 'inherit' });
  console.log(`${path.relative(root, out)} ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
  process.exit(0);
}

const url = process.env.MODELS3D_URL ||
  `https://github.com/${cfg.repo}/releases/download/${cfg.tag}/${cfg.asset}`;
console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) { console.error(`Download failed: HTTP ${res.status}`); process.exit(1); }
const tmp = path.join(os.tmpdir(), `pokeball-${process.pid}-${cfg.asset}`);
fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
try {
  fs.rmSync(path.join(dist, 'models3d'), { recursive: true, force: true });
  execFileSync('tar', ['-xzf', tmp, '-C', dist], { stdio: 'inherit' });
} finally {
  fs.rmSync(tmp, { force: true });
}
const n = fs.readdirSync(path.join(dist, 'models3d')).length;
console.log(`dist/models3d/: ${n} files (${cfg.tag})`);
