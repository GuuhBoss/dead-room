import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(process.argv[2], 'utf8').split('\n');
const keep = [];
for (const line of src) {
  const l = line.trim();
  if (!l) continue;
  if (/^var m\w+ = [\[{]/.test(l) || /^mItems\.push\(\{/.test(l) || /^mItems = new Array\(\);$/.test(l) || /^_global\.mXSI_Data = /.test(l) || /^trace\(/.test(l) || /^mLoaded = true;$/.test(l)) keep.push(l);
  else if (/^var mRotations;?$|^var mMaterials;?$|^var mXSIInfo;?$/.test(l)) continue;
  else { console.error('UNEXPECTED', l.slice(0, 80)); }
}
const ctx = vm.createContext({ _global: {}, trace() {} });
new vm.Script(keep.join('\n').replace(/\bvar mItems\b/, 'var mItems') + '\nthis.__out = JSON.stringify(mItems);').runInContext(ctx, { timeout: 20000 });
writeFileSync(process.argv[3], ctx.__out);
const items = JSON.parse(ctx.__out);
console.log(items.length, 'items', (ctx.__out.length / 1e6).toFixed(2), 'MB');
for (const it of items) console.log(it.mGroupID, it.mAnimID, it.mXSI.mRotations.length, 'dirs', it.mXSI.mRotations[0].length, 'frames', it.mRenderPartner || '', it.mFrameSquence ? 'seq' : '');
