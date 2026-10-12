"""Builds the animated pixel sprite strips for the field and the menu stills.

Usage: python3 build_sprites3d.py <gif_cache_dir> <out_src_dir> <out_dist_dir>
Source: PokeAPI/sprites. Gen 1-5 use the animated Black/White pixel sprites, front and back
(sprites/pokemon/versions/generation-v/black-white/animated/{id}.gif and .../back/{id}.gif).
Later Pokémon have no Black/White animation, so they use the pixel sprites in
sprites/pokemon/{id}.png and back/{id}.png as one-frame strips; the field animates those
with its own bob and stride.

Each direction becomes one horizontal strip, sampled at even steps through the GIF's own
timing and cropped to the union of the frames' bounding boxes so the feet stay put. Pixels
are kept at their native size (lossless WebP) so the field can draw them crisp.

Outputs:
  <out_src_dir>/sprites3d.js   index: id -> [chunk, front w, front h, back w, back h,
                               front frames, back frames, seconds per loop]
  <out_src_dir>/sprites.js     small stills for the menus (bundled into the app)
  <out_dist_dir>/sprites3d/N.js  the strips, PER_CHUNK Pokémon per file, loaded on demand by
                                 a <script> tag (works from file:// and from a static host)
"""
import base64, glob, io, json, os, re, sys, urllib.error, urllib.request
from multiprocessing import Pool
from PIL import Image

cache, out_dir, dist_dir = sys.argv[1:4]
MAX_FRAMES, STILL, PER_CHUNK = 12, 96, 3
BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/'
BW = BASE + 'versions/generation-v/black-white/animated/'

data = open(os.path.join(out_dir, 'data.js'), encoding='utf-8').read()
ids = [int(x) for x in re.findall(r'"id":(\d+)', data)]
os.makedirs(cache, exist_ok=True)


def download(url, path):
    try:
        with urllib.request.urlopen(url) as r, open(path, 'wb') as f:
            f.write(r.read())
        return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def fetch(pid, back):
    b = 'back/' if back else ''
    gif = os.path.join(cache, f'bw{pid}{"b" if back else ""}.gif')
    if os.path.exists(gif) or download(BW + b + f'{pid}.gif', gif):
        return Image.open(gif)
    png = os.path.join(cache, f'px{pid}{"b" if back else ""}.png')
    if os.path.exists(png) or download(BASE + b + f'{pid}.png', png):
        return Image.open(png)
    raise SystemExit(f'no sprite for {pid}')


def frames(im):
    """Frames sampled at even times through the animation, and the loop length in seconds."""
    n = getattr(im, 'n_frames', 1)
    if n == 1:
        return [im.convert('RGBA')], 1.0
    durs, all_frames = [], []
    for i in range(n):
        im.seek(i)
        all_frames.append(im.convert('RGBA'))
        durs.append(max(20, im.info.get('duration', 100) or 100))
    total = sum(durs)
    count = min(MAX_FRAMES, n)
    out, t, k, acc = [], 0, 0, 0
    for s in range(count):
        t = s * total / count
        while k < n - 1 and acc + durs[k] <= t:
            acc += durs[k]; k += 1
        out.append(all_frames[k])
    return out, total / 1000


def b64(img, lossless=True):
    buf = io.BytesIO()
    img.save(buf, 'WEBP', lossless=lossless, quality=100 if lossless else 82, method=4)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def strip(im):
    frs, secs = frames(im)
    box = None
    for fr in frs:
        bb = fr.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
        if bb:
            box = bb if box is None else (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    box = box or (0, 0, *frs[0].size)
    w, h = box[2] - box[0], box[3] - box[1]
    sheet = Image.new('RGBA', (w * len(frs), h))
    for i, fr in enumerate(frs):
        sheet.paste(fr.crop(box), (i * w, 0))
    return sheet, w, h, len(frs), secs, frs[0].crop(box)


def build(pid):
    f_sheet, fw, fh, fn, secs, first = strip(fetch(pid, False))
    b_sheet, bw, bh, bn, _, _ = strip(fetch(pid, True))
    s = min(1.0, STILL / max(first.size))
    still = first.resize((max(1, round(first.size[0] * s)), max(1, round(first.size[1] * s))), Image.NEAREST)
    return [fw, fh, bw, bh, fn, bn, round(secs, 2)], [b64(f_sheet), b64(b_sheet)], b64(still)


index, stills, chunks = {}, {}, {}
with Pool() as pool:
    for n, (pid, (dims, pair, still)) in enumerate(zip(ids, pool.map(build, ids))):
        c = n // PER_CHUNK
        index[pid] = [c, *dims]
        chunks.setdefault(c, {})[pid] = pair
        stills[pid] = still

sdir = os.path.join(dist_dir, 'sprites3d')
os.makedirs(sdir, exist_ok=True)
for old in glob.glob(os.path.join(sdir, '*.js')):
    os.remove(old)
total = 0
for c, strips in chunks.items():
    body = '__pbSprites(' + json.dumps(strips, separators=(',', ':')) + ');\n'
    with open(os.path.join(sdir, f'{c}.js'), 'w') as f:
        f.write(body)
    total += len(body)

with open(os.path.join(out_dir, 'sprites3d.js'), 'w') as f:
    f.write('// Generated by build/build_sprites3d.py from the PokeAPI pixel sprites. Do not edit.\n')
    f.write('// id -> [chunk, front width, front height, back width, back height, front frames, back frames,\n')
    f.write('// seconds per idle loop]; the strips live in dist/sprites3d/<chunk>.js and load on demand.\n')
    f.write('export const SPRITE_INDEX = ' + json.dumps(index, separators=(',', ':')) + ';\n')
with open(os.path.join(out_dir, 'sprites.js'), 'w') as f:
    f.write('// Generated by build/build_sprites3d.py from the PokeAPI pixel sprites. Do not edit.\n')
    f.write('export const SPRITES = ' + json.dumps(stills, separators=(',', ':')) + ';\n')
print(len(index), 'pokemon in', len(chunks), 'chunks;', round(total / 1e6, 1), 'MB of animated strips;',
      round(sum(map(len, stills.values())) / 1e6, 1), 'MB of stills')
