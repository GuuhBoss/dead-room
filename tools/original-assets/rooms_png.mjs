// Renders the composed room layers (rooms_svg.py output) to 1x PNG, as the
// original keeps them (CWorld bmFloor / bmCover / bmDecalMask BitmapData).
// Usage: node rooms_png.mjs <svg dir> <out dir>
import { chromium } from '/var/www/node/bus-trip/node_modules/playwright-core/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe });
const pg = await (await browser.newContext()).newPage();
for (let n = 1; n <= 18; n++) {
  for (const layer of ['floor', 'cover', 'mask']) {
    const name = `${String(n).padStart(2, '0')}-${layer}`;
    const svg = readFileSync(`${src}/${name}.svg`, 'utf8');
    const url = await pg.evaluate(async ({ svg, mask }) => {
      const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      if (mask) { // only the alpha matters: store it as opaque black
        g.globalCompositeOperation = 'source-in'; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      }
      return c.toDataURL('image/png');
    }, { svg, mask: layer === 'mask' });
    const buf = Buffer.from(url.split(',')[1], 'base64');
    writeFileSync(`${out}/${name}.png`, buf);
    console.log(name, buf.length);
  }
}
await browser.close();
