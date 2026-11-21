import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { build } from '../build.mjs';
import { createApp } from '../server.mjs';

let server, base;

before(async () => {
  build();
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// fetch() normalises paths, so traversal attempts go through http.request.
function raw(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    request(base + '/', { method, path }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject).end();
  });
}

test('serves the game page, script and stylesheet', async () => {
  const page = await raw('/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body, /<script src="game.js"><\/script>/);

  const js = await raw('/game.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /text\/javascript/);
  assert.match(js.body, /window\.deadRooms/);

  const css = await raw('/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
});

test('serves the single-file build with everything inlined', async () => {
  const single = await raw('/dead-rooms.html');
  assert.equal(single.status, 200);
  assert.doesNotMatch(single.body, /src="game.js"|href="style.css"/);
  assert.match(single.body, /window\.deadRooms/);
});

test('HEAD sends headers only', async () => {
  const res = await raw('/game.js', 'HEAD');
  assert.equal(res.status, 200);
  assert.ok(Number(res.headers['content-length']) > 50_000);
  assert.equal(res.body, '');
});

test('original audio, fonts and previews have browser-compatible MIME types', async () => {
  for (const [path, type] of [
    ['/assets/sounds/Effect.Explosion.mp3', 'audio/mpeg'],
    ['/assets/fonts/calibri.woff', 'font/woff'],
    ['/assets/previews/01.jpg', 'image/jpeg'],
  ]) {
    const response = await raw(path, 'HEAD');
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['content-type'], type, path);
    assert.ok(Number(response.headers['content-length']) > 0, path);
    assert.equal(response.body, '');
  }
});

test('rejects missing files, bad paths and other methods', async () => {
  assert.equal((await raw('/nope.js')).status, 404);
  assert.equal((await raw('/../package.json')).status, 404);
  assert.equal((await raw('/%2e%2e/package.json')).status, 404);
  assert.equal((await raw('/..%2fserver.mjs')).status, 404);
  assert.equal((await raw('/%E0%A4%A')).status, 400);
  assert.equal((await raw('/', 'POST')).status, 405);
});
