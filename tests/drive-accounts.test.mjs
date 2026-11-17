import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');

async function start(dataDir) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_URL: '',
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
      TURNSTILE_SITE_KEY: '',
      TURNSTILE_SECRET_KEY: '',
      DMS_RUNTIME: '',
      CLOUD_STORAGE_ONLY: '',
      SETUP_CODE: 'test-setup-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Startup timed out: ' + output)); }, 10000);
      const onData = () => { if (output.includes('Database:')) { cleanup(); resolve(); } };
      const onExit = () => { cleanup(); reject(new Error('Server failed: ' + output)); };
      function cleanup() { clearTimeout(timeout); child.stdout.off('data', onData); child.off('exit', onExit); }
      child.stdout.on('data', onData);
      child.once('exit', onExit);
      onData();
    });
  } catch (e) {
    child.kill();
    throw e;
  }
  const call = async (method, url, body, cookie) => {
    const res = await fetch(origin + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  return { call, close: async () => { child.kill(); await once(child, 'exit').catch(() => {}); } };
}

test('per-user Google Drive accounts isolate places, browse (403), reports, and keep bound folders readable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-drive-accounts-'));
  let server;
  try {
    server = await start(dir);

    // 1. Setup User A (admin) and User B (regular member with workspace + editor page access).
    const setupA = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'User A', email: 'user-a@example.test', password: 'test-password' });
    assert.equal(setupA.status, 201);
    const cookieA = setupA.cookie;
    const userA = setupA.data.user;

    const createB = await server.call('POST', '/api/users', { name: 'User B', email: 'user-b@example.test', password: 'test-password' }, cookieA);
    assert.equal(createB.status, 201, JSON.stringify(createB.data));
    const userB = createB.data;
    const loginB = await server.call('POST', '/api/auth/login', { email: 'user-b@example.test', password: 'test-password' });
    assert.equal(loginB.status, 200);
    const cookieB = loginB.cookie;

    // Configure OAuth client id so /api/google/login works for non-admins as well.
    assert.equal((await server.call('PUT', '/api/google/config', { clientId: 'test-client-id', clientSecret: 'test-secret' }, cookieA)).status, 200);
    const nonAdminLoginRedirect = await server.call('GET', '/api/google/login', undefined, cookieB);
    assert.equal(nonAdminLoginRedirect.status, 302);
    assert.ok(String(nonAdminLoginRedirect.headers.get('location') || '').includes('accounts.google.com'));

    // 2. Seed separate Drive connections for User A and User B directly in user_google_accounts.
    const db = new DatabaseSync(path.join(dir, 'studio.db'));
    const now = Date.now();
    db.prepare(
      `INSERT INTO user_google_accounts(id, user_id, email, name, picture, refresh, scopes, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run('ga_a', userA.id, 'drive-a@gmail.com', 'Drive A', '', 'secret-refresh-token-A', 'drive', now, now);
    db.prepare(
      `INSERT INTO user_google_accounts(id, user_id, email, name, picture, refresh, scopes, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)`
    ).run('ga_b', userB.id, 'drive-b@gmail.com', 'Drive B', '', 'secret-refresh-token-B', 'drive', now, now);

    // 3. /api/google/status returns only caller's Gmail accounts and never exposes refresh tokens.
    const statusA = await server.call('GET', '/api/google/status', undefined, cookieA);
    assert.equal(statusA.status, 200);
    assert.deepEqual(statusA.data.accounts.map((a) => a.email), ['drive-a@gmail.com']);
    assert.equal(JSON.stringify(statusA.data).includes('secret-refresh-token'), false);

    const statusB = await server.call('GET', '/api/google/status', undefined, cookieB);
    assert.equal(statusB.status, 200);
    assert.deepEqual(statusB.data.accounts.map((a) => a.email), ['drive-b@gmail.com']);
    assert.equal(JSON.stringify(statusB.data).includes('secret-refresh-token'), false);

    // 4. /api/workspace/places returns only caller's Gmail drives (User A never sees User B's and vice versa).
    const placesA = await server.call('GET', '/api/workspace/places', undefined, cookieA);
    assert.equal(placesA.status, 200);
    assert.ok(placesA.data.some((p) => p.via === 'google' && p.account === 'drive-a@gmail.com'));
    assert.equal(placesA.data.some((p) => p.account === 'drive-b@gmail.com'), false);

    const placesB = await server.call('GET', '/api/workspace/places', undefined, cookieB);
    assert.equal(placesB.status, 200);
    assert.ok(placesB.data.some((p) => p.via === 'google' && p.account === 'drive-b@gmail.com'));
    assert.equal(placesB.data.some((p) => p.account === 'drive-a@gmail.com'), false);

    // 5. User B cannot browse, inspect root via ?at=, or create folders on User A's Drive (403).
    const browseForbidden = await server.call('POST', '/api/workspace/browse', {
      loc: { kind: 'gdrive', account: 'drive-a@gmail.com', id: 'root' },
    }, cookieB);
    assert.equal(browseForbidden.status, 403);

    const mkdirForbidden = await server.call('POST', '/api/workspace/folders', {
      loc: { kind: 'gdrive', account: 'drive-a@gmail.com', id: 'root' },
      name: 'Should Fail',
    }, cookieB);
    assert.equal(mkdirForbidden.status, 403);

    const viewAtForbidden = await server.call(
      'GET',
      `/api/workspace?at=${encodeURIComponent(JSON.stringify({ kind: 'gdrive', account: 'drive-a@gmail.com', id: 'root' }))}`,
      undefined,
      cookieB
    );
    assert.equal(viewAtForbidden.status, 403);

    // 6. User A owns a customer bound to drive-a@gmail.com and invites User B; User B cannot re-bind to B or bind A's Drive on A's behalf.
    const cust = (await server.call('POST', '/api/customers', { name: 'Bound Client', databaseOnly: true }, cookieA)).data;
    const memberRes = await server.call('PUT', `/api/customers/${cust.id}/members/${userB.id}`, { level: 'admin' }, cookieA);
    assert.equal(memberRes.status, 200);

    // User A cannot bind User B's Gmail onto customer or brand (403).
    const bindFolderForbidden = await server.call('PUT', `/api/customers/${cust.id}/folder`, {
      loc: { kind: 'gdrive', account: 'drive-b@gmail.com', id: 'folder_b' },
    }, cookieA);
    assert.equal(bindFolderForbidden.status, 403);

    const brandDriveForbidden = await server.call('POST', `/api/customers/${cust.id}/brands`, {
      name: 'Hijack Brand',
      driveFolder: { account: 'drive-b@gmail.com', id: 'folder_b', label: 'Drive B' },
    }, cookieA);
    assert.equal(brandDriveForbidden.status, 403);

    // Bind a pre-existing Drive folder owned by drive-a@gmail.com to the customer in DB (simulating already-bound customer folder).
    db.prepare('UPDATE customers SET folder = ?, gloc = ? WHERE id = ?').run(
      'Bound Client',
      JSON.stringify({ account: 'drive-a@gmail.com', id: 'fld_bound_123', label: 'Drive A › Bound Client' }),
      cust.id
    );
    // User B (member without drive-a@gmail.com linked) reading GET /api/customers/:id is NOT blocked with 403 for the bound folder;
    // the server resolves it using drive-a's stored token rather than rejecting User B's ownership.
    const custReadByB = await server.call('GET', `/api/customers/${cust.id}`, undefined, cookieB);
    assert.equal(custReadByB.status, 200);
    assert.equal(custReadByB.data.account, 'drive-a@gmail.com');

    // 7. Reports Drive video picker rejects User B querying User A's Drive (403).
    const rep = (await server.call('POST', '/api/reports', { customerId: cust.id, title: 'Drive Isolation Report' }, cookieA)).data;
    const repBrowseForbidden = await server.call(
      'GET',
      `/api/reports/${rep.id}/drive-browse?account=${encodeURIComponent('drive-a@gmail.com')}&id=root`,
      undefined,
      cookieB
    );
    assert.equal(repBrowseForbidden.status, 403);

    const repThumbForbidden = await server.call(
      'GET',
      `/api/reports/${rep.id}/video-thumbnail/file12345?account=${encodeURIComponent('drive-a@gmail.com')}`,
      undefined,
      cookieB
    );
    assert.equal(repThumbForbidden.status, 403);

    const repLinkForbidden = await server.call(
      'POST',
      `/api/reports/${rep.id}/link-videos`,
      { videos: [{ id: 'file12345', account: 'drive-a@gmail.com' }] },
      cookieB
    );
    assert.equal(repLinkForbidden.status, 403);

    // 8. Deleting User A's email while signed in as User B cannot unlink User A's account; User B can only unlink their own.
    const delOther = await server.call('DELETE', `/api/google/accounts/${encodeURIComponent('drive-a@gmail.com')}`, undefined, cookieB);
    assert.equal(delOther.status, 200);
    assert.deepEqual((await server.call('GET', '/api/google/status', undefined, cookieA)).data.accounts.map((a) => a.email), ['drive-a@gmail.com']);

    const delOwn = await server.call('DELETE', `/api/google/accounts/${encodeURIComponent('drive-b@gmail.com')}`, undefined, cookieB);
    assert.equal(delOwn.status, 200);
    assert.deepEqual(delOwn.data.accounts, []);
    assert.deepEqual((await server.call('GET', '/api/google/status', undefined, cookieA)).data.accounts.map((a) => a.email), ['drive-a@gmail.com']);

    db.close();
  } finally {
    if (server) await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

