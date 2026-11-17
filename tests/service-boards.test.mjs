import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

// Khách hàng → workspace → board = dịch vụ → công việc (server/service-boards.ts): the boards from before become their
// customers' service boards once, and a board of no service yet becomes one when its admin chooses.
const root = path.resolve(import.meta.dirname, '..');

async function start(dir) {
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, DRIVE_DIR: path.join(dir, 'drive'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
    child.stdout.on('data', () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } });
    child.once('exit', () => reject(new Error(output)));
  });
  const call = async (method, url, body, cookie) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json(), cookie: (r.headers.get('set-cookie') || '').match(/dms_sid=[^;]+/)?.[0] };
  };
  return { call, close: async () => { const done = once(child, 'exit'); child.kill(); await done; } };
}

test('the boards from before become their customers\' service boards, once; a board of no service is linked by its admin', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-service-boards-'));
  await mkdir(path.join(dir, 'drive'), { recursive: true });
  let server = await start(dir);
  try {
    const ac = (await server.call('POST', '/api/auth/setup', { email: 'boss@example.test', name: 'Boss', password: 'Passw0rd!long', code: 'test-setup-only' })).cookie;
    const svc = async (name) => (await server.call('POST', '/api/admin/services', { name }, ac)).data.id;
    const web = await svc('Website'), ads = await svc('Meta Ads'), lsa = await svc('LSA Ads');
    const flawless = (await server.call('POST', '/api/customers', { name: 'Flawless', databaseOnly: true }, ac)).data.id;
    const summer = (await server.call('POST', '/api/customers', { name: 'SummerBreeze', databaseOnly: true }, ac)).data.id;
    const loner = (await server.call('POST', '/api/customers', { name: 'Không workspace', databaseOnly: true }, ac)).data.id;
    // Services of Flawless and of the customer with no workspace (their boards are made now; taken away below).
    const proj = async (customerId, serviceId) => (await server.call('POST', '/api/task-projects/for-service', { customerId, serviceId }, ac)).data.id;
    const fWeb = await proj(flawless, web), fAds = await proj(flawless, ads), lWeb = await proj(loner, web);
    const task = async (title, projectId) => (await server.call('POST', '/api/tasks', { title, projectId }, ac)).data.id;
    const t1 = await task('Sửa trang chủ', fWeb), t2 = await task('Chạy quảng cáo', fAds), t3 = await task('Landing', lWeb);
    await server.close();

    // As it was before: no service boards, a workspace of no customer holding a Flawless board with the three tasks on
    // it under project cards, a SummerBreeze board of one service, and a board of no service.
    const db = new DatabaseSync(path.join(dir, 'studio.db'));
    const now = Date.now(), boss = db.prepare('SELECT id FROM users LIMIT 1').get().id;
    db.exec("DELETE FROM board_lists WHERE board_id IN (SELECT id FROM boards WHERE project_id IS NOT NULL)");
    db.exec("UPDATE board_cards SET board_id = 'b_old' WHERE board_id IN (SELECT id FROM boards WHERE project_id IS NOT NULL)");
    db.exec("DELETE FROM board_services; DELETE FROM boards WHERE project_id IS NOT NULL; DELETE FROM workspaces; DELETE FROM workspace_members; DELETE FROM settings WHERE key = 'service_boards_v1'");
    const ws = db.prepare('INSERT INTO workspaces(id, name, about, owner_id, visibility, created_at, updated_at) VALUES(?,?,?,?,?,?,?)');
    ws.run('w_old', 'Flawless Tint', '', boss, 'private', now, now);
    ws.run('w_summer', 'SummerBreeze', '', boss, 'private', now, now);
    const board = db.prepare('INSERT INTO boards(id, name, bg, created_by, pos, created_at, updated_at, private, workspace_id, customer_id) VALUES(?,?,?,?,?,?,?,1,?,?)');
    board.run('b_old', 'Visibility', 'ocean', boss, 1, now, now, 'w_old', flawless);
    board.run('b_summer', 'Summer Breeze', 'ocean', boss, 2, now, now, 'w_summer', summer);
    board.run('b_plain', 'Việc lẻ', 'ocean', boss, 3, now, now, null, null);
    for (const b of ['b_old', 'b_summer', 'b_plain']) db.prepare("INSERT INTO board_lists(id, board_id, name, pos, created_at) VALUES(?,?,'ACCOUNT',1,?)").run('l_' + b, b, now);
    db.exec("UPDATE board_cards SET list_id = 'l_b_old' WHERE board_id = 'b_old'");
    db.prepare('INSERT INTO board_services(board_id, service_id, created_at) VALUES(?,?,?)').run('b_summer', ads, now);
    db.prepare("INSERT INTO board_cards(id, board_id, list_id, title, pos, created_by, created_at, updated_at, card_kind, work_project_id, customer_id) VALUES('k_pc','b_old','l_b_old','Website',9,?,?,?,'project',?,?)").run(boss, now, now, fWeb, flawless);
    db.close();

    server = await start(dir);
    const where = async (taskId) => { const t = (await server.call('GET', `/api/tasks/${taskId}`, undefined, ac)).data; return t.boardLink?.boardId; };
    const boards = (await server.call('GET', '/api/boards', undefined, ac)).data, byId = new Map(boards.map((b) => [b.id, b]));
    // (1) The workspace of Flawless's board is Flawless's.
    assert.equal((await server.call('GET', '/api/workspaces', undefined, ac)).data.find((w) => w.id === 'w_old').customerId, flawless);
    // (2) A board of one service for a customer is that service's board (the project made for it).
    assert.equal(byId.get('b_summer').needsService, false);
    assert.deepEqual(byId.get('b_summer').services.map((s) => s.name), ['Meta Ads']);
    // (3) Every service of a customer has its board, in the customer's workspace (one made if none), with its tasks.
    const of = (taskId) => byId.get(taskId);
    const [b1, b2, b3] = [await where(t1), await where(t2), await where(t3)];
    assert.deepEqual([of(b1).name, of(b1).workspaceId, of(b1).customerId], ['Website', 'w_old', flawless]);
    assert.deepEqual([of(b2).name, of(b2).workspaceId], ['Meta Ads', 'w_old']);
    assert.equal(of(b3).customerId, loner);
    assert.notEqual(of(b3).workspaceId, 'w_old', 'a workspace made for the customer that had none');
    // The old project card is archived; the old board stays, asking for its service.
    assert.equal((await server.call('GET', '/api/cards/k_pc', undefined, ac)).data.archived, true);
    assert.equal(byId.get('b_old').needsService, true);
    assert.equal(byId.get('b_plain').needsService, true);

    // A board of no service, linked by its admin: in the company's workspace it names its customer too; its tasks of no
    // service become that service's.
    const plainList = (await server.call('GET', '/api/boards/b_plain', undefined, ac)).data.lists[0].id;
    const loose = (await server.call('POST', `/api/lists/${plainList}/cards`, { title: 'Việc chưa có dịch vụ', syncTask: true }, ac)).data;
    assert.equal((await server.call('PUT', '/api/boards/b_plain', { serviceId: lsa }, ac)).status, 400, 'its customer first');
    assert.equal((await server.call('PUT', '/api/boards/b_plain', { serviceId: web, customerId: flawless }, ac)).status, 409, 'Flawless has its Website board');
    assert.equal((await server.call('PUT', '/api/boards/b_plain', { serviceId: lsa, customerId: summer }, ac)).status, 200);
    const plain = (await server.call('GET', '/api/boards/b_plain', undefined, ac)).data;
    assert.deepEqual([plain.needsService, plain.customerId, plain.services.map((s) => s.name)], [false, summer, ['LSA Ads']]);
    const looseTask = (await server.call('GET', `/api/cards/${loose.id}`, undefined, ac)).data.linkedTask.id;
    assert.equal((await server.call('GET', `/api/tasks/${looseTask}`, undefined, ac)).data.project.name, 'LSA Ads');

    // Once: a restart changes nothing more.
    await server.close();
    server = await start(dir);
    assert.equal((await server.call('GET', '/api/boards', undefined, ac)).data.length, boards.length);
  } finally {
    await server.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
