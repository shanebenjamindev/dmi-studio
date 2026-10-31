import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Exercise the real Workers runtime and Turso HTTP driver against an isolated SQL fixture.
// No production secrets or databases are used by these tests.
const bundle = '.wrangler/test-bundle/worker.js';
function databaseTransport(db) {
  const decode = v => v.type === 'null' ? null : v.type === 'blob' ? Buffer.from(v.base64, 'base64') : v.type === 'integer' ? Number(v.value) : v.value;
  const encode = v => v === null ? { type: 'null' } : typeof v === 'number' ? { type: Number.isInteger(v) ? 'integer' : 'float', value: Number.isInteger(v) ? String(v) : v } : typeof v === 'string' ? { type: 'text', value: v } : { type: 'blob', base64: Buffer.from(v).toString('base64') };
  function execute(stmt) {
    const prepared = db.prepare(stmt.sql);
    const cols = prepared.columns().map(c => ({ name: c.name, decltype: c.type || '' }));
    const args = (stmt.args || []).map(decode);
    let rows = [], changes = 0, rowid = '0';
    if (cols.length) {
      rows = prepared.all(...args).map(row => cols.map(c => encode(row[c.name])));
      if (/^\s*(DELETE|INSERT|UPDATE)/i.test(stmt.sql)) changes = db.prepare('SELECT changes() n').get().n;
    } else {
      const result = prepared.run(...args);
      changes = Number(result.changes); rowid = String(result.lastInsertRowid);
    }
    return { cols, rows, affected_row_count: changes, last_insert_rowid: rowid };
  }
  return async request => {
    const url = new URL(request.url);
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
    if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ email: 'admin@example.test', email_verified: true });
    if (url.hostname !== 'fixture.turso.io') return new Response('Unexpected outbound request', { status: 500 });
    if (!url.pathname.endsWith('/pipeline')) return new Response('', { status: 404 });
    const body = await request.json();
    const results = body.requests.map(r => {
      try {
        let response;
        if (r.type === 'execute') response = { type: r.type, result: execute(r.stmt) };
        else if (r.type === 'sequence') { db.exec(r.sql); response = { type: r.type }; }
        else if (r.type === 'close') response = { type: r.type };
        else throw new Error('Unsupported fixture request: ' + r.type);
        return { type: 'ok', response };
      } catch (e) { return { type: 'error', error: { message: e.message, code: 'SQLITE_ERROR' } }; }
    });
    return Response.json({ baton: null, base_url: null, results });
  };
}
function worker(transport, extra = {}) {
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: bundle,
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'],
    bindings: { DMS_RUNTIME: 'cloudflare', CLOUD_STORAGE_ONLY: '1', TURSO_DATABASE_URL: 'https://fixture.turso.io', TURSO_AUTH_TOKEN: 'test-only', SETUP_CODE: 'fixture-setup', ...extra },
    outboundService: transport,
    serviceBindings: { ASSETS: () => new Response('<html>DM Studio</html>', { headers: { 'content-type': 'text/html' } }) },
  }));
}
async function call(mf, method, pathname, body, cookie, headers = {}) {
  const res = await mf.dispatchFetch('https://studio.example.test' + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers, data: res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text() };
}

test('Workers: accounts, cookies, cross-isolate Google state, permissions and origin checks', { skip: !existsSync(bundle) }, async () => {
  const db = new DatabaseSync(':memory:');
  const transport = databaseTransport(db);
  const a = worker(transport), b = worker(transport);
  try {
    assert.equal((await call(a, 'GET', '/')).status, 200);
    const setup = await call(a, 'POST', '/api/auth/setup', { code: 'fixture-setup', email: 'admin@example.test', password: 'test-password' });
    assert.equal(setup.status, 201, JSON.stringify(setup.data));
    assert.ok(setup.headers.get('set-cookie').includes('Secure'));
    assert.equal((await call(b, 'GET', '/api/auth/me', undefined, setup.cookie)).data.user.email, 'admin@example.test');
    const login = await call(b, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
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
    assert.equal(db.prepare('SELECT COUNT(*) n FROM oauth_states').get().n, 0);
    const replay = await call(a, 'GET', `/api/google/callback?state=${state}&code=fixture-code`);
    assert.equal(replay.cookie, undefined);
    for (let i = 0; i < 8; i++) assert.equal((await call(i % 2 ? a : b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 401);
    assert.equal((await call(b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 429);
  } finally { await a.dispose(); await b.dispose(); db.close(); }
});

test('Workers: missing secrets return 503 while static UI remains available', { skip: !existsSync(bundle) }, async () => {
  const mf = worker(() => new Response('', { status: 500 }), { TURSO_AUTH_TOKEN: '' });
  try {
    assert.equal((await call(mf, 'GET', '/')).status, 200);
    assert.equal((await call(mf, 'GET', '/api/auth/me')).status, 503);
  } finally { await mf.dispose(); }
});
