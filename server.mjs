// Zero-dependency static server for dist/.
// PORT (default 3330) and HOST (default 0.0.0.0) come from the environment.
// `node server.mjs --dev` builds first and rebuilds when src/ changes.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, watchSrc, dist } from './build.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function resolveFile(path) {
  if (path.endsWith('/')) path += 'index.html';
  const file = join(dist, path);
  if (file !== dist && !file.startsWith(dist + sep)) return null;
  const info = await stat(file).catch(() => null);
  if (info?.isDirectory()) return resolveFile(path + '/');
  return info?.isFile() ? { file, size: info.size } : null;
}

export function createApp() {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    const found = await resolveFile(path);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(found.file)] || 'application/octet-stream',
      'Content-Length': found.size,
      // File names are not hashed, so always revalidate.
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(found.file).pipe(res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev');
  if (dev) { build(); watchSrc(); }
  const port = Number(process.env.PORT ?? 3330);
  const host = process.env.HOST ?? '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`Dead Rooms on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${dev ? ' (dev)' : ''}`);
  });
}
