// Static server and authoritative online survival service.
// PORT (default 3330) and HOST (default 0.0.0.0) come from the environment.
// `node server.mjs --dev` builds first and rebuilds when src/ changes.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, watchSrc, dist } from './build.mjs';
import { Leaderboard } from './backend/leaderboard.mjs';
import { attachOnline } from './backend/online.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
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

export function createApp(options = {}) {
  const leaderboard = new Leaderboard(options.dataDir);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let path, url;
    try {
      url = new URL(req.url, 'http://localhost');
      path = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (path === '/api/leaderboard') {
      const filters = {};
      let valid = true;
      for (const key of url.searchParams.keys()) {
        if (!['roomIndex', 'mode', 'players'].includes(key) || url.searchParams.getAll(key).length !== 1) valid = false;
      }
      if (url.searchParams.has('mode')) {
        filters.mode = url.searchParams.get('mode');
        if (!['solo', 'coop'].includes(filters.mode)) valid = false;
      }
      if (url.searchParams.has('roomIndex')) {
        const value = url.searchParams.get('roomIndex');
        filters.roomIndex = Number(value);
        if (!/^(0|[1-9][0-9]{0,2})$/.test(value) || filters.roomIndex > 255) valid = false;
      }
      if (url.searchParams.has('players')) {
        const value = url.searchParams.get('players');
        filters.players = Number(value);
        if (!/^[1-6]$/.test(value) || filters.mode === 'solo' && filters.players !== 1 || filters.mode === 'coop' && filters.players < 2) valid = false;
      }
      const body = JSON.stringify(valid ? { entries: leaderboard.list(filters) } : { error: 'Invalid leaderboard filters' });
      res.writeHead(valid ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
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
    else createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
  });
  const online = attachOnline(server, leaderboard, options.online);
  const close = server.close.bind(server);
  server.close = callback => { online.close(); return close(callback); };
  server.once('close', () => online.close());
  return server;
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
