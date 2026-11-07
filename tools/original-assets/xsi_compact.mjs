// Compacts the decoded XSI data (CDrawPrimitive_XSI_DI input) for the browser.
// Usage: node xsi_compact.mjs <xsi.json> <out.json>
// Output: { materials: {name: [color, alpha] | link}, names: [...],
//   items: { "Group/Anim": { partner, seq, dirs: [[frame]] } } }
// frame = [model...] in definition order; model = [nameIdx] when Empty, else
// [nameIdx, matIdx[], matrix[] (0 or [a,b,c,d,tx,ty]), verts[][], bright[], shadow[][], pedge[][]].
import { readFileSync, writeFileSync } from 'node:fs';
const items = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const names = [], index = new Map();
const id = s => { if (!index.has(s)) { index.set(s, names.length); names.push(s); } return index.get(s); };
const materials = {};
const r3 = v => Math.round(v * 1000) / 1000;
const out = { materials, names, items: {} };
for (const it of items) {
  for (const [k, m] of Object.entries(it.mXSI.mMaterials)) {
    if (k === 'Edge') continue;
    materials[k] = m.mcLinkID ? m.mcLinkID : m.mThickness !== undefined ? [m.mColor, m.mAlpha, m.mThickness] : [m.mColor, m.mAlpha];
  }
  const dirs = it.mXSI.mRotations.map(frames => frames.map(f => Object.entries(f.Models).map(([name, m]) => {
    if (m.Empty) return [id(name)];
    return [id(name), m.Shape_Material.map(id), m.Shape_Matrix.map(x => x ? [r3(x.a), r3(x.b), r3(x.c), r3(x.d), r3(x.tx), r3(x.ty)] : 0),
      m.Shape_vList, m.Shape_Brightness.map(r3), m.Shadow, m.PEdge];
  })));
  out.items[`${it.mGroupID}/${it.mAnimID}`] = { partner: it.mRenderPartner || null, seq: it.mFrameSquence || null, tilt: it.mXSI.mXSIInfo.mTilt, dirs };
}
const txt = JSON.stringify(out);
writeFileSync(process.argv[3], txt);
console.log(Object.keys(out.items).length, 'items', (txt.length / 1e6).toFixed(2), 'MB', names.length, 'names');
