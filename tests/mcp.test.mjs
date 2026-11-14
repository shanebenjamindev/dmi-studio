import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

// The Claude connector (server/mcp.ts, server/video-mcp.ts): OAuth, the tools, and that they keep each person's rights.
// Drive and HyperFrames folders point into the temporary directory: nothing touches a real Google Drive.
const root = path.resolve(import.meta.dirname, '..');
async function start(dir) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: path.join(dir, 'data'), DRIVE_DIR: path.join(dir, 'drive'), HYPERFRAMES_DIR: path.join(dir, 'hf'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
    const check = () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check);
    child.once('exit', () => { clearTimeout(t); reject(new Error('Server failed to start: ' + output)); });
  });
  return { origin: `http://127.0.0.1:${port}`, async close() { const done = once(child, 'exit'); child.kill(); await done; } };
}

test('Claude connector: OAuth, tools, rights and safety', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dms-mcp-'));
  await mkdir(path.join(dir, 'drive'), { recursive: true });
  const server = await start(dir);
  const base = server.origin;
  const json = (method, url, body, headers = {}) => fetch(base + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const cookieOf = (r) => (r.headers.get('set-cookie') || '').match(/dms_sid=[^;]+/)?.[0];
  try {
    const admin = cookieOf(await json('POST', '/api/auth/setup', { email: 'boss@example.test', name: 'Boss', password: 'Passw0rd!long', code: 'test-setup-only' }));
    assert.ok(admin, 'admin signed in');

    // O1, O2: discovery and the 401 that points Claude at it
    let r = await fetch(base + '/.well-known/oauth-protected-resource/api/mcp');
    assert.equal((await r.json()).resource, base + '/api/mcp');
    for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) assert.equal((await (await fetch(base + p)).json()).token_endpoint, base + '/api/oauth/token');
    r = await json('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate') || '', /resource_metadata=/);

    // O3: registration
    assert.equal((await json('POST', '/api/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).status, 400);
    const client = await (await json('POST', '/api/oauth/register', { redirect_uris: ['http://localhost:9999/cb'], client_name: 'Test' })).json();
    assert.ok(client.client_id);

    const redirect = 'http://localhost:9999/cb';
    async function authorize(cookie) {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 'st' });
      const page = await (await fetch(base + '/api/oauth/authorize?' + q, { headers: { cookie }, redirect: 'manual' })).text();
      const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1];
      const form = (extra) => fetch(base + '/api/oauth/authorize', { method: 'POST', redirect: 'manual', headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams([...q, ...extra]) });
      return { verifier, q, csrf, form };
    }
    const token = (b) => fetch(base + '/api/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(b) });
    async function connect(cookie) {
      const a = await authorize(cookie);
      const loc = new URL((await a.form([['csrf', a.csrf], ['decision', 'allow']])).headers.get('location'));
      assert.equal(loc.searchParams.get('state'), 'st');
      const t = await token({ grant_type: 'authorization_code', code: loc.searchParams.get('code'), client_id: client.client_id, redirect_uri: redirect, code_verifier: a.verifier });
      assert.equal(t.status, 200);
      return t.json();
    }

    // O4, O5, O6: signed out, wrong address, forged approval
    r = await fetch(base + '/api/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' }), { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /^\/#oauth\?/);
    r = await fetch(base + '/api/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'http://localhost:1/x', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' }), { headers: { cookie: admin }, redirect: 'manual' });
    assert.equal(r.status, 400);
    const forged = await authorize(admin);
    assert.equal((await forged.form([['csrf', 'nope'], ['decision', 'allow']])).status, 403);

    // O7, O8: a code works once, with its own verifier
    const a1 = await authorize(admin);
    const code1 = new URL((await a1.form([['csrf', a1.csrf], ['decision', 'allow']])).headers.get('location')).searchParams.get('code');
    assert.equal((await token({ grant_type: 'authorization_code', code: code1, client_id: client.client_id, redirect_uri: redirect, code_verifier: 'x'.repeat(43) })).status, 400);
    assert.equal((await token({ grant_type: 'authorization_code', code: code1, client_id: client.client_id, redirect_uri: redirect, code_verifier: a1.verifier })).status, 400);

    // O9: refresh rotates
    const first = await connect(admin);
    const refreshed = await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id });
    assert.equal(refreshed.status, 200);
    assert.equal((await token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id })).status, 400);
    const A = (await refreshed.json()).access_token;

    let id = 0;
    const rpc = async (access, method, params) => {
      const res = await json('POST', '/api/mcp', { jsonrpc: '2.0', id: ++id, method, params }, { authorization: 'Bearer ' + access });
      return res.status === 202 ? null : res.json();
    };
    const call = async (access, name, args = {}) => {
      const x = (await rpc(access, 'tools/call', { name, arguments: args })).result;
      const text = x.content.find((c) => c.type === 'text')?.text || '';
      let v; try { v = JSON.parse(text); } catch { v = text; }
      return { err: !!x.isError, v };
    };

    // T1–T5: protocol and tools
    assert.equal((await rpc(A, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).result.protocolVersion, '2025-06-18');
    assert.equal((await json('POST', '/api/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization: 'Bearer ' + A })).status, 202);
    const names = (await rpc(A, 'tools/list')).result.tools.map((t) => t.name);
    for (const n of ['whoami', 'list_tasks', 'create_task', 'task_workflow', 'list_customers', 'list_video_projects', 'publish_render']) assert.ok(names.includes(n), n);
    // P6: nothing reaches SQL, accounts or locking
    assert.ok(!names.some((n) => /sql|delete|lock|role|password/.test(n)));

    assert.equal((await call(A, 'whoami')).v.email, 'boss@example.test');
    const made = await call(A, 'create_task', { title: 'Viết kịch bản', due: '2026-12-01', description: 'mô tả' });
    assert.equal(made.err, false);
    const tid = made.v.id;
    assert.equal((await call(A, 'update_task', { task_id: tid, title: 'Viết kịch bản (sửa)' })).err, false);
    assert.equal((await call(A, 'comment_task', { task_id: tid, text: 'Đã gửi khách' })).err, false);
    const got = (await call(A, 'get_task', { task_id: tid })).v;
    assert.equal(got.title, 'Viết kịch bản (sửa)');
    assert.equal(got.due, '2026-12-01 23:59');
    assert.equal(got.comments.length, 1);
    assert.ok((await call(A, 'list_tasks', { relation: 'created' })).v.tasks.some((t) => t.id === tid));
    // T2, T3: bad input and missing records answer as tool errors
    assert.equal((await call(A, 'create_task', { title: 'x', due: 'hôm nay' })).err, true);
    assert.equal((await call(A, 'get_task', { task_id: 'tk_missing' })).err, true);
    assert.equal((await rpc(A, 'tools/call', { name: 'nope' })).error.code, -32602);

    // T4: changes are logged as the person, from Claude
    const db = new DatabaseSync(path.join(dir, 'data', 'studio.db'));
    assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE agent = 'Claude (MCP)' AND user_name = 'Boss'").get().n > 0);

    // P1: a member connects and keeps a member's rights
    assert.equal((await json('POST', '/api/users', { email: 'mia@example.test', name: 'Mia', password: 'Passw0rd!long', role: 'member' }, { cookie: admin })).status, 201);
    const mia = cookieOf(await json('POST', '/api/auth/login', { email: 'mia@example.test', password: 'Passw0rd!long' }));
    const M = (await connect(mia)).access_token;
    assert.equal((await call(M, 'whoami')).v.email, 'mia@example.test');
    assert.equal((await call(M, 'update_task', { task_id: tid, title: 'chiếm' })).err, true);
    assert.ok(!(await call(M, 'list_tasks')).v.tasks.some((t) => t.id === tid));
    // P4: a team's tasks are for its leaders
    assert.equal((await call(M, 'list_tasks', { scope: 'team' })).err, true);

    // T7: a render must come from the project's own HyperFrames folder
    const data = JSON.stringify({ sources: [], sheet: null });
    db.prepare("INSERT INTO projects(id,title,aspect,data,customer_id,created_at,updated_at) VALUES('p_t1','Video Test','9:16',?,NULL,1,1)").run(data);
    const folder = path.join(dir, 'hf', 'video-test-p_t1');
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, 'out.mp4'), Buffer.from('not really a video'));
    await writeFile(path.join(dir, 'outside.mp4'), Buffer.from('x'));
    assert.equal((await call(A, 'publish_render', { project_id: 'p_t1', file: '../outside.mp4' })).err, true);
    assert.equal((await call(A, 'publish_render', { project_id: 'p_t1', file: path.join(dir, 'outside.mp4') })).err, true);
    assert.equal((await call(A, 'publish_render', { project_id: 'p_t1', file: 'out.mp4' })).err, false);
    assert.equal((await call(A, 'get_video_project', { project_id: 'p_t1' })).v.renders.length, 1);
    db.close();

    // M3: a person sees the Claude apps connected to their account and takes one back; nobody else can.
    const listed = await (await json('GET', '/api/mcp/connections', undefined, { cookie: admin })).json();
    assert.deepEqual(listed.map((c) => c.name), ['Test']);
    assert.equal((await json('DELETE', `/api/mcp/connections/${client.client_id}`, undefined, { cookie: admin })).status, 200);
    assert.equal((await json('POST', '/api/mcp', { jsonrpc: '2.0', id: 8, method: 'tools/list' }, { authorization: 'Bearer ' + A })).status, 401);
    assert.equal((await call(M, 'whoami')).v.email, 'mia@example.test', 'revoking touches only the revoker\'s own tokens');
    assert.deepEqual(await (await json('GET', '/api/mcp/connections', undefined, { cookie: admin })).json(), []);
    assert.equal((await json('GET', '/api/mcp/connections')).status, 401);

    // O10: a locked account's token stops working
    const miaId = (await (await json('GET', '/api/auth/me', undefined, { cookie: mia })).json()).user.id;
    assert.equal((await json('PUT', `/api/users/${miaId}`, { disabled: true }, { cookie: admin })).status, 200);
    assert.equal((await json('POST', '/api/mcp', { jsonrpc: '2.0', id: 9, method: 'tools/list' }, { authorization: 'Bearer ' + M })).status, 401);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
