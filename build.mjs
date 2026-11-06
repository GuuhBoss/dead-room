// Joins src/ into dist/ (index.html, style.css, game.js) and also writes a
// single self-contained dist/dead-rooms.html. No dependencies.
// `node build.mjs --watch` rebuilds whenever a file in src/ changes.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
export const src = join(root, 'src');
export const dist = join(root, 'dist');

export function build() {
  mkdirSync(dist, { recursive: true });
  const scripts = readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
  const js = scripts.map(f => readFileSync(join(src, f), 'utf8')).join('\n');
  const css = readFileSync(join(src, 'style.css'), 'utf8');
  const html = readFileSync(join(src, 'index.html'), 'utf8');

  writeFileSync(join(dist, 'game.js'), js);
  writeFileSync(join(dist, 'style.css'), css);
  writeFileSync(join(dist, 'index.html'), html);

  const single = html
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}</style>`)
    .replace('<script src="game.js"></script>', () => `<script>\n${js}</script>`);
  writeFileSync(join(dist, 'dead-rooms.html'), single);
  console.log(`built ${scripts.length} scripts, ${(js.length / 1024).toFixed(1)} KB of JS`);
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
