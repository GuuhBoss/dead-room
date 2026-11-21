# Builds Dead Rooms' original-resource assets from JPEXS exports (data only).
# Usage: python3 -I build_assets.py <out assets dir>
import sys, os, re, json, shutil
from PIL import Image, ImageFilter

OUT = sys.argv[1]
SVG = '/tmp/bh-out/svgall'
PNG2 = '/tmp/bh-out/png2'
PNG3 = '/tmp/bh-out/png3'
SVG3 = '/tmp/bh-out/svg3'
TEX = '/tmp/bh-out/tex'
SND = '/tmp/bh-out/snd'
FONTS = '/tmp/bh-out/fonts'
IMG = '/tmp/bh-out/img'

def find(base, sid):
    return [os.path.join(base, d) for d in os.listdir(base) if d.split('_')[1] == str(sid)][0]

def reg(svgdir):
    s = open(os.path.join(svgdir, '1.svg'), encoding='utf-8').read(800)
    h, w = re.search(r'height="([\d.]+)px" width="([\d.]+)px"', s).groups()
    t = [float(v) for v in re.search(r'<g transform="matrix\(([^)]*)\)"', s).group(1).split(',')]
    return float(w), float(h), t[4], t[5]

SPRITES = {
    'barrel': 631, 'chargepack': 637, 'mine': 642, 'pickup': 645, 'wall': 660,
    'cluster': 662, 'grenade': 667, 'rocket': 673,
    'bloodHitBack': 572, 'bloodPool': 594, 'bloodSplat': 600, 'bulletHit': 611,
    'explosion': 568, 'explosionAir': 573, 'fireball': 591, 'rocketSmoke': 580,
    'scorch': 614, 'smokeCloud': 627, 'wallMark': 616,
    'muzzlePistol': 678, 'muzzleRailgun': 681, 'muzzleShotgun': 684, 'muzzleUzi': 687,
    'hudTimer': 53, 'hudLife': 41, 'hudAmmo': 44,
}

def glow(im, r):
    pad = Image.new('RGBA', (im.size[0] + r * 2, im.size[1] + r * 2), (0, 0, 0, 0))
    pad.paste(im, (r, r))
    a = pad.split()[3].filter(ImageFilter.MaxFilter(r * 2 + 1)).filter(ImageFilter.BoxBlur(1))
    out = Image.new('RGBA', pad.size, (0, 0, 0, 0))
    out.putalpha(a)
    out.alpha_composite(pad)
    return out

def frames_of(d):
    return sorted([f for f in os.listdir(d) if f.endswith('.png')], key=lambda f: int(f.split('.')[0]))

def main():
    os.makedirs(os.path.join(OUT, 'sprites'), exist_ok=True)
    manifest = {'sprites': {}, 'textures': {}, 'sounds': {}, 'fonts': {}, 'previews': [], 'rooms': []}
    for key, sid in SPRITES.items():
        pdir = find(PNG2 if os.path.exists(PNG2) and any(d.split('_')[1] == str(sid) for d in os.listdir(PNG2)) else PNG3, sid)
        sdir = find(SVG if any(d.split('_')[1] == str(sid) for d in os.listdir(SVG)) else SVG3, sid)
        w, h, tx, ty = reg(sdir)
        fs = frames_of(pdir)
        ims = [Image.open(os.path.join(pdir, f)).convert('RGBA') for f in fs]
        if key == 'hudTimer':  # Hud.ScoreTotal places it with GlowFilter(black, 2, 2, strength 10)
            ims = [glow(im, 4) for im in ims]
        fw, fh = ims[0].size
        mx, my = (fw - w * 2) / 2, (fh - h * 2) / 2
        strip = Image.new('RGBA', (fw * len(ims), fh), (0, 0, 0, 0))
        for i, im in enumerate(ims):
            strip.paste(im, (i * fw, 0))
        strip.save(os.path.join(OUT, 'sprites', key + '.png'), optimize=True)
        manifest['sprites'][key] = {'src': 'sprites/%s.png' % key, 'frames': len(ims), 'w': fw / 2, 'h': fh / 2,
                                    'ox': round(tx + mx / 2, 3), 'oy': round(ty + my / 2, 3)}
    # Swap-sides button: crop the arrows from the up and over states.
    bdir = '/tmp/bh-out/btn/DefineButton2_63'
    for state, name in (('1_up', 'swapUp'), ('2_over', 'swapOver')):
        im = Image.open(os.path.join(bdir, state + '.png')).convert('RGBA')
        box = im.getbbox()
        im.crop(box).save(os.path.join(OUT, 'sprites', name + '.png'), optimize=True)
        manifest['sprites'][name] = {'src': 'sprites/%s.png' % name, 'frames': 1, 'w': (box[2] - box[0]) / 2, 'h': (box[3] - box[1]) / 2, 'ox': 0, 'oy': 0}
    # Character cards (SubScreen mcCharacter frames: BON, BIND, BERT, BAMBO).
    cd = '/tmp/bh-out/cards/DefineSprite_520'
    ims = [Image.open(os.path.join(cd, '%d.png' % i)).convert('RGBA') for i in range(1, 5)]
    box = ims[0].getbbox()
    for im in ims[1:]:
        b = im.getbbox(); box = (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    strip = Image.new('RGBA', ((box[2] - box[0]) * 4, box[3] - box[1]), (0, 0, 0, 0))
    for i, im in enumerate(ims):
        strip.paste(im.crop(box), (i * (box[2] - box[0]), 0))
    strip.save(os.path.join(OUT, 'sprites', 'cards.png'), optimize=True)
    manifest['sprites']['cards'] = {'src': 'sprites/cards.png', 'frames': 4, 'w': (box[2] - box[0]) / 2, 'h': (box[3] - box[1]) / 2, 'ox': 0, 'oy': 0}
    # Character textures (64 × 64 clips at 2×) in one atlas.
    texdirs = sorted(os.listdir(TEX), key=lambda s: int(s.split('_')[1]))
    names = [d.split('_', 2)[2] for d in texdirs]
    cols = 8
    atlas = Image.new('RGBA', (cols * 128, ((len(names) + cols - 1) // cols) * 128), (0, 0, 0, 0))
    for i, d in enumerate(texdirs):
        im = Image.open(os.path.join(TEX, d, '1.png')).convert('RGBA')
        assert im.size == (128, 128), (d, im.size)
        atlas.paste(im, ((i % cols) * 128, (i // cols) * 128))
    atlas.save(os.path.join(OUT, 'textures.png'), optimize=True)
    manifest['textures'] = {'src': 'textures.png', 'size': 128, 'cols': cols, 'names': names}
    # Sounds, renamed after their linkage names.
    os.makedirs(os.path.join(OUT, 'sounds'), exist_ok=True)
    for f in sorted(os.listdir(SND)):
        m = re.match(r'(\d+)_(.+)\.wav\.mp3$', f)
        if not m:
            continue
        key = m.group(2)
        shutil.copyfile(os.path.join(SND, f), os.path.join(OUT, 'sounds', key + '.mp3'))
        manifest['sounds'][key] = 'sounds/%s.mp3' % key
    # Complete embedded fonts (the others are subsets of these).
    os.makedirs(os.path.join(OUT, 'fonts'), exist_ok=True)
    for src, fam, file in (('23_Calibri.woff', 'Calibri', 'calibri.woff'), ('25_Calibri.woff', 'Calibri Bold', 'calibri-bold.woff'),
                           ('370_Arial Rounded MT Bold.woff', 'Arial Rounded MT Bold', 'arial-rounded-bold.woff')):
        shutil.copyfile(os.path.join(FONTS, src), os.path.join(OUT, 'fonts', file))
        manifest['fonts'][fam] = 'fonts/' + file
    # Room previews: LevelIcons_Single frame bitmaps (350 × 182), no overlay.
    os.makedirs(os.path.join(OUT, 'previews'), exist_ok=True)
    ids = [409, 427, 431, 435, 439, 443, 447, 451, 455, 460, 464, 468, 472, 476, 480, 484, 488, 492]
    for n, i in enumerate(ids):
        f = [x for x in os.listdir(IMG) if x.split('.')[0] == str(i)][0]
        im = Image.open(os.path.join(IMG, f)).convert('RGB')
        dst = 'previews/%02d.%s' % (n + 1, 'jpg' if f.endswith('.jpg') else 'png')
        if f.endswith('.jpg'):
            shutil.copyfile(os.path.join(IMG, f), os.path.join(OUT, dst))
        else:
            im.save(os.path.join(OUT, dst), optimize=True)
        manifest['previews'].append(dst)
    # Rooms: floor, cover and decal-mask layers composed by rooms_svg.py and
    # rendered at 1x by rooms_png.mjs (CWorld's bmFloor, bmCover, bmDecalMask).
    shutil.rmtree(os.path.join(OUT, 'rooms'), ignore_errors=True)
    os.makedirs(os.path.join(OUT, 'rooms'), exist_ok=True)
    for n in range(1, 19):
        entry = {}
        for layer in ('floor', 'cover', 'mask'):
            name = '%02d-%s.png' % (n, layer)
            shutil.copyfile(os.path.join('/tmp/bh-assets/roompng', name), os.path.join(OUT, 'rooms', name))
            entry[layer] = 'rooms/' + name
        manifest['rooms'].append(entry)
    # Title art: the game logo (sprite 10), the faded backdrop every menu
    # screen places (198 = white + 197) and Screen_LoadingWorld (361) whole.
    os.makedirs(os.path.join(OUT, 'title'), exist_ok=True)
    Image.open('/tmp/bh-out/title/DefineSprite_10/1.png').convert('RGBA').save(os.path.join(OUT, 'title', 'logo.png'), optimize=True)
    bg = Image.open('/tmp/bh-out/title/DefineSprite_198/1.png').convert('RGBA')
    m = ((bg.size[0] - 1280) // 2, (bg.size[1] - 960) // 2)
    white = Image.new('RGBA', (1280, 960), (255, 255, 255, 255)); white.alpha_composite(bg.crop((m[0], m[1], m[0] + 1280, m[1] + 960)))
    white.convert('RGB').save(os.path.join(OUT, 'title', 'background.jpg'), quality=90, optimize=True)
    ld = Image.open('/tmp/bh-out/title/DefineSprite_361_Screen_LoadingWorld/1.png').convert('RGBA')
    m = ((ld.size[0] - 1280) // 2, (ld.size[1] - 960) // 2)
    flat = Image.new('RGBA', (1280, 960), (255, 255, 255, 255)); flat.alpha_composite(ld.crop((m[0], m[1], m[0] + 1280, m[1] + 960)))
    flat.convert('RGB').save(os.path.join(OUT, 'title', 'loading.jpg'), quality=90, optimize=True)
    manifest['title'] = {'logo': 'title/logo.png', 'background': 'title/background.jpg', 'loading': 'title/loading.jpg'}
    shutil.copyfile('/tmp/bh-assets/xsi.json', os.path.join(OUT, 'xsi.json'))
    manifest['xsi'] = 'xsi.json'
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps({k: v for k, v in manifest['sprites'].items()}, indent=0)[:3000])

main()
