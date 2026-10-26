// Drawing a team's kit on a 2D canvas: its end zone (the field texture in stadium3d.js and the
// preview on the kit screen both use this), and a text fit helper.
import { inkOn, kitOf, wordmarkOf } from './kits.js';

// Shrink the canvas font so the text fits in maxW.
export function fitText(x, text, maxW) {
  const m = x.measureText(text).width;
  if (m > maxW) { const size = parseFloat(/(\d+(\.\d+)?)px/.exec(x.font)[1]); x.font = x.font.replace(/\d+(\.\d+)?px/, `${(size * maxW) / m}px`); }
}

// One end zone, 10 yards deep and H pixels across, from x0 (PX pixels to a yard): the team's
// color, a band of its second color just inside the lines, and its wordmark in the kit's style,
// reading from the field (`left` is the end zone at the left end). `up` is the way the tops of
// the letters point along the field (-1 toward the left end): a viewer facing that way reads it.
export function paintEndZone(x, x0, H, PX, team, left, up = left ? -1 : 1) {
  const kit = kitOf(team);
  x.save();
  x.beginPath(); x.rect(x0, 0, 10 * PX, H); x.clip();
  x.fillStyle = team.color; x.globalAlpha = 0.9; x.fillRect(x0, 0, 10 * PX, H);
  if (kit.style === 'stripes') {
    x.globalAlpha = 0.55; x.fillStyle = kit.color2;
    for (let k = -20; k < 30; k++) { const s = x0 + k * PX * 4.4; x.beginPath(); x.moveTo(s, 0); x.lineTo(s + PX * 1.6, 0); x.lineTo(s + PX * 1.6 + H, H); x.lineTo(s + H, H); x.fill(); }
  } else {
    x.globalAlpha = 0.12; x.strokeStyle = '#000'; x.lineWidth = PX * 0.9;
    for (let k = -40; k < 60; k++) { x.beginPath(); x.moveTo(x0 + k * PX * 2.2, 0); x.lineTo(x0 + k * PX * 2.2 + H, H); x.stroke(); }
  }
  x.globalAlpha = 0.95; x.strokeStyle = kit.color2; x.lineWidth = PX * 0.45;
  x.strokeRect(x0 + PX * 0.9, PX * 0.9, 10 * PX - PX * 1.8, H - PX * 1.8);
  x.globalAlpha = 1;
  x.translate(x0 + 5 * PX, H / 2); x.rotate((up < 0 ? -Math.PI : Math.PI) / 2);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const name = wordmarkOf(team);
  const ink = inkOn(team.color) === '#ffffff' ? 'rgba(255,255,255,0.96)' : 'rgba(16,22,28,0.92)';
  const maxW = Math.min(PX * 44, H * 0.85);
  if (kit.style === 'script') {
    x.font = `italic 700 ${PX * 6.4}px Georgia, "Times New Roman", serif`;
    const nice = name.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    fitText(x, nice, maxW);
    x.fillStyle = kit.color2; x.fillText(nice, PX * 0.35, PX * 0.35);
    x.fillStyle = ink; x.fillText(nice, 0, 0);
  } else {
    x.font = `800 ${PX * 6.2}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
    fitText(x, name, maxW);
    if (kit.style === 'outline') {
      x.lineJoin = 'round'; x.lineWidth = PX * 0.7; x.strokeStyle = 'rgba(255,255,255,0.96)'; x.strokeText(name, 0, 0);
      x.fillStyle = kit.color2; x.fillText(name, 0, 0);
    } else {
      x.fillStyle = ink; x.strokeStyle = kit.style === 'stripes' ? kit.color2 : 'rgba(0,0,0,0.35)'; x.lineWidth = PX * (kit.style === 'stripes' ? 0.5 : 0.25);
      x.strokeText(name, 0, 0); x.fillText(name, 0, 0);
    }
  }
  x.restore();
}
