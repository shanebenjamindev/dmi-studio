import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Exercise the real Workers runtime and Cloudflare D1 binding in an isolated test database.
// No production secrets or databases are used by these tests.
const bundle = '.wrangler/test-bundle/worker.js';
function externalTransport() {
  const used = new Set();
  return async request => {
    const url = new URL(request.url);
    if (url.hostname === 'challenges.cloudflare.com') {
      const token = new URLSearchParams(await request.text()).get('response');
      if (token === 'unavailable') return new Response('', { status: 503 });
      const success = !['invalid', 'expired', ''].includes(token) && !(token === 'single-use' && used.has(token));
      used.add(token);
      return Response.json({ success, hostname: token === 'wrong-host' ? 'other.example.test' : 'studio.example.test', action: token === 'fixture-setup-token' ? 'setup' : token === 'wrong-action' ? 'other' : 'login' });
    }
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ email: 'admin@example.test', email_verified: true });
    throw new Error('Unexpected outbound request: database must use D1 binding');
  };
}
function workerOptions(name, transport, extra = {}, withDB = true) {
  return {
    name, modules: true, scriptPath: bundle,
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'],
    bindings: { DMS_RUNTIME: 'cloudflare', CLOUD_STORAGE_ONLY: '1', SETUP_CODE: 'fixture-setup', TURNSTILE_SITE_KEY: 'fixture-site-key', TURNSTILE_SECRET_KEY: 'fixture-secret-key', ...extra },
    ...(withDB ? { d1Databases: { DB: 'fixture-db' } } : {}),
    outboundService: transport,
    serviceBindings: { ASSETS: () => new Response('<html>DM Studio</html>', { headers: { 'content-type': 'text/html' } }) },
  };
}
async function call(mf, method, pathname, body, cookie, headers = {}) {
  if (method === 'POST' && ['/api/auth/setup', '/api/auth/login'].includes(pathname)) {
    body = { turnstileToken: pathname.endsWith('setup') ? 'fixture-setup-token' : 'fixture-valid-token', ...body };
  }
  const res = await mf.dispatchFetch('https://studio.example.test' + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers, data: res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text() };
}

test('Workers: accounts, cookies, cross-isolate Google state, permissions and origin checks', { skip: !existsSync(bundle) }, async () => {
  const transport = externalTransport();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [workerOptions('a', transport), workerOptions('b', transport)] }));
  const wa = await mf.getWorker('a'), wb = await mf.getWorker('b');
  const a = { dispatchFetch: (...args) => wa.fetch(...args) }, b = { dispatchFetch: (...args) => wb.fetch(...args) };
  const db = await mf.getD1Database('DB', 'a');
  try {
    assert.equal((await call(a, 'GET', '/')).status, 200);
    const config = await call(a, 'GET', '/api/auth/config');
    assert.deepEqual(config.data.turnstile, { siteKey: 'fixture-site-key', required: true });
    assert.equal(JSON.stringify(config.data).includes('fixture-secret-key'), false);
    for (const [token, status] of [['', 400], ['invalid', 403], ['expired', 403], ['wrong-host', 403], ['wrong-action', 403], ['unavailable', 503]]) {
      const denied = await call(a, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: token });
      assert.equal(denied.status, status, token);
      assert.equal(denied.cookie, undefined);
    }
    const setup = await call(a, 'POST', '/api/auth/setup', { code: 'fixture-setup', email: 'admin@example.test', password: 'test-password' });
    assert.equal(setup.status, 201, JSON.stringify(setup.data));
    assert.ok(setup.headers.get('set-cookie').includes('Secure'));
    assert.equal((await call(b, 'GET', '/api/auth/me', undefined, setup.cookie)).data.user.email, 'admin@example.test');
    const login = await call(b, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const first = await call(a, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: 'single-use' });
    assert.equal(first.status, 200);
    const replayToken = await call(b, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: 'single-use' });
    assert.equal(replayToken.status, 403);
    assert.equal(replayToken.cookie, undefined);
    assert.equal((await call(a, 'GET', '/api/users')).status, 401);
    assert.equal((await call(a, 'POST', '/api/auth/logout', {}, login.cookie, { origin: 'https://other.test' })).status, 403);
    assert.equal((await call(a, 'POST', '/api/customers', { name: 'No temporary files' }, login.cookie)).status, 400);
    assert.equal((await call(a, 'PUT', '/api/google/config', { clientId: 'fixture-client', clientSecret: 'fixture-secret' }, login.cookie)).status, 200);
    const redirect = await call(a, 'GET', '/api/auth/google');
    assert.equal(redirect.status, 302);
    const googleUrl = new URL(redirect.headers.get('location'));
    assert.equal(googleUrl.searchParams.get('redirect_uri'), 'https://studio.example.test/api/google/callback');
    const state = googleUrl.searchParams.get('state');
    const callback = await call(b, 'GET', `/api/google/callback?state=${state}&code=fixture-code`);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/');
    assert.ok(callback.cookie);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM oauth_states').first()).n, 0);
    const replay = await call(a, 'GET', `/api/google/callback?state=${state}&code=fixture-code`);
    assert.equal(replay.cookie, undefined);
    for (let i = 0; i < 8; i++) assert.equal((await call(i % 2 ? a : b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 401);
    assert.equal((await call(b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 429);
  } finally { await mf.dispose(); }
});

test('Workers: missing D1 binding returns 503 while static UI remains available', { skip: !existsSync(bundle) }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(workerOptions('missing-db', externalTransport(), {}, false)));
  try {
    assert.equal((await call(mf, 'GET', '/')).status, 200);
    assert.equal((await call(mf, 'GET', '/api/auth/me')).status, 503);
  } finally { await mf.dispose(); }
});


test('Workers: Turnstile configuration cannot silently disable verification', { skip: !existsSync(bundle) }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(workerOptions('missing-turnstile', externalTransport(), { TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' })));
  try {
    const config = await call(mf, 'GET', '/api/auth/config');
    assert.equal(config.data.turnstile.required, true);
    const login = await call(mf, 'POST', '/api/auth/login', { email: 'test@example.test', password: 'test-password' });
    assert.equal(login.status, 503);
    assert.equal(login.cookie, undefined);
  } finally { await mf.dispose(); }
});
