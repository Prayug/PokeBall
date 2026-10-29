// The title screen's stadium: the same field the game plays on, with six Pokémon standing
// on it. It is a menu scene, not a second game. Leaving the page throws the renderer away.
import * as THREE from 'three';
import { Stadium } from '../stadium3d.js';
import { PLAYERS } from '../ratings.js';
import { hasModel, modelTemplate, makeModelFigure, disposeModelFigure, driveLimbs } from '../model3d.js';
import { updateBlink } from '../blink.js';
import { reduceMotion } from '../state.js';

const SHOWCASE = [130, 248, 135, 65, 448, 445];
const SPOTS = [[38, -8], [46, -3], [54, 2], [62, 8], [44, 8], [58, -9]];

let live = null;

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function paintBoard(stadium) {
  const c = stadium.boardCanvas, x = c.getContext('2d');
  const W = c.width, H = c.height;
  x.fillStyle = '#070b14'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e5402b'; x.fillRect(0, 0, W, 10); x.fillRect(0, H - 10, W, 10);
  x.fillStyle = '#d4a017'; x.fillRect(0, 10, W, 4);
  x.fillStyle = '#ffffff'; x.font = '800 72px "Barlow Condensed", Arial Narrow, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('POKEBALL', W / 2, H / 2 - 8);
  x.fillStyle = '#d4a017'; x.font = '700 28px "Barlow Condensed", Arial Narrow, Arial, sans-serif';
  x.fillText('POKEMON FOOTBALL', W / 2, H - 36);
  x.fillStyle = 'rgba(0,0,0,0.28)';
  for (let i = 0; i < W; i += 4) x.fillRect(i, 0, 1, H);
  stadium.boardTex.needsUpdate = true;
  stadium.boardKey = 'menu';
}

function addTunnels(root) {
  const wall = new THREE.MeshStandardMaterial({ color: '#12161e', roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: '#05070c', roughness: 1 });
  for (const s of [-1, 1]) {
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(9, 4.4, 3.2), dark);
    mouth.position.set(16, 2.2, s * 39);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(11, 5.2, 0.6), wall);
    arch.position.set(16, 2.5, s * 37.2);
    root.add(mouth, arch);
  }
}

function namePlate(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(7,11,20,0.85)'; x.fillRect(0, 8, 256, 48);
  x.strokeStyle = '#d4a017'; x.strokeRect(1, 9, 254, 46);
  x.fillStyle = '#fff'; x.font = '700 28px Barlow, Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.scale.set(6.4, 1.6, 1); m.position.y = 3.2;
  return m;
}

export function mountMenu(host) {
  unmountMenu();
  if (!host) return;
  const ids = SHOWCASE.filter((id) => PLAYERS[id]);
  if (!webglOk()) {
    host.innerHTML = `<p class="menu-fallback">This browser has no WebGL, so the stadium stays dark. ${ids.map((id) => PLAYERS[id].name).join(', ')} are still the six on the card.</p>`;
    return;
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.3, 1400);
  const stadium = new Stadium(scene, renderer);
  stadium.setVenue({ stadium: 'classic', time: 'night', roof: false });
  stadium.paint([
    { name: 'PokeBall', abbr: 'PB', color: '#e5402b', kit: { color2: '#0b1b3a', wordmark: 'POKEBALL', style: 'block' } },
    { name: 'League', abbr: 'LG', color: '#0b1b3a', kit: { color2: '#d4a017', wordmark: 'LEAGUE', style: 'block' } },
  ], 1);
  paintBoard(stadium);
  addTunnels(stadium.root);
  host.appendChild(renderer.domElement);
  const actors = ids.map((id, i) => {
    const group = new THREE.Group();
    group.position.set(SPOTS[i][0], 0, SPOTS[i][1]);
    group.rotation.y = SPOTS[i][1] > 0 ? 0.4 : -0.4;
    scene.add(group);
    const missing = !hasModel(id);
    if (missing) group.add(namePlate(`${PLAYERS[id].name} · no model`));
    return { id, group, fig: null, missing, tried: false };
  });
  const caption = document.getElementById('menu-feature-name');
  let raf = 0, last = performance.now(), t = 0, focus = 0, focusAt = 0;
  const resize = () => {
    const w = host.clientWidth || 1280, h = host.clientHeight || 720;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  const me = { stop: false };
  live = me;
  const frame = (now) => {
    if (me.stop || !host.isConnected) { teardown(); return; }
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduceMotion) t += dt;
    for (const a of actors) {
      if (!a.fig && !a.missing) {
        const T = modelTemplate(a.id);
        if (T.ready && !a.tried) {
          a.tried = true;
          try { a.fig = makeModelFigure(T); a.group.add(a.fig.group); }
          catch { a.missing = true; a.group.add(namePlate(`${PLAYERS[a.id].name} · no model`)); }
        } else if (T.failed) { a.missing = true; a.group.add(namePlate(`${PLAYERS[a.id].name} · no model`)); }
      }
      if (a.fig) {
        a.fig.mixer?.update(reduceMotion ? 0 : dt);
        driveLimbs(a.fig, { phase: 0, run: 0, t, flap: 0, weight: 1, calm: reduceMotion ? 0 : 1, seed: a.id });
        updateBlink(a.fig, dt, true);
      }
    }
    if (!reduceMotion && t - focusAt > 7) { focus = (focus + 1) % actors.length; focusAt = t; }
    const spot = actors[focus];
    if (caption && spot) {
      const label = PLAYERS[spot.id].name + (spot.missing ? ' · model missing' : '');
      if (caption.textContent !== label) caption.textContent = label;
    }
    const aim = spot ? spot.group.position : new THREE.Vector3(50, 0, 0);
    const ang = reduceMotion ? 0.35 : t * 0.045;
    camera.position.set(50 + Math.sin(ang) * 22, 14.5, 34 + Math.cos(ang) * 6);
    camera.lookAt(aim.x * 0.35 + 50 * 0.65, 1.6, aim.z * 0.45);
    stadium.update(t, dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);
  function teardown() {
    if (me.dead) return;
    me.dead = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const a of actors) if (a.fig) disposeModelFigure(a.fig);
    renderer.dispose();
    renderer.forceContextLoss?.();
    renderer.domElement.remove();
    if (live === me) live = null;
  }
  me.teardown = teardown;
}

export function unmountMenu() {
  if (!live) return;
  live.stop = true;
  live.teardown?.();
  live = null;
}
