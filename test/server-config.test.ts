import test from 'node:test';
import assert from 'node:assert/strict';
import {serverConfig} from '../src/server/config.js';
import {buildServer} from '../src/server/main.js';

test('container networking is explicit and host configuration rejects URL syntax', () => {
  const defaults = serverConfig({});
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.port, 38100);
  assert.deepEqual([...defaults.allowedHosts], ['localhost', '127.0.0.1', '[::1]']);
  const configured = serverConfig({HOST: '0.0.0.0', PORT: '8080', VERITAS_ALLOWED_HOSTS: 'veritas.example.test, veritas.internal'});
  assert.equal(configured.host, '0.0.0.0');
  assert.equal(configured.port, 8080);
  assert.ok(configured.allowedHosts.has('veritas.example.test'));
  for (const PORT of ['', '0', '-1', '65536', '1.5', 'bad']) assert.throws(() => serverConfig({PORT}));
  for (const host of ['*', 'https://example.test', 'example.test:80', 'user@example.test', 'example.test/path', 'example.test?x=1']) {
    assert.throws(() => serverConfig({VERITAS_ALLOWED_HOSTS: host}));
  }
});

test('health probes and configured hosts work while cross-origin requests remain rejected', async () => {
  const previous = process.env.VERITAS_ALLOWED_HOSTS;
  process.env.VERITAS_ALLOWED_HOSTS = 'veritas.example.test';
  const {app} = await buildServer({ui: false});
  try {
    const health = await app.inject({url: '/healthz', headers: {host: 'localhost'}});
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), {status: 'ok'});
    assert.equal((await app.inject({url: '/healthz', headers: {host: 'veritas.example.test', origin: 'https://veritas.example.test'}})).statusCode, 200);
    assert.equal((await app.inject({url: '/healthz', headers: {host: 'evil.test'}})).statusCode, 403);
    assert.equal((await app.inject({url: '/healthz', headers: {host: 'veritas.example.test', origin: 'https://evil.test'}})).statusCode, 403);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.VERITAS_ALLOWED_HOSTS;
    else process.env.VERITAS_ALLOWED_HOSTS = previous;
  }
});
