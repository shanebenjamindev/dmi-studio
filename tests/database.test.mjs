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
async function start(dataDir, extra = {}) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => output += b);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Startup timed out')); }, 10000);
      const onData = () => { if (output.includes('Database:')) { cleanup(); resolve(); } };
      const onExit = () => { cleanup(); reject(new Error('Server failed to start: ' + output)); };
      function cleanup() { clearTimeout(timeout); child.stdout.off('data', onData); child.off('exit', onExit); }
      child.stdout.on('data', onData); child.once('exit', onExit);
      onData();
    });
  } catch (e) { child.kill(); throw e; }
  return {
    async call(method, url, body, cookie) {
      const res = await fetch(origin + url, {
        method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
      });
      return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
    },
    async close() { const done = once(child, 'exit'); child.kill(); await done; },
  };
}

test('two backend instances share accounts, sessions, settings and customer notes; permissions survive restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-db-'));
  const servers = [];
  try {
    const a = await start(dir); servers.push(a);
    const setups = await Promise.all(['a', 'b'].map(name => a.call('POST', '/api/auth/setup', {
      code: 'test-setup-only', name, email: `${name}@example.test`, password: 'test-password-123',
    })));
    assert.deepEqual(setups.map(r => r.status).sort(), [201, 409]);
    const admin = setups.find(r => r.status === 201);
    const b = await start(dir); servers.push(b);
    assert.equal((await b.call('GET', '/api/auth/me', undefined, admin.cookie)).data.user.id, admin.data.user.id);
    assert.equal((await b.call('GET', '/api/users')).status, 401);
    const member = await a.call('POST', '/api/users', { email: 'member@example.test', password: 'member-password', role: 'member' }, admin.cookie);
    assert.equal(member.status, 201);
    const login = await b.call('POST', '/api/auth/login', { email: 'member@example.test', password: 'member-password' });
    assert.equal(login.status, 200);
    assert.equal((await a.call('GET', '/api/users', undefined, login.cookie)).status, 403);
    assert.equal((await a.call('PUT', '/api/settings/defaults', { language: 'vi' }, admin.cookie)).status, 200);
    assert.equal((await b.call('GET', '/api/providers', undefined, login.cookie)).data.defaults.language, 'vi');
    const customer = await a.call('POST', '/api/customers', { name: 'Shared customer', notes: 'initial' }, admin.cookie);
    assert.equal(customer.status, 201);
    const cid = customer.data.id;
    assert.equal((await b.call('PUT', `/api/customers/${cid}`, { notes: 'from second device' }, login.cookie)).status, 200);
    assert.equal((await a.call('GET', `/api/customers/${cid}`, undefined, admin.cookie)).data.notes, 'from second device');
    assert.equal((await b.call('PUT', `/api/customers/${cid}`, { name: 'Forbidden rename' }, login.cookie)).status, 403);
    const users = await b.call('GET', '/api/users', undefined, admin.cookie);
    assert.equal(users.data.length, 2);
    assert.equal('pass' in users.data[0], false);
    await a.close(); servers.splice(servers.indexOf(a), 1);
    const restarted = await start(dir); servers.push(restarted);
    assert.equal((await restarted.call('GET', `/api/customers/${cid}`, undefined, admin.cookie)).data.notes, 'from second device');
    assert.equal((await restarted.call('PUT', `/api/users/${member.data.id}`, { disabled: true }, admin.cookie)).status, 200);
    assert.equal((await b.call('GET', '/api/customers', undefined, login.cookie)).status, 401);
  } finally { await Promise.all(servers.map(s => s.close())); await rm(dir, { recursive: true, force: true }); }
});

test('free-cloud file policy blocks temporary disk storage while database features work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-cloud-policy-'));
  let server;
  try {
    server = await start(dir, { CLOUD_STORAGE_ONLY: '1' });
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', email: 'cloud@example.test', password: 'test-password' });
    assert.equal(admin.status, 201);
    const places = await server.call('GET', '/api/workspace/places', undefined, admin.cookie);
    assert.ok(places.data.every(p => p.via === 'google'));
    assert.equal((await server.call('GET', '/api/customers', undefined, admin.cookie)).status, 200);
    assert.equal((await server.call('POST', '/api/customers', { name: 'No temp folder' }, admin.cookie)).status, 400);
    assert.equal((await server.call('PUT', '/api/workspace', { loc: { kind: 'fs', dir } }, admin.cookie)).status, 400);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('existing SQLite data survives schema upgrades', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-upgrade-'));
  let server;
  try {
    const db = new DatabaseSync(path.join(dir, 'studio.db'));
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, aspect TEXT NOT NULL DEFAULT '16:9', data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL); INSERT INTO projects VALUES('old', 'Keep this project', '16:9', '{}', 1, 1)");
    db.close();
    server = await start(dir);
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', email: 'upgrade@example.test', password: 'test-password' });
    const projects = await server.call('GET', '/api/projects', undefined, admin.cookie);
    assert.equal(projects.data[0].title, 'Keep this project');
    assert.equal(projects.data[0].customerId, null);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('local Node development uses SQLite independently of retired Turso variables', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-local-'));
  let server;
  try {
    server = await start(dir, { TURSO_DATABASE_URL: 'https://not-used.invalid', TURSO_AUTH_TOKEN: 'not-used' });
    assert.equal((await server.call('GET', '/api/auth/me')).status, 200);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(path.join(dir, 'studio.db')), true);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});
