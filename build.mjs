// Joins src/ into dist/ (index.html, style.css, game.js), copies the original
// resources in assets/ to dist/assets/, and writes a single self-contained
// dist/dead-rooms.html with every asset embedded. No dependencies.
// `node build.mjs --watch` rebuilds whenever a file in src/ changes.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const src = join(root, 'src');
export const dist = join(root, 'dist');
export const assets = join(root, 'assets');

const TEXT = new Set(['.json', '.svg']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.woff': 'font/woff' };

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// Text assets stay text; binary ones become data URLs. "</" is escaped so no
// asset can close the script element it is embedded in.
function embeddedAssets() {
  const out = {};
  for (const file of walk(assets).sort()) {
    const key = relative(assets, file).split(sep).join('/'), ext = extname(file);
    if (TEXT.has(ext)) out[key] = readFileSync(file, 'utf8');
    else if (MIME[ext]) out[key] = `data:${MIME[ext]};base64,${readFileSync(file).toString('base64')}`;
  }
  return JSON.stringify(out).replace(/<\//g, '<\\/');
}

export function build() {
  mkdirSync(dist, { recursive: true });
  const scripts = readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
  const js = scripts.map(f => readFileSync(join(src, f), 'utf8')).join('\n');
  const css = readFileSync(join(src, 'style.css'), 'utf8');
  const html = readFileSync(join(src, 'index.html'), 'utf8');

  writeFileSync(join(dist, 'game.js'), js);
  writeFileSync(join(dist, 'style.css'), css);
  writeFileSync(join(dist, 'index.html'), html);
  rmSync(join(dist, 'assets'), { recursive: true, force: true });
  cpSync(assets, join(dist, 'assets'), { recursive: true });

  const single = html
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
    .replace('<script src="game.js"></script>', () => `<script>window.DEAD_ROOMS_ASSETS = ${embeddedAssets()};</script>\n<script>\n${js}</script>`);
  writeFileSync(join(dist, 'dead-rooms.html'), single);
  console.log(`built ${scripts.length} scripts, ${(js.length / 1024).toFixed(1)} KB of JS, standalone ${(single.length / 1048576).toFixed(1)} MB`);
}

export function watchSrc() {
  let timer;
  watch(src, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { build(); } catch (err) { console.error('build failed:', err.message); }
    }, 50);
  });
  console.log('watching src/ for changes');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build();
  if (process.argv.includes('--watch')) watchSrc();
}
