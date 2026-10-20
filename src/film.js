// The film room's tape: a recorded play (L3.rec in screens/live3d.js: the play as it stood at
// the snap and every simulation step's input after it) that can be played from any step,
// forward or back, and saved as a clip file that plays the same way anywhere.
//
// Playing step i means running the simulation from the snap through i recorded inputs. The tape
// keeps a copy of the play every CHECKPOINT steps as it goes, so a seek runs at most that many
// steps from the nearest copy before it instead of the whole play again.
import { snap, step } from './live.js';

export const CHECKPOINT = 30;
export const CLIP_VERSION = 1;

// A tape from a recording. Returns null when the recording can't be played from the snap.
export function makeTape(rec) {
  if (!rec?.atSnap || !rec.log) return null;
  let i = 0;
  while (i < rec.log.length && !rec.log[i]?.snap) i++;
  const mark = rec.log[i];
  if (!mark) return null;
  const lp = structuredClone(rec.atSnap);
  // The game's play-by-play and drives ride along in the copy but the play never reads them.
  lp.g.log = []; lp.g.drives = [];
  lp.preview = true;
  lp.control = mark.control ? lp[mark.control[0]]?.[mark.control[1]] ?? null : null;
  snap(lp);
  const inputs = rec.log.slice(i + 1);
  return { start: lp, inputs, n: inputs.length, marks: new Map([[0, structuredClone(lp)]]) };
}

// The play at step i (0 = the snap, tape.n = the whistle and after), as a fresh copy.
export function seekTape(tape, i) {
  i = Math.max(0, Math.min(tape.n, Math.round(i)));
  let k = Math.floor(i / CHECKPOINT) * CHECKPOINT;
  while (k > 0 && !tape.marks.has(k)) k -= CHECKPOINT;
  const lp = structuredClone(tape.marks.get(k));
  for (let j = k; j < i; j++) advance(tape, lp, j);
  return lp;
}

// One step of the tape: input j applied to the play at step j. Leaves a checkpoint behind.
export function advance(tape, lp, j) {
  step(lp, tape.inputs[j] ?? null);
  const at = j + 1;
  if (at % CHECKPOINT === 0 && !tape.marks.has(at)) tape.marks.set(at, structuredClone(lp));
}

// Seconds of play at step i (the simulation runs at a fixed 60 steps a second).
export const tapeSeconds = (i) => i / 60;

// ---------- clip files ----------
// The play at the snap is a graph (a blocker's man, the ball's holder and the like point at
// other players), so it is written with each shared object once and references to it after.
// Numbers JSON can't hold (Infinity, NaN) are kept as tagged values.
function pack(root) {
  const ids = new Map();
  const enc = (v) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
    if (v === undefined) return { $u: 1 };
    if (!v || typeof v !== 'object') return v;
    if (ids.has(v)) return { $r: ids.get(v) };
    const id = ids.size;
    ids.set(v, id);
    if (Array.isArray(v)) return { $a: id, v: v.map(enc) };
    const o = { $o: id, v: {} };
    for (const k of Object.keys(v)) o.v[k] = enc(v[k]);
    return o;
  };
  return enc(root);
}
function unpack(root) {
  const seen = [];
  const dec = (v) => {
    if (!v || typeof v !== 'object') return v;
    if ('$n' in v) return Number(v.$n);
    if ('$u' in v) return undefined;
    if ('$r' in v) return seen[v.$r];
    if ('$a' in v) { const a = []; seen[v.$a] = a; for (const x of v.v) a.push(dec(x)); return a; }
    if ('$o' in v) { const o = {}; seen[v.$o] = o; for (const [k, x] of Object.entries(v.v)) o[k] = dec(x); return o; }
    throw new Error('not a clip');
  };
  return dec(root);
}

// A clip file's text: the recording, and what the film room shows about it (the label, the
// result, the moments marked in it).
export function clipJson(rec, meta = {}) {
  const atSnap = structuredClone(rec.atSnap);
  atSnap.g.log = []; atSnap.g.drives = [];
  return JSON.stringify({ pokeballClip: CLIP_VERSION, meta, off: rec.off, def: rec.def, log: rec.log, end: rec.end ?? null, atSnap: pack(atSnap) });
}

// A recording back from a clip file's text. Throws on anything that isn't one.
export function clipFromJson(text) {
  const c = JSON.parse(text);
  if (c?.pokeballClip !== CLIP_VERSION || !Array.isArray(c.log) || !c.atSnap) throw new Error('not a PokeBall clip');
  return { rec: { off: c.off, def: c.def, log: c.log, end: c.end, atSnap: unpack(c.atSnap), done: true }, meta: c.meta ?? {} };
}
