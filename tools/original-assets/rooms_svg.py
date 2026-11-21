# Compose original room layers from JPEXS SVG exports (data only, no code run).
# Usage: python3 -I rooms_svg.py <svgall dir> <out dir>
# Floor = room clip without World_Init markers; pieces drawn translation-only
# without their _Cover child (CWorld_Init_Piece.Draw). Cover = every piece's
# _Cover child at the piece position, drawn above things. Mask = pieces only
# (CMap_Decal masks decals off pieces).
import sys, os, re, copy, hashlib
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
XL = 'http://www.w3.org/1999/xlink'
FF = 'https://www.free-decompiler.com/flash'
ET.register_namespace('', SVG)
ET.register_namespace('xlink', XL)
HREF = '{%s}href' % XL
CID = '{%s}characterId' % FF
MARKERS = {'74', '82', '85', '88', '91', '94', '96', '112', '98'}
PIECES = {'75', '79', '103', '109', '119', '124', '132', '138', '149'}
ROOMS = ['99', '104', '113', '143', '145', '150', '151', '152', '114', '115', '120', '125', '126', '127', '128', '133', '134', '139']

def tag(e):
    return e.tag.split('}')[1]

def mat(s):
    m = re.match(r'matrix\(([^)]*)\)', s or '')
    if not m:
        return [1, 0, 0, 1, 0, 0]
    return [float(v) for v in m.group(1).split(',')]

def mul(a, b):  # a ∘ b (apply b first, then a)
    return [a[0]*b[0] + a[2]*b[1], a[1]*b[0] + a[3]*b[1], a[0]*b[2] + a[2]*b[3], a[1]*b[2] + a[3]*b[3],
            a[0]*b[4] + a[2]*b[5] + a[4], a[1]*b[4] + a[3]*b[5] + a[5]]

def fmt(m):
    return 'matrix(%s)' % ','.join(('%.4f' % v).rstrip('0').rstrip('.') for v in m)

def clean(e):
    for k in list(e.attrib):
        if k.startswith('{%s}' % FF) or k in ('width', 'height') and tag(e) == 'use':
            del e.attrib[k]
    for c in e:
        clean(c)

def refs(e):
    out = set()
    for x in e.iter():
        h = x.attrib.get(HREF)
        if h and h.startswith('#'):
            out.add(h[1:])
        for k, v in x.attrib.items():
            for m in re.finditer(r'url\(#([^)]+)\)', v):
                out.add(m.group(1))
    return out

def dedupe(defs, root):
    while True:
        seen, remap = {}, {}
        for d in list(defs):
            i = d.attrib.get('id')
            body = copy.deepcopy(d)
            body.attrib.pop('id', None)
            key = hashlib.sha1(ET.tostring(body)).hexdigest()
            if key in seen:
                remap[i] = seen[key]
                defs.remove(d)
            else:
                seen[key] = i
        if not remap:
            return
        for x in list(root.iter()) + [y for d in defs for y in d.iter()]:
            h = x.attrib.get(HREF)
            if h and h[1:] in remap:
                x.set(HREF, '#' + remap[h[1:]])

def prune(defs, root):
    byid = {d.attrib.get('id'): d for d in defs}
    keep, todo = set(), list(refs(root))
    while todo:
        i = todo.pop()
        if i in keep or i not in byid:
            continue
        keep.add(i)
        todo.extend(refs(byid[i]))
    for d in list(defs):
        if d.attrib.get('id') not in keep:
            defs.remove(d)

def write(path, w, h, children, defs_src, extra_defs=()):
    svg = ET.Element('{%s}svg' % SVG, {'width': '%g' % w, 'height': '%g' % h, 'viewBox': '0 0 %g %g' % (w, h)})
    g = ET.SubElement(svg, '{%s}g' % SVG)
    for c in children:
        g.append(c)
    defs = ET.SubElement(svg, '{%s}defs' % SVG)
    for d in defs_src:
        defs.append(copy.deepcopy(d))
    for d in extra_defs:
        defs.append(d)
    clean(svg)
    dedupe(defs, g)
    prune(defs, g)
    txt = ET.tostring(svg, encoding='unicode')
    txt = re.sub(r'>\s+<', '><', txt)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(txt)
    return len(txt)

def main(src, out):
    os.makedirs(out, exist_ok=True)
    sizes = []
    for n, sid in enumerate(ROOMS):
        d = [x for x in os.listdir(src) if x.startswith('DefineSprite_%s_' % sid)][0]
        tree = ET.parse(os.path.join(src, d, '1.svg'))
        root = tree.getroot()
        g = [c for c in root if tag(c) == 'g'][0]
        defs = [c for c in root if tag(c) == 'defs'][0]
        byid = {x.attrib.get('id'): x for x in defs}
        size = [u for u in g if tag(u) == 'use' and u.attrib.get('id') == '_Size'][0]
        sm = mat(size.attrib.get('transform'))
        W, H = round(sm[0] * float(size.attrib['width'])), round(sm[3] * float(size.attrib['height']))
        floor, cover, mask, filters = [], [], [], []
        for c in list(g):
            if tag(c) == 'filter':
                filters.append(c)
                continue
            cid = c.attrib.get(CID)
            if cid in MARKERS:
                continue
            if cid in PIECES:
                m = mat(c.attrib.get('transform'))
                t = [1, 0, 0, 1, m[4], m[5]]
                piece = byid[c.attrib[HREF][1:]]
                kids = list(piece)
                cov = [k for k in kids if k.attrib.get('id') == '_Cover']
                for k in kids:
                    if k.attrib.get(CID) in MARKERS or k.attrib.get('id') == '_Cover':
                        piece.remove(k)
                c.set('transform', fmt(t))
                floor.append(c)
                mask.append(copy.deepcopy(c))
                for k in cov:
                    u = ET.Element('{%s}use' % SVG, {HREF: k.attrib[HREF], 'transform': fmt(mul(t, mat(k.attrib.get('transform'))))})
                    cover.append(u)
                continue
            floor.append(c)
        a = write(os.path.join(out, '%02d-floor.svg' % (n + 1)), W, H, filters + floor, list(defs))
        b = write(os.path.join(out, '%02d-cover.svg' % (n + 1)), W, H, cover, list(defs))
        c = write(os.path.join(out, '%02d-mask.svg' % (n + 1)), W, H, mask, list(defs))
        sizes.append((n + 1, W, H, a, b, c))
        print(n + 1, W, H, a, b, c, flush=True)
    return sizes

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
