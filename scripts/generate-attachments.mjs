// Rebuild the headless/browser shared offsets from the audited original export.
// Keeping these in 01-data avoids runtime file/network access in room VMs.
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const data = JSON.parse(readFileSync(new URL('docs/original-attachments.json', root)));
const groups = {}, weapons = {};
for (const [weapon, entry] of Object.entries(data.player.weapons)) {
  weapons[weapon] = entry.group;
  groups[entry.group] ??= Object.fromEntries(['stand', 'walk'].map(kind => {
    const table = entry[kind];
    return [kind, { sequence: table.frameSequence, frames: table.frames.map(row => row.map(p => p ? [p.x, p.y, p.z] : null)) }];
  }));
}
const payload = { weapons, groups, devil: data.devil.effective };
const start = '// BEGIN ORIGINAL ATTACHMENTS (scripts/generate-attachments.mjs)';
const end = '// END ORIGINAL ATTACHMENTS';
const path = new URL('src/01-data.js', root);
const source = readFileSync(path, 'utf8');
const block = `${start}\nconst ORIGINAL_ATTACHMENTS = ${JSON.stringify(payload)};\n${end}\n`;
const from = source.indexOf(start), to = source.indexOf(end);
writeFileSync(path, from < 0 ? source + '\n' + block : source.slice(0, from) + block + source.slice(to + end.length).replace(/^\n/, ''));
