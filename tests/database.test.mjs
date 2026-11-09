import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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

/** Every task the account may list: its own, and each project's it can open (there is no list of everyone's). */
async function visibleTasks(server, cookie) {
  const meta = (await server.call('GET', '/api/tasks/meta', undefined, cookie)).data;
  const lists = [(await server.call('GET', '/api/tasks', undefined, cookie)).data.tasks];
  for (const p of meta.projects) lists.push((await server.call('GET', `/api/tasks?scope=all&project=${p.id}`, undefined, cookie)).data.tasks);
  return [...new Map(lists.flat().map((t) => [t.id, t])).values()];
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
    assert.equal((await a.call('PUT','/api/auth/profile',{name:'Anonymous'})).status,401);
    assert.equal((await a.call('PUT','/api/auth/profile',{name:' '},login.cookie)).status,400);
    assert.equal((await a.call('PUT','/api/auth/profile',{name:'x'.repeat(121)},login.cookie)).status,400);
    const profile=await a.call('PUT','/api/auth/profile',{name:'Tên cá nhân mới',role:'admin',id:admin.data.user.id,email:admin.data.user.email},login.cookie);
    assert.equal(profile.status,200);
    assert.equal(profile.data.role,'member');assert.equal(profile.data.email,'member@example.test');
    assert.equal((await b.call('GET','/api/auth/me',undefined,login.cookie)).data.user.name,'Tên cá nhân mới');
    assert.equal((await a.call('GET','/api/auth/me',undefined,admin.cookie)).data.user.name,admin.data.user.name);
    assert.equal('pass' in profile.data,false);
    assert.equal((await a.call('GET',`/api/profiles/${member.data.id}`)).status,401);
    const ownProfile=(await a.call('GET',`/api/profiles/${member.data.id}`,undefined,login.cookie)).data;
    assert.equal(ownProfile.canEdit,true);assert.equal(ownProfile.name,'Tên cá nhân mới');
    const otherProfile=(await a.call('GET',`/api/profiles/${admin.data.user.id}`,undefined,login.cookie)).data;
    assert.equal(otherProfile.canEdit,false);assert.equal(otherProfile.id,admin.data.user.id);
    for(const key of ['pass','hasPassword','lastLogin','disabled','sessions'])assert.equal(key in otherProfile,false);
    assert.equal((await a.call('GET','/api/profiles/missing',undefined,login.cookie)).status,404);


    assert.equal((await a.call('PUT', '/api/settings/defaults', { language: 'vi' }, admin.cookie)).status, 200);
    assert.equal((await b.call('GET', '/api/providers', undefined, login.cookie)).data.defaults.language, 'vi');
    const customer = await a.call('POST', '/api/customers', { name: 'Shared customer', notes: 'initial' }, admin.cookie);
    assert.equal(customer.status, 201);
    const cid = customer.data.id;
    await a.call('PUT',`/api/customers/${cid}/members/${member.data.id}`,{level:'normal'},admin.cookie);
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

test('customer association agrees across pages and explicit unlink survives reloads', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-customer-link-'));
  let server;
  try {
    server = await start(dir);
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', email: 'links@example.test', password: 'test-password' });
    const cookie = admin.cookie;
    const clients = path.join(dir, 'workspace', '1. CLIENTS');
    await mkdir(clients, { recursive: true });
    await server.call('PUT', '/api/workspace', { loc: { kind: 'fs', dir: clients } }, cookie);
    const customer = await server.call('POST', '/api/customers', { name: 'Khách hàng Ánh Dương' }, cookie);
    assert.equal(customer.status, 201);
    const workspace = path.join(dir, 'workspace');
    await mkdir(path.join(workspace, '2. MEDIA'), { recursive: true });
    await server.call('PUT', '/api/workspace', { loc: { kind: 'fs', dir: workspace } }, cookie);
    await server.call('GET', '/api/customers', undefined, cookie);
    const choices = await server.call('GET', '/api/customers/all', undefined, cookie);
    assert.deepEqual(choices.data.map(c => c.id), [customer.data.id]);
    const project = await server.call('POST', '/api/projects', { title: 'Drive project' }, cookie);
    assert.equal(project.status, 201);
    const id = project.data.id, cid = customer.data.id;
    // Simulate an existing sheet project before this customer folder was imported.
    const db = new DatabaseSync(path.join(dir, 'studio.db'));
    db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify({ sheet: { form: { customer: 'Khach hang Anh Duong' } } }), id);
    db.close();
    const detail = await server.call('GET', `/api/customers/${cid}`, undefined, cookie);
    assert.equal(detail.data.projects[0].id, id);
    assert.equal((await server.call('GET', '/api/projects', undefined, cookie)).data[0].customerId, cid);
    assert.equal((await server.call('PUT', `/api/projects/${id}`, { customerId: null }, cookie)).data.customerId, null);
    assert.equal((await server.call('GET', '/api/projects', undefined, cookie)).data[0].customerId, null);
    assert.equal((await server.call('GET', `/api/customers/${cid}`, undefined, cookie)).data.projects.length, 0);
    assert.equal((await server.call('POST', `/api/projects/${id}/customer/auto`, undefined, cookie)).data.customerId, cid);
    const invalid = await server.call('POST', `/api/projects/${id}/drive`, { link: 'invalid' }, cookie);
    assert.equal(invalid.status, 400);
    assert.equal((await server.call('GET', `/api/projects/${id}`, undefined, cookie)).data.customerId, cid);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('company departments do not grant board access; direct invitations allow cards and lists to move', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-boards-'));
  let server;
  try {
    server = await start(dir);
    const ac = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const roles = (await server.call('GET', '/api/roles', undefined, ac)).data;
    assert.deepEqual(roles.map(r => r.name), ['Media Execute', 'Account / Sale', 'Content / Script', 'Ads / Performance']);
    const [media, sale] = roles;
    assert.deepEqual(media.pages, ['workspace', 'editor']);
    const all = (await server.call('GET', '/api/boards', undefined, ac)).data;
    assert.equal(all.length, 5);
    // A Media Execute member opens Drive and Trình dựng and sees only the Media Execute board (the company's other boards: admins and the people added).
    const user = await server.call('POST', '/api/users', { name: 'Editor', email: 'ed@example.test', password: 'test-password', teamRole: media.id }, ac);
    assert.equal(user.status, 201);
    assert.equal(user.data.teamRole, media.id);
    const mc = (await server.call('POST', '/api/auth/login', { email: 'ed@example.test', password: 'test-password' })).cookie;
    assert.deepEqual((await server.call('GET', '/api/auth/me', undefined, mc)).data.pages, ['workspace', 'editor']);
    let mine = (await server.call('GET', '/api/boards', undefined, mc)).data;
    assert.deepEqual(mine,[]);
    const mediaBoard=all.find(b=>b.roleId===media.id);
    await server.call('PUT',`/api/boards/${mediaBoard.id}/members/${user.data.id}`,{level:'normal'},ac);
    mine=(await server.call('GET','/api/boards',undefined,mc)).data;
    assert.deepEqual(mine.map(b=>b.name),['Media Execute']);
    const general = all.find(b => b.name === 'Việc chung');
    assert.equal((await server.call('GET', `/api/boards/${general.id}`, undefined, mc)).status, 404);
    assert.equal((await server.call('PUT', `/api/boards/${general.id}/members/${user.data.id}`, { level: 'normal' }, ac)).status, 200);
    assert.ok((await server.call('GET', '/api/boards', undefined, mc)).data.some(b => b.id === general.id));
    const saleBoard = all.find(b => b.roleId === sale.id);
    assert.equal((await server.call('GET', `/api/boards/${saleBoard.id}`, undefined, mc)).status, 404);
    // Cards are added, moved to another list at a place and renamed; lists are reordered by the board's admins only
    // (members work on cards), unless an admin lets members change the board too.
    const board = (await server.call('GET', `/api/boards/${mine.find(b => b.roleId === media.id).id}`, undefined, mc)).data;
    assert.deepEqual(board.lists.map(l => l.name), ['Cần dựng', 'Đang dựng', 'Chờ duyệt', 'Cần sửa', 'Đã giao']);
    const [todo, doing] = board.lists;
    await server.call('POST', `/api/lists/${todo.id}/cards`, { title: 'Dynamic M · Black Friday' }, mc);
    const moved = (await server.call('POST', `/api/lists/${todo.id}/cards`, { title: 'Summer Breeze' }, mc)).data;
    await server.call('POST', `/api/lists/${doing.id}/cards`, { title: 'VizionOne' }, mc);
    assert.equal((await server.call('PUT', `/api/cards/${moved.id}`, { listId: doing.id, index: 0, title: 'Summer Breeze v2' }, mc)).status, 200);
    assert.equal((await server.call('PUT', `/api/lists/${doing.id}`, { index: 0 }, mc)).status, 403);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}`, { name: 'Đổi tên' }, mc)).status, 403);
    assert.equal((await server.call('POST', `/api/boards/${board.id}/labels`, { name: 'Gấp', color: 'red' }, mc)).status, 403);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}`, { memberEdit: true }, mc)).status, 403);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}`, { memberEdit: true }, ac)).status, 200);
    assert.equal((await server.call('PUT', `/api/lists/${doing.id}`, { index: 0 }, mc)).status, 200);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}`, { memberEdit: false }, ac)).status, 200);
    const after = (await server.call('GET', `/api/boards/${board.id}`, undefined, mc)).data;
    assert.equal(after.lists[0].id, doing.id);
    assert.deepEqual(after.lists[0].cards.map(x => x.title), ['Summer Breeze v2', 'VizionOne']);
    assert.deepEqual(after.lists[1].cards.map(x => x.title), ['Dynamic M · Black Friday']);
    // Only admins change roles; a role's pages are enforced on the API.
    assert.equal((await server.call('PUT', `/api/roles/${media.id}`, { pages: [] }, mc)).status, 403);
    assert.equal((await server.call('PUT', `/api/roles/${media.id}`, { pages: ['workspace'] }, ac)).status, 200);
    assert.equal((await server.call('GET', '/api/projects', undefined, mc)).status, 403);
    // Deleting a role keeps its board, for admins (and the people added to it).
    await server.call('DELETE', `/api/roles/${sale.id}`, undefined, ac);
    assert.ok(!(await server.call('GET', '/api/boards', undefined, mc)).data.some(b => b.id === saleBoard.id));
    assert.ok((await server.call('GET', '/api/boards', undefined, ac)).data.some(b => b.id === saleBoard.id));
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Workspace avatars persist, reset and require workspace admin access', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-ws-avatar-'));
  let server;
  try {
    server = await start(dir);
    const cookie = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const user = (await server.call('POST', '/api/users', { name: 'Viewer', email: 'viewer@example.test', password: 'test-password' }, cookie)).data;
    const viewer = (await server.call('POST', '/api/auth/login', { email: 'viewer@example.test', password: 'test-password' })).cookie;
    const workspace = (await server.call('POST', '/api/workspaces', { name: 'Design' }, cookie)).data;
    await server.call('PUT', `/api/workspaces/${workspace.id}/members/${user.id}`, { level: 'observer' }, cookie);
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
    const update = (id, dataUrl, as = cookie) => server.call('PUT', `/api/workspaces/${id}/avatar`, { dataUrl }, as);
    assert.equal((await update(workspace.id, avatar, viewer)).status, 403);
    assert.equal((await update('company', avatar, viewer)).status, 403);
    assert.equal((await update(workspace.id, 'data:image/svg+xml;base64,PHN2Zz4=')).status, 400);
    assert.equal((await update(workspace.id, 'data:image/png;base64,' + 'A'.repeat(410000))).status, 413);
    assert.equal((await update(workspace.id, avatar)).status, 200);
    assert.equal((await update('company', avatar)).status, 200);
    await server.close(); server = await start(dir);
    let workspaces = (await server.call('GET', '/api/workspaces', undefined, viewer)).data;
    assert.equal(workspaces.find(w => w.id === workspace.id).avatar, avatar);
    assert.equal(workspaces.find(w => w.id === 'company').avatar, avatar);
    assert.equal((await update(workspace.id, null)).status, 200);
    workspaces = (await server.call('GET', '/api/workspaces', undefined, viewer)).data;
    assert.equal(workspaces.find(w => w.id === workspace.id).avatar, null);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('boards with tasks can be deleted, cleanly removing cards and tasks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-board-delete-'));
  let server;
  try {
    server = await start(dir);
    const cookie = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const ws = (await server.call('POST', '/api/workspaces', { name: 'Protected' }, cookie)).data;
    const createBoard = async name => (await server.call('POST', '/api/boards', { name, workspaceId: ws.id }, cookie)).data;
    const board = await createBoard('With tasks');
    const list = (await server.call('GET', `/api/boards/${board.id}`, undefined, cookie)).data.lists[0];
    const card = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Work', kind: 'task' }, cookie)).data;
    const boards = (await server.call('GET', '/api/boards', undefined, cookie)).data;
    assert.equal(boards.find(b => b.id === board.id).taskCount, 1);
    assert.equal((await server.call('GET', `/api/boards/${board.id}`, undefined, cookie)).data.taskCount, 1);
    assert.equal((await server.call('DELETE', `/api/boards/${board.id}`, undefined, cookie)).status, 200);
    assert.equal((await server.call('GET', `/api/boards/${board.id}`, undefined, cookie)).status, 404);
    const board2 = await createBoard('With tasks 2');
    const list2 = (await server.call('GET', `/api/boards/${board2.id}`, undefined, cookie)).data.lists[0];
    await server.call('POST', `/api/lists/${list2.id}/cards`, { title: 'Work 2', kind: 'task' }, cookie);
    assert.equal((await server.call('DELETE', `/api/workspaces/${ws.id}`, undefined, cookie)).status, 200);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Workspace Project cards persist task grouping and reject invalid parents', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-project-cards-'));
  let server;
  try {
    server = await start(dir);
    const setup = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' });
    const cookie = setup.cookie;
    const shared = (await server.call('GET', '/api/boards', undefined, cookie)).data.find(b => b.name === 'Việc chung');
    const board = (await server.call('GET', `/api/boards/${shared.id}`, undefined, cookie)).data;
    const list = board.lists[0];
    const create = body => server.call('POST', `/api/lists/${list.id}/cards`, body, cookie);
    const project = await create({ title: 'Launch', kind: 'project', syncTask: true });
    assert.equal(project.status, 201);
    assert.equal(project.data.kind, 'project');
    const task = await create({ title: 'Design', kind: 'task', projectCardId: project.data.id, syncTask: true });
    assert.equal(task.status, 201);
    assert.equal(task.data.projectCardId, project.data.id);
    assert.equal((await create({ title: 'Invalid', projectCardId: task.data.id })).status, 400);
    const loaded = (await server.call('GET', `/api/boards/${shared.id}`, undefined, cookie)).data;
    assert.equal(loaded.lists[0].cards.find(c => c.id === task.data.id).projectCardId, project.data.id);
    const detail = (await server.call('GET', `/api/cards/${project.data.id}`, undefined, cookie)).data;
    assert.equal(detail.kind, 'project');
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('cards like Trello: labels, members, dates, checklists, comments, links, archive, copy, sort, search, activity', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-cards-'));
  let server;
  try {
    server = await start(dir);
    const setup = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' });
    const ac = setup.cookie, boss = setup.data.user;
    const shared = (await server.call('GET', '/api/boards', undefined, ac)).data.find(b => b.name === 'Việc chung');
    let board = (await server.call('GET', `/api/boards/${shared.id}`, undefined, ac)).data;
    assert.equal(board.labels.length, 6);
    assert.ok(board.members.some(m => m.id === boss.id));
    const [todo, doing] = board.lists;
    const card = (await server.call('POST', `/api/lists/${todo.id}/cards`, { title: 'Dựng video Black Friday' }, ac)).data;
    const label = (await server.call('POST', `/api/boards/${shared.id}/labels`, { name: 'Gấp', color: 'red' }, ac)).data;
    await server.call('PUT', `/api/cards/${card.id}/labels`, { labelId: label.id, on: true }, ac);
    await server.call('PUT', `/api/cards/${card.id}/members`, { userId: boss.id, on: true }, ac);
    const due = Date.UTC(2026, 10, 20, 17);
    await server.call('PUT', `/api/cards/${card.id}`, { description: 'Theo sheet Dynamic M', dueAt: due, cover: 'blue' }, ac);
    const list = (await server.call('POST', `/api/cards/${card.id}/checklists`, { title: 'Việc cần làm' }, ac)).data;
    const item = (await server.call('POST', `/api/checklists/${list.id}/items`, { text: 'Gắn outro' }, ac)).data;
    await server.call('POST', `/api/checklists/${list.id}/items`, { text: 'Xuất CapCut' }, ac);
    await server.call('PUT', `/api/items/${item.id}`, { done: true }, ac);
    await server.call('POST', `/api/cards/${card.id}/comments`, { text: 'Khách duyệt bản 1' }, ac);
    assert.equal((await server.call('POST', `/api/cards/${card.id}/attachments`, { url: 'not a link' }, ac)).status, 400);
    await server.call('POST', `/api/cards/${card.id}/attachments`, { url: 'https://drive.google.com/file/d/abc/view', name: 'Bản dựng 1' }, ac);
    const moved = (await server.call('PUT', `/api/cards/${card.id}`, { listId: doing.id, index: 0, done: true }, ac)).data;
    assert.equal(moved.listName, doing.name);
    assert.deepEqual(moved.labels, [label.id]);
    assert.deepEqual(moved.members, [boss.id]);
    assert.equal(moved.dueAt, due);
    assert.equal(moved.checklists[0].items.filter(i => i.done).length, 1);
    assert.equal(moved.comments[0].text, 'Khách duyệt bản 1');
    assert.equal(moved.attachments[0].name, 'Bản dựng 1');
    assert.ok(moved.activity.some(a => a.action === 'card.move' && a.data.to === doing.name));
    // The front shows what the card has.
    board = (await server.call('GET', `/api/boards/${shared.id}`, undefined, ac)).data;
    const front = board.lists[1].cards[0];
    assert.deepEqual([front.done, front.cover, front.desc, front.comments, front.attachments, front.checks], [true, 'blue', true, 1, 1, [1, 2]]);
    // Copy, sort by name, search, archive and restore.
    await server.call('POST', `/api/lists/${doing.id}/cards`, { title: 'A thẻ đầu' }, ac);
    await server.call('POST', `/api/cards/${card.id}/copy`, {}, ac);
    await server.call('POST', `/api/lists/${doing.id}/sort`, { by: 'name' }, ac);
    board = (await server.call('GET', `/api/boards/${shared.id}`, undefined, ac)).data;
    assert.deepEqual(board.lists[1].cards.map(c => c.title), ['A thẻ đầu', 'Dựng video Black Friday', 'Dựng video Black Friday']);
    assert.equal((await server.call('GET', '/api/boards-search?q=black', undefined, ac)).data.cards.length, 2);
    await server.call('PUT', `/api/cards/${card.id}`, { archived: true }, ac);
    assert.equal((await server.call('GET', `/api/boards/${shared.id}/archived`, undefined, ac)).data.cards[0].id, card.id);
    await server.call('PUT', `/api/cards/${card.id}`, { archived: false }, ac);
    assert.equal((await server.call('GET', `/api/boards/${shared.id}/archived`, undefined, ac)).data.cards.length, 0);
    const activity = (await server.call('GET', `/api/boards/${shared.id}/activity`, undefined, ac)).data;
    assert.ok(['card.add', 'card.done', 'card.archive', 'card.restore', 'card.copy', 'attach'].every(a => activity.some(x => x.action === a)));
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('workspaces and board levels: private workspaces shared by choice, role boards for their role, people added at a level', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-levels-'));
  let server;
  try {
    server = await start(dir);
    const ac = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const [media, sale] = (await server.call('GET', '/api/roles', undefined, ac)).data;
    const account = async (name, teamRole) => {
      const u = (await server.call('POST', '/api/users', { name, email: `${name}@example.test`, password: 'test-password', teamRole }, ac)).data;
      return { id: u.id, cookie: (await server.call('POST', '/api/auth/login', { email: `${name}@example.test`, password: 'test-password' })).cookie };
    };
    const ed = await account('ed', media.id), sam = await account('sam', sale.id), obs = await account('obs', null);
    // A workspace of one's own is private until shared; its boards follow.
    const ws = (await server.call('POST', '/api/workspaces', { name: 'Ed riêng' }, ed.cookie)).data;
    assert.equal(ws.level, 'admin');
    const own = (await server.call('POST', '/api/boards', { name: 'Ý tưởng', workspaceId: ws.id }, ed.cookie)).data;
    assert.equal(own.workspaceId, ws.id);
    assert.equal((await server.call('GET', `/api/boards/${own.id}`, undefined, sam.cookie)).status, 404);
    assert.ok(!(await server.call('GET', '/api/workspaces', undefined, sam.cookie)).data.some(w => w.id === ws.id));
    assert.equal((await server.call('POST', '/api/boards', { name: 'x', workspaceId: ws.id }, sam.cookie)).status, 404);
    assert.equal((await server.call('POST', '/api/boards', { name: 'x', workspaceId: ws.id, roleId: media.id }, ed.cookie)).status, 400);
    // Shared as an observer: sees and comments, cannot change anything.
    assert.equal((await server.call('PUT', `/api/workspaces/${ws.id}/members/${sam.id}`, { level: 'observer' }, ed.cookie)).status, 200);
    assert.equal((await server.call('PUT', `/api/workspaces/${ws.id}/members/${obs.id}`, { level: 'normal' }, sam.cookie)).status, 403);
    assert.equal((await server.call('GET',`/api/boards/${own.id}`,undefined,sam.cookie)).status,404);
    await server.call('PUT',`/api/boards/${own.id}/members/${sam.id}`,{level:'observer'},ed.cookie);
    const seen = (await server.call('GET', `/api/boards/${own.id}`, undefined, sam.cookie)).data;
    assert.equal(seen.level, 'observer');
    const list = seen.lists[0];
    assert.equal((await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'không được' }, sam.cookie)).status, 403);
    const card = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Kịch bản' }, ed.cookie)).data;
    assert.equal((await server.call('PUT', `/api/cards/${card.id}`, { title: 'đổi' }, sam.cookie)).status, 403);
    assert.equal((await server.call('POST', `/api/cards/${card.id}/comments`, { text: 'Hay' }, sam.cookie)).status, 201);
    assert.equal((await server.call('PUT', `/api/boards/${own.id}`, { private: true }, sam.cookie)).status, 403);
    // Promoted to a member of the workspace: edits.
    await server.call('PUT', `/api/workspaces/${ws.id}/members/${sam.id}`, { level: 'normal' }, ed.cookie);
    assert.equal((await server.call('PUT',`/api/cards/${card.id}`,{title:'Denied by board role'},sam.cookie)).status,403);
    await server.call('PUT',`/api/boards/${own.id}/members/${sam.id}`,{level:'normal'},ed.cookie);
    assert.equal((await server.call('PUT', `/api/cards/${card.id}`, { title: 'Kịch bản v2' }, sam.cookie)).status, 200);
    // A private board: only its people (and the workspace's admins).
    await server.call('PUT', `/api/boards/${own.id}`, { private: true }, ed.cookie);
    assert.equal((await server.call('GET', `/api/boards/${own.id}`, undefined, sam.cookie)).status,200);
    await server.call('DELETE',`/api/boards/${own.id}/members/${sam.id}`,undefined,ed.cookie);
    assert.equal((await server.call('GET', `/api/boards/${own.id}`, undefined, sam.cookie)).status,404);
    assert.equal((await server.call('PUT', `/api/boards/${own.id}/members/${sam.id}`, { level: 'normal' }, ed.cookie)).status, 200);
    assert.equal((await server.call('GET', `/api/boards/${own.id}`, undefined, sam.cookie)).data.level, 'normal');
    // A role's board: its role only, and people added to it at their level.
    const saleOwned=(await server.call('GET','/api/boards',undefined,ac)).data.find(b=>b.roleId===sale.id);
    assert.equal((await server.call('GET',`/api/boards/${saleOwned.id}`,undefined,sam.cookie)).status,404);
    await server.call('PUT',`/api/boards/${saleOwned.id}/members/${sam.id}`,{level:'normal'},ac);
    const saleBoard = (await server.call('GET', '/api/boards', undefined, sam.cookie)).data.find(b => b.roleId === sale.id);
    assert.equal(saleBoard.level, 'normal');
    assert.equal((await server.call('GET', `/api/boards/${saleBoard.id}`, undefined, ed.cookie)).status, 404);
    assert.equal((await server.call('PUT', `/api/boards/${saleBoard.id}/members/${ed.id}`, { level: 'observer' }, sam.cookie)).status, 403);
    assert.equal((await server.call('PUT', `/api/boards/${saleBoard.id}/members/${ed.id}`, { level: 'observer' }, ac)).status, 200);
    const guest = (await server.call('GET', `/api/boards/${saleBoard.id}`, undefined, ed.cookie)).data;
    assert.equal(guest.level, 'observer');
    assert.ok(guest.members.some(m => m.id === ed.id && m.added && m.level === 'observer'));
    assert.equal((await server.call('POST', `/api/boards/${saleBoard.id}/lists`, { name: 'x' }, ed.cookie)).status, 403);
    // Leaving the board; deleting the workspace takes its boards.
    assert.equal((await server.call('DELETE', `/api/boards/${saleBoard.id}/members/${ed.id}`, undefined, ed.cookie)).status, 200);
    assert.equal((await server.call('GET', `/api/boards/${saleBoard.id}`, undefined, ed.cookie)).status, 404);
    assert.equal((await server.call('DELETE', `/api/workspaces/${ws.id}`, undefined, sam.cookie)).status, 403);
    assert.equal((await server.call('DELETE', `/api/workspaces/${ws.id}`, undefined, ed.cookie)).status, 200);
    assert.equal((await server.call('GET', `/api/boards/${own.id}`, undefined, ed.cookie)).status, 404);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a card is archived or deleted only by whoever made it; a new workspace is private until shared or opened to the company', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-owners-'));
  let server;
  try {
    server = await start(dir);
    const ac = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const [media] = (await server.call('GET', '/api/roles', undefined, ac)).data;
    const account = async (name) => {
      const u = (await server.call('POST', '/api/users', { name, email: `${name}@example.test`, password: 'test-password', teamRole: media.id }, ac)).data;
      return { id: u.id, cookie: (await server.call('POST', '/api/auth/login', { email: `${name}@example.test`, password: 'test-password' })).cookie };
    };
    const ed = await account('ed'), sam = await account('sam');
    const owned=(await server.call('GET','/api/boards',undefined,ac)).data.find(b=>b.roleId===media.id);
    for(const person of [ed,sam])await server.call('PUT',`/api/boards/${owned.id}/members/${person.id}`,{level:'normal'},ac);
    const board = (await server.call('GET', '/api/boards', undefined, ed.cookie)).data.find(b => b.roleId === media.id);
    const list = (await server.call('GET', `/api/boards/${board.id}`, undefined, ed.cookie)).data.lists[0];
    const eds = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Của Ed' }, ed.cookie)).data;
    const sams = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Của Sam' }, sam.cookie)).data;
    // Others edit a card but do not archive or delete it; its maker and the company admin do.
    assert.equal((await server.call('PUT', `/api/cards/${eds.id}`, { title: 'Của Ed (sửa)' }, sam.cookie)).status, 200);
    assert.equal((await server.call('PUT', `/api/cards/${eds.id}`, { archived: true }, sam.cookie)).status, 403);
    assert.equal((await server.call('DELETE', `/api/cards/${eds.id}`, undefined, sam.cookie)).status, 403);
    assert.equal((await server.call('PUT', `/api/cards/${eds.id}`, { archived: true }, ac)).status, 200);
    assert.equal((await server.call('PUT', `/api/cards/${eds.id}`, { archived: false }, ac)).status, 200);
    assert.equal((await server.call('GET', `/api/cards/${eds.id}`, undefined, sam.cookie)).data.createdBy, ed.id);
    // "Archive every card" takes only the asker's own; a list with others' cards is not deleted.
    const r = (await server.call('POST', `/api/lists/${list.id}/archive-cards`, undefined, ed.cookie)).data;
    assert.deepEqual(r, { archived: [eds.id], kept: 1 });
    assert.equal((await server.call('DELETE', `/api/lists/${list.id}`, undefined, sam.cookie)).status, 403);
    assert.equal((await server.call('DELETE', `/api/cards/${eds.id}`, undefined, ed.cookie)).status, 200);
    assert.equal((await server.call('DELETE', `/api/cards/${sams.id}`, undefined, sam.cookie)).status, 200);
    // A new workspace is private; opened to the company, everyone views it and only its people edit.
    const ws = (await server.call('POST', '/api/workspaces', { name: 'Ed riêng' }, ed.cookie)).data;
    assert.equal(ws.visibility, 'private');
    const idea = (await server.call('POST', '/api/boards', { name: 'Ý tưởng', workspaceId: ws.id }, ed.cookie)).data;
    assert.ok(!(await server.call('GET', '/api/workspaces', undefined, sam.cookie)).data.some(w => w.id === ws.id));
    assert.equal((await server.call('GET', `/api/boards/${idea.id}`, undefined, sam.cookie)).status, 404);
    assert.equal((await server.call('PUT', `/api/workspaces/${ws.id}`, { visibility: 'company' }, ed.cookie)).status, 200);
    assert.equal((await server.call('GET', '/api/workspaces', undefined, sam.cookie)).data.find(w => w.id === ws.id).level, 'observer');
    const seen = (await server.call('GET', `/api/boards/${idea.id}`, undefined, sam.cookie)).data;
    assert.equal((await server.call('GET',`/api/boards/${idea.id}`,undefined,sam.cookie)).status,404);
    await server.call('PUT',`/api/boards/${idea.id}/members/${sam.id}`,{level:'observer'},ed.cookie);
    const invited=(await server.call('GET',`/api/boards/${idea.id}`,undefined,sam.cookie)).data;
    assert.equal((await server.call('POST',`/api/lists/${invited.lists[0].id}/cards`,{title:'x'},sam.cookie)).status,403);
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('departments have their own roles: a role\'s level (admin, member, view only) decides what its people do in the department', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-depts-'));
  let server;
  try {
    server = await start(dir);
    const ac = (await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'boss@example.test', password: 'test-password' })).cookie;
    const depts = (await server.call('GET', '/api/roles', undefined, ac)).data;
    const media = depts[0];
    assert.deepEqual(media.positions.map(p => [p.name, p.level]), [['Trưởng phòng', 'admin'], ['Nhân viên', 'normal'], ['Thực tập sinh', 'observer']]);
    const [head, staff, intern] = media.positions;
    const account = async (name, deptRole) => {
      const u = (await server.call('POST', '/api/users', { name, email: `${name}@example.test`, password: 'test-password', teamRole: media.id, deptRole }, ac)).data;
      return { ...u, cookie: (await server.call('POST', '/api/auth/login', { email: `${name}@example.test`, password: 'test-password' })).cookie };
    };
    const lead = await account('lead', head.id), ed = await account('ed', staff.id), kid = await account('kid', intern.id), plain = await account('plain');
    assert.equal(plain.deptRole, staff.id); // no role given: the department's member role
    assert.deepEqual([lead.level, ed.level, kid.level], ['admin', 'normal', 'observer']);
    // On the department's board: the head administers, staff edit, interns view and comment.
    const board = (await server.call('GET', '/api/boards', undefined, ac)).data.find(b => b.roleId === media.id);
    const levelOf = async (c) => (await server.call('GET', `/api/boards/${board.id}`, undefined, c)).data.level;
    for(const person of [lead,ed,kid])assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,person.cookie)).status,404);
    for(const[person,level]of[[lead,'admin'],[ed,'normal'],[kid,'observer']])await server.call('PUT',`/api/boards/${board.id}/members/${person.id}`,{level},ac);
    assert.deepEqual([await levelOf(lead.cookie), await levelOf(ed.cookie), await levelOf(kid.cookie)], ['admin', 'normal', 'observer']);
    const list = (await server.call('GET', `/api/boards/${board.id}`, undefined, ed.cookie)).data.lists[0];
    const card = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Dựng' }, ed.cookie)).data;
    assert.equal((await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'x' }, kid.cookie)).status, 403);
    assert.equal((await server.call('POST', `/api/cards/${card.id}/comments`, { text: 'Ok' }, kid.cookie)).status, 201);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}/members/${kid.id}`, { level: 'normal' }, ed.cookie)).status, 403);
    assert.equal((await server.call('PUT', `/api/boards/${board.id}/members/${kid.id}`, { level: 'normal' }, lead.cookie)).status, 200);
    assert.equal(await levelOf(kid.cookie), 'normal'); // added to the board at a level of its own
    assert.equal((await server.call('POST', '/api/boards', { name: 'x', roleId: media.id }, kid.cookie)).status, 403); // view-only role: no new company boards
    assert.equal((await server.call('POST', '/api/boards', { name: 'Dựng mới', roleId: media.id }, ed.cookie)).status, 201);
    // Tool pages: interns do not open Trình dựng and change nothing on Drive; only admins manage customers and files.
    assert.deepEqual((await server.call('GET', '/api/auth/me', undefined, kid.cookie)).data.pages, ['workspace']);
    assert.equal((await server.call('GET', '/api/projects', undefined, kid.cookie)).status, 403);
    assert.equal((await server.call('PUT', '/api/customers/c_x', { notes: 'x' }, kid.cookie)).status, 404);
    assert.equal((await server.call('DELETE', '/api/customers/c_x/files/abc', undefined, ed.cookie)).status, 404);
    assert.equal((await server.call('DELETE', '/api/customers/c_x/videos/abc', undefined, ed.cookie)).status, 404);
    assert.equal((await server.call('DELETE', '/api/customers/c_x/files/abc', undefined, lead.cookie)).status, 404);
    // Roles of a department are the admins' to change; a removed role leaves its people members of the department.
    assert.equal((await server.call('POST', `/api/roles/${media.id}/positions`, { name: 'Editor', level: 'normal' }, lead.cookie)).status, 403);
    const editor = (await server.call('POST', `/api/roles/${media.id}/positions`, { name: 'Editor', level: 'observer' }, ac)).data;
    await server.call('PUT', `/api/users/${ed.id}`, { deptRole: editor.id }, ac);
    const edAgain = (await server.call('POST', '/api/auth/login', { email: 'ed@example.test', password: 'test-password' })).cookie;
    assert.equal(await levelOf(edAgain),'normal'); // department changes do not override direct board membership
    await server.call('PUT',`/api/boards/${board.id}/members/${ed.id}`,{level:'observer'},lead.cookie);
    assert.equal(await levelOf(edAgain),'observer');
    await server.call('PUT', `/api/positions/${editor.id}`, { level: 'normal' }, ac);
    assert.equal(await levelOf(edAgain),'observer'); // still the direct board role
    await server.call('DELETE', `/api/positions/${editor.id}`, undefined, ac);
    assert.equal((await server.call('GET', '/api/users', undefined, ac)).data.find(u => u.id === ed.id).level, 'normal');
  } finally { if (server) await server.close(); await rm(dir, { recursive: true, force: true }); }
});

test('imported tasks support CRUD and permission-checked two-way Workspace card links', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-task-crud-'));
  let server;
  try {
    server = await start(dir);
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Admin', email: 'tasks@example.test', password: 'test-password' });
    // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
    assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},admin.cookie)).status,200);
    const ac = admin.cookie;
    const account = async (name) => {
      const u = await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password'},ac);
      const login = await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'});
      return {id:u.data.id,cookie:login.cookie};
    };
    const ed = await account('Editor'), other = await account('Other'), mate = await account('Mate');
    const imported = await server.call('POST','/api/tasks/import',{text:'Tên công việc\tTrạng thái\tDự án\tGiao cho\tTạo bởi\tKết quả\tMã công việc\nImported task\tChưa thực hiện\tLaunch\tEditor\tAdmin\tprivate-result\t123'},ac);
    assert.equal(imported.status,200,JSON.stringify(imported.data));
    const importedPeople=(await server.call('GET','/api/tasks/meta',undefined,ac)).data.people;
    const editorName=importedPeople.find(p=>p.name==='Editor');
    assert.equal(editorName.userId,null);
    await server.call('PUT',`/api/task-people/${editorName.id}`,{userId:ed.id},ac);
    const task = (await visibleTasks(server,ac)).find(t => t.externalId==='123');
    const id = task.id;
    // The project's members change its tasks; a follower of the project ('observer') only looks.
    for(const [who,level] of [[ed,'normal'],[mate,'normal'],[other,'observer']])assert.equal((await server.call('PUT',`/api/task-projects/${task.project.id}/members/${who.id}`,{level},ac)).status,200);
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{title:'Denied'},other.cookie)).status,403);
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{title:'From a project member'},mate.cookie)).status,200);
    assert.equal((await server.call('GET',`/api/tasks/${id}`,undefined,other.cookie)).data.result,null);
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{title:'Edited task',description:'Working description',labels:['Urgent']},ed.cookie)).status,200);
    let detail = (await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data;
    assert.equal(detail.title,'Edited task');
    assert.deepEqual(detail.labels,['Urgent']);
    assert.equal(detail.canDelete,true);
    assert.equal((await server.call('DELETE',`/api/tasks/${id}`,undefined,ed.cookie)).status,403);
    const b = (await server.call('POST','/api/boards',{name:'Task board',bg:'ocean',roleId:null,private:true},ac)).data;
    const board = (await server.call('GET',`/api/boards/${b.id}`,undefined,ac)).data;
    const list = board.lists[0];
    assert.equal((await server.call('POST',`/api/tasks/${id}/card`,{listId:list.id},ed.cookie)).status,404);
    await server.call('PUT',`/api/boards/${b.id}/members/${ed.id}`,{level:'normal'},ac);
    await server.call('PUT',`/api/boards/${b.id}/members/${other.id}`,{level:'normal'},ac);
    const link = await server.call('POST',`/api/tasks/${id}/card`,{listId:list.id},ed.cookie);
    assert.equal(link.status,201,JSON.stringify(link.data));
    const cardId = link.data.cardId;
    assert.equal((await server.call('POST',`/api/tasks/${id}/card`,{listId:list.id},ed.cookie)).status,409);
    let card = (await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data;
    assert.equal(card.description,'Working description');
    assert.equal(JSON.stringify(card).includes('private-result'),false);
    assert.equal(card.linkedTask.id,id);
    const future=Date.now()+86400000;
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{dueAt:future,status:'Hoàn thành'},ed.cookie)).status,200);
    card=(await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data;
    assert.equal(card.done,true); assert.equal(card.dueAt,future);
    assert.equal((await server.call('PUT',`/api/cards/${cardId}`,{title:'Board edit',done:false},ed.cookie)).status,200);
    detail=(await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data;
    assert.equal(detail.title,'Board edit'); assert.equal(detail.status,'Chưa thực hiện');
    const review=(await server.call('POST',`/api/boards/${b.id}/lists`,{name:'Chờ khách duyệt'},ac)).data;
    const finished=(await server.call('POST',`/api/boards/${b.id}/lists`,{name:'Hoàn thành'},ac)).data;
    assert.equal((await server.call('PUT',`/api/cards/${cardId}`,{listId:review.id},other.cookie)).status,403);
    assert.equal((await server.call('PUT',`/api/cards/${cardId}`,{listId:review.id},ed.cookie)).status,200);
    detail=(await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data;
    assert.equal(detail.status,'Chờ khách duyệt');
    assert.ok(detail.statuses.includes('Chờ khách duyệt'));
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{status:'Hoàn thành'},ed.cookie)).status,200);
    card=(await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data;
    assert.equal(card.listId,finished.id); assert.equal(card.done,true);
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{status:'Chờ khách duyệt'},ed.cookie)).status,200);
    card=(await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data;
    assert.equal(card.listId,review.id); assert.equal(card.done,false);
    assert.equal((await server.call('PUT',`/api/lists/${review.id}`,{name:'Chờ khách phản hồi'},ac)).status,200);
    assert.equal((await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data.status,'Chờ khách phản hồi');
    assert.equal((await server.call('POST',`/api/lists/${review.id}/move-cards`,{to:finished.id},ac)).status,200);
    detail=(await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data;
    assert.equal(detail.status,'Hoàn thành');
    assert.equal((await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data.done,true);
    const cardWithProj = (await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data;
    assert.equal(cardWithProj.projectId, task.project.id);
    assert.equal(cardWithProj.projectName, 'Launch');


    assert.equal((await server.call('PUT',`/api/cards/${cardId}`,{title:'Unauthorized through board'},other.cookie)).status,403);
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{title:'Invalid change',parentId:id},ed.cookie)).status,400);
    assert.equal((await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data.title,'Board edit');
    await server.call('DELETE',`/api/boards/${b.id}/members/${ed.id}`,undefined,ac);
    // The task and its card are one piece of work: whoever may change the task still does without the board, and the card follows.
    assert.equal((await server.call('PUT',`/api/tasks/${id}`,{title:'No board access'},ed.cookie)).status,200);
    assert.equal((await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data.title,'No board access');
    detail=(await server.call('GET',`/api/tasks/${id}`,undefined,ed.cookie)).data;
    const hiddenBoard=(await server.call('GET','/api/tasks',undefined,ed.cookie)).data.tasks.find(task=>task.id===id);
    assert.equal(hiddenBoard.boardLink,null);assert.equal(hiddenBoard.hasBoardLink,true);

    assert.equal(detail.boardLink,null); assert.equal(detail.hasBoardLink,true);
    assert.equal((await server.call('DELETE',`/api/tasks/${id}/card`,undefined,ed.cookie)).status,200);
    await server.call('PUT',`/api/tasks/${id}`,{title:'Task only'},ed.cookie);
    assert.equal((await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data.title,'No board access');
    // Relink an existing card, import updates it, then deleting the card leaves the task intact.
    assert.equal((await server.call('POST',`/api/tasks/${id}/card`,{cardId},ac)).status,201);
    await server.call('POST','/api/tasks/import',{text:'Tên công việc\tMã công việc\tGiao cho\tTạo bởi\nReimported\t123\tEditor\tAdmin'},ac);
    assert.equal((await server.call('GET',`/api/cards/${cardId}`,undefined,ac)).data.title,'Reimported');
    assert.equal((await server.call('DELETE',`/api/cards/${cardId}`,undefined,ed.cookie)).status,404);
    await server.call('PUT',`/api/boards/${b.id}/members/${ed.id}`,{level:'normal'},ac);
    assert.equal((await server.call('DELETE',`/api/cards/${cardId}`,undefined,ed.cookie)).status,200);
    assert.equal((await server.call('GET',`/api/tasks/${id}`,undefined,ac)).data.hasBoardLink,false);
    const unlinkedCard = (await server.call('POST', `/api/lists/${list.id}/cards`, { title: 'Card to link', syncTask: false }, ac)).data;
    assert.equal(unlinkedCard.linkedTask, undefined);
    const updatedWithTask = (await server.call('PUT', `/api/cards/${unlinkedCard.id}`, { linkTask: true }, ac)).data;
    assert.ok(updatedWithTask.linkedTask?.id);
    const updatedWithProject = (await server.call('PUT', `/api/cards/${unlinkedCard.id}`, { projectId: task.project.id }, ac)).data;
    assert.equal(updatedWithProject.projectId, task.project.id);
    assert.equal(updatedWithProject.projectName, 'Launch');
    const created=await server.call('POST','/api/tasks',{title:'Local parent'},ed.cookie);
    assert.equal(created.status,201);
    const child=await server.call('POST','/api/tasks',{title:'Local child',parentId:created.data.id},ed.cookie);
    assert.equal(child.status,201);
    assert.equal((await server.call('GET','/api/tasks',undefined,ed.cookie)).data.tasks.some(t=>t.id===created.data.id),true);
    assert.equal((await server.call('DELETE',`/api/tasks/${created.data.id}`,undefined,ed.cookie)).status,200);
    assert.equal((await server.call('GET',`/api/tasks/${child.data.id}`,undefined,ed.cookie)).data.parent,null);
    assert.equal((await server.call('DELETE',`/api/tasks/${id}`,undefined,ac)).status,200);
    assert.equal((await server.call('GET',`/api/tasks/${id}`,undefined,ac)).status,404);
  } finally { if(server) await server.close(); await rm(dir,{recursive:true,force:true}); }
});

test('Meta reporting works with ads_read only and never requests Business Manager fields or writes to Meta', async () => {
  const { createServer } = await import('node:http');
  const calls = [];
  let denySetup = false;
  const graph = createServer((req,res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    calls.push({method:req.method,path:url.pathname,fields:url.searchParams.get('fields')||'',filtering:url.searchParams.get('filtering')});
    res.setHeader('content-type','application/json');
    const token=url.searchParams.get('access_token');
    if(token==='fixture-expired-token-123456') { res.statusCode=400; res.end(JSON.stringify({error:{code:190,message:'Expired token'}}));return; }
    if(req.method!=='GET' || /business|owned_ad_accounts|client_ad_accounts/.test(url.pathname+' '+(url.searchParams.get('fields')||''))) {
      res.statusCode=400;res.end(JSON.stringify({error:{code:100,message:'Requires business_management permission to access the field.'}}));return;
    }
    if(url.pathname.endsWith('/me')) {res.end(JSON.stringify({id:'123456',name:'Read only user'}));return;}
    if(url.pathname.endsWith('/me/adaccounts')) {
      if(url.searchParams.get('after')) res.end(JSON.stringify({data:[{id:'act_222222',account_id:'222222',name:'Second account',currency:'USD',timezone_name:'Asia/Ho_Chi_Minh',account_status:1}]}));
      else { const next=new URL(url);next.searchParams.set('after','page2');res.end(JSON.stringify({data:[{id:'act_111111',account_id:'111111',name:'First account',currency:'USD',timezone_name:'Asia/Ho_Chi_Minh',account_status:1}],paging:{next:next.toString()}})); }
      return;
    }
    if(denySetup && /\/(ads|adsets)$/.test(url.pathname)) {res.statusCode=403;res.end(JSON.stringify({error:{code:200,message:'Insufficient read permission'}}));return;}
    if(url.pathname.endsWith('/adsets')) {res.end(JSON.stringify({data:[{id:'as_1',name:'Actual ad set',campaign_id:'cmp_1',destination_type:'WEBSITE',optimization_goal:'LEAD_GENERATION',targeting:{age_min:30,age_max:55,geo_locations:{countries:['VN']}}}]}));return;}
    if(url.pathname.endsWith('/ads')) {res.end(JSON.stringify({data:[{id:'ad_1',name:'Actual ad',adset_id:'as_1',creative:{title:'Actual headline',object_story_spec:{link_data:{link:'https://example.test/offer',message:'Actual primary text',description:'Actual description'}}}}]}));return;}
    if(url.pathname.endsWith('/insights')) {res.end(JSON.stringify({data:[{date_start:'2026-11-01',campaign_id:'cmp_1',campaign_name:'Test campaign',objective:'OUTCOME_LEADS',spend:'25',impressions:'1000',reach:'800',clicks:'20',inline_link_clicks:'10',actions:[{action_type:'lead',value:'2'}]}]}));return;}
    res.statusCode=404;res.end(JSON.stringify({error:{message:'Unexpected path'}}));
  });
  graph.listen(0,'127.0.0.1');await once(graph,'listening');
  const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-meta-read-'));
  let server;
  try {
    server=await start(dir,{META_GRAPH_URL:`http://127.0.0.1:${graph.address().port}`});
    const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'meta-read@example.test',password:'test-password'});
    const cookie=admin.cookie;
    const saved=await server.call('PUT','/api/settings/ads',{metaToken:'fixture-ads-read-token-123456',metaVersion:'v26.0'},cookie);
    assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.who.accounts,2);
    assert.equal(JSON.stringify(saved.data).includes('fixture-ads-read-token-123456'),false);
    const accounts=await server.call('GET','/api/ads/meta/accounts?fresh=1',undefined,cookie);
    assert.equal(accounts.status,200);assert.equal(accounts.data.length,2);assert.equal(accounts.data[0].business,'');
    const report=await server.call('GET','/api/ads/meta/report?account=act_111111&since=2026-11-01&until=2026-11-01',undefined,cookie);
    assert.equal(report.status,200,JSON.stringify(report.data));assert.equal(report.data.current.spend,25);assert.equal(report.data.current.leads,2);
    const linked = await server.call('POST','/api/reports',{meta:{account:'act_111111',since:'2026-11-01',until:'2026-11-01'}},cookie);
    assert.equal(linked.status,201,JSON.stringify(linked.data));
    assert.equal(linked.data.data.performance.account.id,'act_111111');
    assert.equal(linked.data.data.performance.since,'2026-11-01');
    assert.equal(linked.data.data.performance.data.current.spend,25);
    assert.equal(linked.data.data.client,'First account');
    assert.equal(linked.data.data.budget.amount,'25');
    assert.equal(linked.data.data.budget.statLabel,'Chi tiêu thực tế trong kỳ');
    assert.equal(linked.data.data.hero.month,'NOVEMBER');
    assert.equal(linked.data.data.adsets.sets[0].name,'Actual ad set');
    assert.equal(linked.data.data.adsets.sets[0].url,'https://example.test/offer');
    assert.deepEqual(linked.data.data.copy.headlines,['Actual headline']);
    assert.equal(linked.data.data.creatives.items[0].captions[0].text,'Actual primary text');
    assert.ok(linked.data.data.audience.fields.some(x=>x.value==='30–55'));
    const custom = structuredClone(linked.data.data);
    custom.budget.amount='Custom amount'; custom.copy.headlines=['Keep my headline']; custom.hero.pill='Custom campaign';
    await server.call('PUT',`/api/reports/${linked.data.id}`,{data:custom},cookie);
    const filled = await server.call('POST',`/api/reports/${linked.data.id}/autofill`,{},cookie);
    assert.equal(filled.status,200,JSON.stringify(filled.data));
    assert.equal(filled.data.data.budget.amount,'Custom amount');
    assert.deepEqual(filled.data.data.copy.headlines,['Keep my headline']);
    assert.equal(filled.data.data.hero.pill,'Custom campaign');
    assert.equal(filled.data.data.creatives.items.length,1);
    denySetup = true;
    const partialReport = await server.call('POST','/api/reports',{meta:{account:'act_111111',since:'2026-11-01',until:'2026-11-01'}},cookie);
    assert.equal(partialReport.status,201,JSON.stringify(partialReport.data));
    assert.equal(partialReport.data.data.performance.data.current.spend,25);
    assert.equal(partialReport.data.data.adsets.on,false);
    assert.equal(partialReport.data.data.audience.on,false);
    assert.equal(partialReport.data.autofillWarnings.length,2);
    denySetup = false;


    const reopened = await server.call('GET',`/api/reports/${linked.data.id}`,undefined,cookie);
    assert.equal(reopened.data.data.performance.account.id,'act_111111');
    const beforeBad = await server.call('GET','/api/reports',undefined,cookie);
    const invalidReport = await server.call('POST','/api/reports',{meta:{account:'act_999999',since:'2026-11-01',until:'2026-11-01'}},cookie);
    assert.equal(invalidReport.status,404);
    const afterBad = await server.call('GET','/api/reports',undefined,cookie);
    assert.equal(afterBad.data.length,beforeBad.data.length);
    const serviceBody={clientId:'C01',client:'Test Client',service:'Ceramic Coating',monthlyBudget:100,kpiTarget:20,primaryKpi:'Auto',conversionType:'LeadForm',accountId:'act_111111',campaignIds:['123456'],currency:'USD',reportingKey:'C01|Meta|Coating'};
    const service=await server.call('POST','/api/ads/services',serviceBody,cookie);
    assert.equal(service.status,201,JSON.stringify(service.data));
    assert.equal((await server.call('POST','/api/ads/services',serviceBody,cookie)).status,409);
    assert.equal((await server.call('POST','/api/ads/services',{...serviceBody,reportingKey:'bad',monthlyBudget:-1},cookie)).status,400);
    const summary=await server.call('GET','/api/ads/summary?until=2026-11-01',undefined,cookie);
    assert.equal(summary.status,200,JSON.stringify(summary.data));
    const row=summary.data.rows[0];assert.equal(row.clientId,'C01');assert.equal(row.primaryKpi,'CPL');assert.equal(row.spendBudgetPct,25);assert.equal(row.kpiStatus,'On target');assert.equal(row.costPrimary30,12.5);assert.equal(row.costChange7,0);
    assert.equal(summary.data.since30,'2026-10-03');assert.equal(summary.data.since7,'2026-10-26');assert.equal(summary.data.previous7.until,'2026-10-25');
    assert.equal((await server.call('GET','/api/ads/summary?until=2026-02-30',undefined,cookie)).status,400);
    const role=await server.call('POST','/api/roles',{name:'Ads reader',pages:['ads']},cookie);
    await server.call('POST','/api/users',{name:'Viewer',email:'ads-viewer@example.test',password:'test-password',teamRole:role.data.id},cookie);
    const viewer=await server.call('POST','/api/auth/login',{email:'ads-viewer@example.test',password:'test-password'});
    assert.equal((await server.call('GET','/api/ads/summary?until=2026-11-01',undefined,viewer.cookie)).status,200);
    assert.equal((await server.call('PUT',`/api/ads/services/${service.data.id}`,{notes:'Denied'},viewer.cookie)).status,403);
    assert.equal((await server.call('DELETE',`/api/ads/services/${service.data.id}`,undefined,viewer.cookie)).status,403);
    assert.equal((await server.call('PUT',`/api/ads/services/${service.data.id}`,{notes:'Saved note',campaignOwner:'Owner'},cookie)).status,200);
    assert.equal((await server.call('GET','/api/ads/services',undefined,cookie)).data[0].notes,'Saved note');
    const bad=await server.call('POST','/api/ads/services',{...serviceBody,reportingKey:'unavailable',accountId:'act_999999'},cookie);
    const partial=await server.call('GET','/api/ads/summary?until=2026-11-01',undefined,cookie);
    assert.equal(partial.data.rows.find(r=>r.id===bad.data.id).spend30,null);
    assert.equal(partial.data.rows.find(r=>r.id===bad.data.id).kpiStatus,'Data error');
    assert.equal((await server.call('DELETE',`/api/ads/services/${bad.data.id}`,undefined,cookie)).status,200);
    assert.equal((await server.call('DELETE',`/api/ads/services/${service.data.id}`,undefined,cookie)).status,200);
    assert.ok(calls.some(c=>c.path.endsWith('/insights')));
    assert.ok(calls.every(c=>c.method==='GET'&&!/business/.test(c.fields)));
    assert.ok(calls.some(c=>c.filtering && JSON.parse(c.filtering)[0].value.includes('123456')));
    const expired=await server.call('PUT','/api/settings/ads',{metaToken:'fixture-expired-token-123456'},cookie);
    assert.equal(expired.status,400);assert.match(expired.data.error,/hết hạn/);
    assert.equal((await server.call('GET','/api/ads/meta/accounts?fresh=1',undefined,cookie)).status,200);
  } finally {if(server)await server.close();await new Promise(resolve=>graph.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('imports reopen as the original sheet with extra columns, filename, paging and task links',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-source-sheet-'));let server;
  try{
    server=await start(dir);
    const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'sheet@example.test',password:'test-password'});
    const ac=admin.cookie;
    const header='Custom\tTên công việc\tGiao cho\tMã công việc\tKết quả công việc';
    const text=[header,'\tPerson (51)\t\t\t',...Array.from({length:51},(_,i)=>`Extra ${i}\tTask ${i}\tPerson\t${100+i}\tprivate ${i}`)].join('\n');
    const imported=await server.call('POST','/api/tasks/import',{text,sourceName:'Original layout.xlsx'},ac);
    assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.rows,51);
    const id=imported.data.importId;
    let sheet=await server.call('GET',`/api/tasks/imports/${id}/sheet`,undefined,ac);
    assert.equal(sheet.status,200,JSON.stringify(sheet.data));assert.equal(sheet.data.name,'Original layout.xlsx');
    assert.deepEqual(sheet.data.headers,header.split('\t'));assert.equal(sheet.data.titleColumn,1);assert.equal(sheet.data.total,52);assert.equal(sheet.data.rows.length,50);assert.equal(sheet.data.pages,2);
    assert.equal(sheet.data.taskIds[0],null);assert.ok(sheet.data.taskIds[1]);assert.equal(sheet.data.rows[1][0],'Extra 0');assert.equal(sheet.data.rows[1][4],'private 0');
    const taskId=sheet.data.taskIds[1];
    const second=await server.call('GET',`/api/tasks/imports/${id}/sheet?page=1`,undefined,ac);
    assert.equal(second.data.start,50);assert.equal(second.data.rows.length,2);assert.equal(second.data.rows[1][1],'Task 50');
    assert.equal((await server.call('GET',`/api/tasks/imports/${id}/sheet?page=-1`,undefined,ac)).status,400);
    const meta=(await server.call('GET','/api/tasks/meta',undefined,ac)).data;
    assert.equal(meta.imports[0].sourceName,'Original layout.xlsx');assert.equal(meta.imports[0].hasSheet,true);
    await server.call('POST','/api/users',{email:'sheet-viewer@example.test',password:'test-password'},ac);
    const viewer=await server.call('POST','/api/auth/login',{email:'sheet-viewer@example.test',password:'test-password'});
    assert.equal((await server.call('GET',`/api/tasks/imports/${id}/sheet`,undefined,viewer.cookie)).status,403);
    // Reimport updates tasks but never rewrites the original sheet snapshot.
    const again=await server.call('POST','/api/tasks/import',{text:header+'\nChanged\tNew title\tPerson\t100\tnew private',sourceName:'Updated.csv'},ac);
    assert.equal(again.status,200);assert.equal(again.data.updated,1);
    assert.equal((await server.call('GET',`/api/tasks/${taskId}`,undefined,ac)).data.title,'New title');
    sheet=await server.call('GET',`/api/tasks/imports/${id}/sheet`,undefined,ac);
    assert.equal(sheet.data.rows[1][1],'Task 0');assert.equal(sheet.data.taskIds[1],taskId);
    await server.close();server=await start(dir);
    assert.equal((await server.call('GET',`/api/tasks/imports/${id}/sheet`,undefined,ac)).data.rows[1][0],'Extra 0');
    await server.call('DELETE',`/api/tasks/${taskId}`,undefined,ac);
    sheet=await server.call('GET',`/api/tasks/imports/${id}/sheet`,undefined,ac);
    assert.equal(sheet.data.taskIds[1],null);assert.equal(sheet.data.rows[1][1],'Task 0');
    const generic=await server.call('POST','/api/tasks/import',{sourceName:'Ads.csv',text:'Client ID,Client,Spend 30D,My own column\nC01,Example,123.45,Extra value'},ac);
    assert.equal(generic.status,200,JSON.stringify(generic.data));assert.equal(generic.data.rows,0);assert.equal(generic.data.sheetRows,1);assert.equal(generic.data.sheetColumns,4);
    const genericSheet=await server.call('GET',`/api/tasks/imports/${generic.data.importId}/sheet`,undefined,ac);
    assert.deepEqual(genericSheet.data.headers,['Client ID','Client','Spend 30D','My own column']);assert.deepEqual(genericSheet.data.rows,[['C01','Example','123.45','Extra value']]);assert.deepEqual(genericSheet.data.taskIds,[null]);
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('staff and task assignees can be selected directly from active database users without an import',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-users-'));let server;
  try{
    server=await start(dir);
    const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Admin',email:'staff-admin@example.test',password:'test-password'});
    // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
    assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},admin.cookie)).status,200);
    const ac=admin.cookie;
    const account=async(name)=>{const user=await server.call('POST','/api/users',{name,email:`staff-${name}@example.test`,password:'test-password'},ac);const login=await server.call('POST','/api/auth/login',{email:`staff-${name}@example.test`,password:'test-password'});return{id:user.data.id,cookie:login.cookie};};
    const alice=await account('Alice'),bob=await account('Bob'),carol=await account('Carol');
    const meta=(await server.call('GET','/api/tasks/meta',undefined,alice.cookie)).data;
    assert.ok(meta.users.some(u=>u.id===bob.id));assert.equal('pass' in meta.users[0],false);assert.equal('role' in meta.users[0],false);
    const staff=await server.call('POST','/api/task-people',{userId:bob.id},ac);
    assert.equal(staff.status,201);assert.equal((await server.call('POST','/api/task-people',{userId:bob.id},ac)).data.id,staff.data.id);
    assert.equal((await server.call('POST','/api/task-people',{userId:carol.id},alice.cookie)).status,403);
    const task=await server.call('POST','/api/tasks',{title:'Direct user assignment',assigneeUserIds:[bob.id,bob.id],result:'Private result'},alice.cookie);
    assert.equal(task.status,201,JSON.stringify(task.data));
    let detail=(await server.call('GET',`/api/tasks/${task.data.id}`,undefined,bob.cookie)).data;
    assert.equal(detail.assignees.length,1);assert.equal(detail.assignees[0].userId,bob.id);assert.equal(detail.result,'Private result');assert.equal(detail.canEdit,true);
    assert.ok((await server.call('GET','/api/tasks',undefined,bob.cookie)).data.tasks.some(t=>t.id===task.data.id));
    assert.equal((await server.call('PUT',`/api/tasks/${task.data.id}`,{assigneeUserIds:[carol.id],assigneeIds:[]},alice.cookie)).status,200);
    detail=(await server.call('GET',`/api/tasks/${task.data.id}`,undefined,bob.cookie)).data;assert.equal(detail.canEdit,false);assert.equal(detail.result,null);
    assert.equal((await server.call('GET',`/api/tasks/${task.data.id}`,undefined,carol.cookie)).data.canEdit,true);
    assert.equal((await server.call('PUT',`/api/tasks/${task.data.id}`,{title:'Invalid update',assigneeUserIds:['missing-user']},alice.cookie)).status,400);
    assert.equal((await server.call('GET',`/api/tasks/${task.data.id}`,undefined,alice.cookie)).data.title,'Direct user assignment');
    await server.call('PUT',`/api/users/${bob.id}`,{disabled:true},ac);
    assert.ok(!(await server.call('GET','/api/tasks/meta',undefined,alice.cookie)).data.users.some(u=>u.id===bob.id));
    assert.equal((await server.call('PUT',`/api/tasks/${task.data.id}`,{assigneeUserIds:[bob.id]},alice.cookie)).status,400);
    assert.equal((await server.call('POST','/api/task-people',{userId:bob.id},ac)).status,400);
    assert.equal((await server.call('PUT',`/api/tasks/${task.data.id}`,{assigneeUserIds:[],assigneeIds:[]},alice.cookie)).status,200);
    assert.deepEqual((await server.call('GET',`/api/tasks/${task.data.id}`,undefined,alice.cookie)).data.assignees,[]);
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('task people work by name with no account link or automatic matching on import',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-unlinked-people-'));let server;
  try{
    server=await start(dir);
    const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Admin',email:'unlinked-admin@example.test',password:'test-password'});
    const ac=admin.cookie;
    await server.call('POST','/api/users',{name:'Same Person',email:'same-person@example.test',password:'test-password'},ac);
    const viewer=await server.call('POST','/api/auth/login',{email:'same-person@example.test',password:'test-password'});
    const person=await server.call('POST','/api/task-people',{name:'Same Person'},ac);
    assert.equal(person.status,201);assert.equal(person.data.userId,null);
    assert.equal((await server.call('POST','/api/task-people',{name:'same person'},ac)).data.id,person.data.id);
    const imported=await server.call('POST','/api/tasks/import',{text:'Tên công việc\tDự án\tGiao cho\tMã công việc\nUnlinked task\tNames\tSame Person\t991'},ac);
    assert.equal(imported.status,200);
    const meta=(await server.call('GET','/api/tasks/meta',undefined,ac)).data;
    assert.equal(meta.people.find(p=>p.id===person.data.id).userId,null);
    const list=(await server.call('GET','/api/tasks',undefined,viewer.cookie)).data;
    assert.equal(list.linked,false);assert.ok(!list.tasks.some(t=>t.title==='Unlinked task'),'a name nobody linked is not anyone\'s task');
    const task=(await visibleTasks(server,ac)).find(t=>t.title==='Unlinked task');
    assert.equal(task.assignees[0].name,'Same Person');assert.equal(task.assignees[0].userId,null);
    const updated=await server.call('PUT',`/api/tasks/${task.id}`,{assigneeIds:[person.data.id],description:'Assigned using a name'},ac);
    assert.equal(updated.status,200);
    const created=await server.call('POST','/api/tasks',{title:'New task by name',assigneeIds:[person.data.id]},ac);
    assert.equal(created.status,201);assert.equal((await server.call('GET',`/api/tasks/${created.data.id}`,undefined,ac)).data.assignees[0].userId,null);
    assert.equal((await server.call('POST','/api/task-people',{name:'Not allowed'},viewer.cookie)).status,403);
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('customer directory links existing folders, multiple campaigns and multi-person tasks', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-crm-'));
  let server;
  try {
    server = await start(dir);
    const admin = await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'crm@example.test',password:'test-password'});
    const cookie = admin.cookie;
    const folder = path.join(dir,'workspace','Existing Client');
    await mkdir(folder,{recursive:true});
    const customer = await server.call('POST','/api/customers',{name:'Client A',existingFolder:{kind:'fs',dir:folder}},cookie);
    assert.equal(customer.status,201,JSON.stringify(customer.data));
    assert.equal(customer.data.folderPath,folder);
    const id = customer.data.id;
    const reportChoices = await server.call('GET','/api/reports/customers',undefined,cookie);
    assert.equal(reportChoices.status,200);
    assert.ok(reportChoices.data.some(c => c.id === id && c.name === 'Client A'));
    const clientReport = await server.call('POST','/api/reports',{customerId:id},cookie);
    assert.equal(clientReport.status,201,JSON.stringify(clientReport.data));
    assert.equal(clientReport.data.customerId,id);
    assert.equal(clientReport.data.data.client,'Client A');
    const invalidClientReport = await server.call('POST','/api/reports',{customerId:'c_missing'},cookie);
    assert.equal(invalidClientReport.status,404);
    const directory = await server.call('GET','/api/customers/directory',undefined,cookie);
    assert.ok(directory.data.some(c => c.id === id));
    const c1 = await server.call('POST',`/api/customers/${id}/projects`,{name:'Campaign 1'},cookie);
    const c2 = await server.call('POST',`/api/customers/${id}/projects`,{name:'Campaign 2'},cookie);
    assert.equal(c1.status,201); assert.equal(c2.status,201);
    const people = [];
    for (const name of ['Staff A','Staff B']) people.push((await server.call('POST','/api/task-people',{name},cookie)).data.id);
    const task = await server.call('POST','/api/tasks',{title:'Campaign work',projectId:c1.data.id,assigneeIds:people},cookie);
    assert.equal(task.status,201,JSON.stringify(task.data));
    const taskDetail = await server.call('GET',`/api/tasks/${task.data.id}`,undefined,cookie);
    assert.equal(taskDetail.data.assignees.length,2);
    const campaigns = await server.call('GET',`/api/customers/${id}/projects`,undefined,cookie);
    assert.equal(campaigns.data.length,2);
    assert.equal(campaigns.data.find(c => c.id === c1.data.id).tasks,1);
    await server.call('POST','/api/users',{name:'Staff',email:'crm-staff@example.test',password:'test-password',role:'member'},cookie);
    const staff = await server.call('POST','/api/auth/login',{email:'crm-staff@example.test',password:'test-password'});
    assert.equal((await server.call('POST',`/api/customers/${id}/projects`,{name:'Forbidden'},staff.cookie)).status,404);
    assert.equal((await server.call('PUT',`/api/customers/${id}/projects/${c1.data.id}`,{unlink:true},staff.cookie)).status,404);
    assert.equal((await server.call('POST','/api/tasks/master',{projectId:c1.data.id,keys:['email_sms'],assigneeIds:people},staff.cookie)).status,403);
    const master = await server.call('POST','/api/tasks/master',{projectId:c1.data.id,keys:['email_sms','ads_onboarding'],assigneeIds:people},cookie);
    assert.equal(master.status,200,JSON.stringify(master.data));
    assert.equal(master.data.created,2);
    const seeded = await server.call('GET',`/api/tasks/${master.data.ids[0]}`,undefined,cookie);
    assert.equal(seeded.data.assignees.length,2);
    await server.call('PUT',`/api/tasks/${master.data.ids[0]}`,{title:'Customized master task',assigneeIds:[people[0]]},cookie);
    const repeated = await server.call('POST','/api/tasks/master',{projectId:c1.data.id,keys:['email_sms','ads_onboarding','crm'],assigneeIds:people},cookie);
    assert.equal(repeated.data.created,1);assert.equal(repeated.data.kept,2);
    const preserved = await server.call('GET',`/api/tasks/${master.data.ids[0]}`,undefined,cookie);
    assert.equal(preserved.data.title,'Customized master task');assert.equal(preserved.data.assignees.length,1);
    const otherProject = await server.call('POST','/api/tasks/master',{projectId:c2.data.id,keys:['email_sms'],assigneeIds:[]},cookie);
    assert.equal(otherProject.data.created,1);assert.notEqual(otherProject.data.ids[0],master.data.ids[0]);
    assert.equal((await server.call('POST','/api/tasks/master',{projectId:c1.data.id,keys:['invalid'],assigneeIds:[]},cookie)).status,400);
    const second = await server.call('POST','/api/customers',{name:'Client B',existingFolder:{kind:'fs',dir:folder}},cookie);
    assert.equal((await server.call('POST',`/api/customers/${second.data.id}/projects`,{projectId:c1.data.id},cookie)).status,409);
    assert.equal((await server.call('PUT',`/api/customers/${id}/projects/${c1.data.id}`,{unlink:true},cookie)).status,200);
    const kept = await server.call('GET',`/api/tasks/${task.data.id}`,undefined,cookie);
    assert.equal(kept.status,200); assert.equal(kept.data.assignees.length,2);
    assert.equal((await server.call('POST',`/api/customers/${second.data.id}/projects`,{projectId:c1.data.id},cookie)).status,200);
  } finally { if (server) await server.close(); await rm(dir,{recursive:true,force:true}); }
});

test('tasks route to real department boards without duplicating cards or copying private results',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-routing-'));let server;
 try {
  server=await start(dir);
  const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'routing@example.test',password:'test-password'});
  const cookie=admin.cookie;
  await server.call('GET','/api/boards',undefined,cookie);
  const local=new DatabaseSync(path.join(dir,'studio.db'));
  local.prepare("INSERT INTO settings(key,value) VALUES('task_workspace_auto','true')").run();local.close();
  const fixtures=[['Paid Ads | Client | Optimized video','Media Execute'],['Client | Content Workbook','Content / Script'],['Website | Client | DNS','Website'],['LSA | Client | Setup','Ads / Performance']];
  for(const [title,boardName] of fixtures){
   const created=await server.call('POST','/api/tasks',{title,result:'PRIVATE RESULT',description:'Public brief'},cookie);
   assert.equal(created.status,201,JSON.stringify(created.data));
   const task=(await server.call('GET',`/api/tasks/${created.data.id}`,undefined,cookie)).data;
   assert.equal(task.boardLink.boardName,boardName);
   const card=(await server.call('GET',`/api/cards/${task.boardLink.cardId}`,undefined,cookie)).data;
   assert.equal(card.description,'Public brief');assert.ok(!JSON.stringify(card).includes('PRIVATE RESULT'));
   await server.call('PUT',`/api/tasks/${task.id}`,{title:title+' revised'},cookie);
   const again=(await server.call('GET',`/api/tasks/${task.id}`,undefined,cookie)).data;
   assert.equal(again.boardLink.cardId,task.boardLink.cardId);
  }
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('Excel customer import is database-only, repeatable and permission-checked',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-customer-import-'));let server;
 try{
  server=await start(dir);
  const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'excel@example.test',password:'test-password'});const cookie=admin.cookie;
  const text='Customer ID\tCustomer Name\tKnown Alias / Project Name\tNumber of Tasks\tLinked Tasks\nC001\tClient Import\t[Master] Client Import\t3\tView related tasks\nC002\tOther Import\t\t0\t';
  const first=await server.call('POST','/api/customers/import',{text,linkProjects:false},cookie);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.created,2);
  const again=await server.call('POST','/api/customers/import',{text,linkProjects:false},cookie);
  assert.equal(again.data.created,0);assert.equal(again.data.kept,2);
  const directory=await server.call('GET','/api/customers/directory',undefined,cookie);assert.equal(directory.data.length,2);
  const customer=directory.data.find(c=>c.name==='Client Import');
  const detail=await server.call('GET',`/api/customers/${customer.id}`,undefined,cookie);
  assert.equal(detail.status,200);assert.equal(detail.data.folderLoc,null);assert.deepEqual(detail.data.files,[]);
  assert.equal((await server.call('PUT',`/api/customers/${customer.id}`,{name:'Client Renamed'},cookie)).status,200);
  const reportChoices=await server.call('GET','/api/reports/customers',undefined,cookie);assert.ok(reportChoices.data.some(c=>c.name==='Client Renamed'));
  await server.call('POST','/api/users',{name:'Staff',email:'excel-staff@example.test',password:'test-password',role:'member'},cookie);
  const staff=await server.call('POST','/api/auth/login',{email:'excel-staff@example.test',password:'test-password'});
  assert.equal((await server.call('POST','/api/customers/import',{text},staff.cookie)).status,403);
  assert.equal((await server.call('DELETE',`/api/customers/${customer.id}`,undefined,cookie)).status,200);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('customer CRUD edits database records, detaches references and leaves Drive metadata untouched',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-customer-crud-'));let server;
 try{
  server=await start(dir);
  const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'customer-crud@example.test',password:'test-password'});const cookie=admin.cookie;
  assert.equal((await server.call('POST','/api/customers',{databaseOnly:true,name:''},cookie)).status,400);
  assert.equal((await server.call('POST','/api/customers',{databaseOnly:true,name:'Invalid',email:'bad'},cookie)).status,400);
  const created=await server.call('POST','/api/customers',{databaseOnly:true,name:'CRUD Client',contact:'Owner',email:'owner@example.test',phone:'+84 123456',notes:'Original'},cookie);
  assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
  assert.equal(created.data.folderLoc,null);
  const project=(await server.call('POST',`/api/customers/${id}/projects`,{name:'Keep campaign'},cookie)).data;
  const task=(await server.call('POST','/api/tasks',{title:'Keep task',projectId:project.id},cookie)).data;
  const report=await server.call('POST','/api/reports',{customerId:id},cookie);assert.equal(report.status,201);
  const local=new DatabaseSync(path.join(dir,'studio.db'));
  const drive=JSON.stringify({account:'drive@example.test',id:'untouched-folder',label:'Original folder',owned:true});
  local.prepare('UPDATE customers SET folder=?,gloc=? WHERE id=?').run('Original folder',drive,id);local.close();
  const edited=await server.call('PUT',`/api/customers/${id}/record`,{name:'Updated Client',contact:'New contact',email:'new@example.test',phone:'0987654321',notes:'Updated'},cookie);
  assert.equal(edited.status,200,JSON.stringify(edited.data));assert.equal(edited.data.name,'Updated Client');assert.equal(edited.data.phone,'0987654321');
  const verify=new DatabaseSync(path.join(dir,'studio.db'));
  assert.equal(verify.prepare('SELECT gloc FROM customers WHERE id=?').get(id).gloc,drive);assert.equal(verify.prepare('SELECT folder FROM customers WHERE id=?').get(id).folder,'Original folder');verify.close();
  await server.call('POST','/api/users',{name:'Staff',email:'crud-staff@example.test',password:'test-password',role:'member'},cookie);
  const staff=await server.call('POST','/api/auth/login',{email:'crud-staff@example.test',password:'test-password'});
  assert.equal((await server.call('PUT',`/api/customers/${id}/record`,{name:'Forbidden'},staff.cookie)).status,404);
  assert.equal((await server.call('DELETE',`/api/customers/${id}`,undefined,staff.cookie)).status,404);
  assert.equal((await server.call('DELETE',`/api/customers/${id}`,undefined,cookie)).status,200);
  assert.equal((await server.call('GET',`/api/customers/${id}/record`,undefined,cookie)).status,404);
  assert.equal((await server.call('GET',`/api/tasks/${task.id}`,undefined,cookie)).status,200);
  assert.equal((await server.call('GET',`/api/reports/${report.data.id}`,undefined,cookie)).status,200);
  const meta=(await server.call('GET','/api/tasks/meta',undefined,cookie)).data;
  assert.equal(meta.projects.find(p=>p.id===project.id).customerId,null);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('customers, projects, campaigns and tasks remain separate with validated hierarchy',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-hierarchy-'));let server;
 try{
  server=await start(dir);const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'hierarchy@example.test',password:'test-password'});const cookie=admin.cookie;
  const customer=(await server.call('POST','/api/customers',{name:'Hierarchy Client',databaseOnly:true},cookie)).data;
  const p1=(await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Project One'},cookie)).data;
  const p2=(await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Project Two'},cookie)).data;
  const c1=await server.call('POST',`/api/task-projects/${p1.id}/campaigns`,{name:'Campaign A'},cookie);
  assert.equal(c1.status,201,JSON.stringify(c1.data));assert.equal(c1.data.projectId,p1.id);assert.notEqual(c1.data.id,p1.id);
  const task=await server.call('POST','/api/tasks',{title:'Campaign Task',projectId:p1.id,campaignId:c1.data.id},cookie);assert.equal(task.status,201);
  const detail=(await server.call('GET',`/api/tasks/${task.data.id}`,undefined,cookie)).data;
  assert.equal(detail.project.id,p1.id);assert.equal(detail.campaign.id,c1.data.id);
  const invalid=await server.call('PUT',`/api/tasks/${task.data.id}`,{projectId:p2.id,campaignId:c1.data.id},cookie);assert.equal(invalid.status,400);
  const list=(await server.call('GET',`/api/tasks?scope=all&project=${p1.id}&campaign=${c1.data.id}`,undefined,cookie)).data;assert.equal(list.tasks.length,1);
  assert.equal((await server.call('DELETE',`/api/task-projects/${p1.id}/campaigns/${c1.data.id}`,undefined,cookie)).status,409);
  const renamed=await server.call('PUT',`/api/task-projects/${p1.id}/campaigns/${c1.data.id}`,{name:'Campaign renamed'},cookie);assert.equal(renamed.status,200);
  const record=(await server.call('GET','/api/customers/directory',undefined,cookie)).data[0];assert.equal(record.projects,2);assert.equal(record.campaigns,1);assert.equal(record.tasks,1);
  const meta=(await server.call('GET','/api/tasks/meta',undefined,cookie)).data;assert.ok(meta.campaigns.some(c=>c.id===c1.data.id));
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('quick-created records share customer, project, campaign, employee and Workspace links across backend views', async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-create-linked-'));
  let server;
  try{
    server=await start(dir);
    const admin=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'quick-admin@example.test',password:'test-password'});
    // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
    assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},admin.cookie)).status,200);
    const cookie=admin.cookie;
    const create=async(url,body)=>{const r=await server.call('POST',url,body,cookie);assert.equal(r.status,201,JSON.stringify(r.data));return r.data;};
    const customer=await create('/api/customers',{name:'Quick Client',databaseOnly:true});
    const project=await create(`/api/customers/${customer.id}/projects`,{name:'Quick Project'});
    const campaign=await create(`/api/task-projects/${project.id}/campaigns`,{name:'Quick Campaign'});
    const department=await create('/api/roles',{name:'Quick Department',pages:['workspace']});
    const employee=await create('/api/users',{name:'Quick Employee',email:'quick-employee@example.test',password:'test-password',role:'member',teamRole:department.id});
    const task=await create('/api/tasks',{title:'Quick Task',projectId:project.id,campaignId:campaign.id,assigneeUserIds:[employee.id]});
    const meta=(await server.call('GET','/api/tasks/meta',undefined,cookie)).data;
    assert.equal(meta.projects.find(p=>p.id===project.id).customerId,customer.id);
    assert.equal(meta.campaigns.find(c=>c.id===campaign.id).projectId,project.id);
    assert.ok(meta.users.some(u=>u.id===employee.id));
    const projects=(await server.call('GET',`/api/customers/${customer.id}/projects`,undefined,cookie)).data;
    assert.equal(projects.find(p=>p.id===project.id).tasks,1);
    const campaigns=(await server.call('GET',`/api/task-projects/${project.id}/campaigns`,undefined,cookie)).data;
    assert.equal(campaigns.find(c=>c.id===campaign.id).tasks,1);
    const board=await create('/api/boards',{name:'Quick Board',roleId:null,private:true,lists:['Chưa thực hiện']});
    const column=await create(`/api/boards/${board.id}/lists`,{name:'Chờ phản hồi'});
    const link=await create(`/api/tasks/${task.id}/card`,{listId:column.id});
    const changed=await server.call('PUT',`/api/tasks/${task.id}`,{status:column.name},cookie);
    assert.equal(changed.status,200);
    const card=(await server.call('GET',`/api/cards/${link.cardId}`,undefined,cookie)).data;
    assert.equal(card.linkedTask.id,task.id);assert.equal(card.listId,column.id);
    const profile=(await server.call('GET',`/api/profiles/${employee.id}`,undefined,cookie)).data;
    assert.equal(profile.department.id,department.id);
    await server.close();server=await start(dir);
    // A company admin lists a department's work, here one employee's.
    const assigned=(await server.call('GET',`/api/tasks?scope=team&team=${department.id}&employee=${employee.id}`,undefined,cookie)).data.tasks;
    assert.equal(assigned.length,1);assert.equal(assigned[0].campaign.id,campaign.id);
    assert.equal(assigned[0].project.id,project.id);assert.equal(assigned[0].status,column.name);
    const directory=(await server.call('GET','/api/customers/directory',undefined,cookie)).data;
    assert.equal(directory.filter(c=>c.id===customer.id).length,1);
  }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('bulk Workspace sync includes parent placeholders, keeps existing links and remains idempotent',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-sync-all-'));let server;
 try{
  server=await start(dir);const setup=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'sync@example.test',password:'test-password'});const cookie=setup.cookie;
  // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},cookie)).status,200);
  const imported=await server.call('POST','/api/tasks/import',{text:'Tên công việc\tDự án\tCông việc cha\tMã công việc\nWebsite child\tSync\tWebsite parent\t991991\nVideo task\tSync\t\t991992'},cookie);
  assert.equal(imported.status,200,JSON.stringify(imported.data));
  const tasks=await visibleTasks(server,cookie);
  assert.equal(tasks.length,3);assert.ok(tasks.some(t=>t.stub));
  const board=(await server.call('POST','/api/boards',{name:'Keep chosen board',roleId:null,private:true,lists:['Chưa thực hiện']},cookie)).data;
  const full=(await server.call('GET',`/api/boards/${board.id}`,undefined,cookie)).data;
  const chosen=tasks.find(t=>t.title==='Video task');
  const link=(await server.call('POST',`/api/tasks/${chosen.id}/card`,{listId:full.lists[0].id},cookie)).data;
  assert.equal((await server.call('POST','/api/tasks/sync-board',{})).status,401);
  const synced=await server.call('POST','/api/tasks/sync-board',{},cookie);assert.equal(synced.status,200,JSON.stringify(synced.data));
  assert.deepEqual(synced.data,{total:3,created:2,linked:3,remaining:0});
  assert.equal((await server.call('GET',`/api/tasks/${chosen.id}`,undefined,cookie)).data.boardLink.cardId,link.cardId);
  assert.equal((await server.call('POST','/api/tasks/sync-board',{},cookie)).data.created,0);
  const rows=await visibleTasks(server,cookie);
  assert.ok(rows.every(task=>task.hasBoardLink&&task.boardLink?.cardId));
  assert.equal(rows.find(task=>task.id===chosen.id).boardLink.boardId,board.id);

  const newTask=await server.call('POST','/api/tasks',{title:'New future video'},cookie);
  assert.ok((await server.call('GET',`/api/tasks/${newTask.data.id}`,undefined,cookie)).data.boardLink);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('notification preferences and mail connection are private, opt in, and administrator controlled',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-mail-access-'));let server;
 try{
  server=await start(dir);const setup=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'mail-admin@example.test',password:'test-password'});const cookie=setup.cookie;
  const user=await server.call('POST','/api/users',{name:'Mail Member',email:'mail-member@example.test',password:'test-password',role:'member'},cookie);
  const login=await server.call('POST','/api/auth/login',{email:user.data.email,password:'test-password'});const member=login.cookie;
  assert.equal((await server.call('GET','/api/notifications')).status,401);
  assert.equal((await server.call('GET','/api/notifications',undefined,member)).data.enabled,false);
  assert.equal((await server.call('GET','/api/notifications/mail/connect',undefined,member)).status,403);
  assert.equal((await server.call('DELETE','/api/notifications/mail',undefined,member)).status,403);
  // Ticking before any email is verified is allowed, and only ever changes the caller's own choice.
  assert.equal((await server.call('PUT','/api/notifications',{enabled:true,email:'other@example.test',userId:setup.data.user.id},member)).status,200);
  const own=(await server.call('GET','/api/notifications',undefined,member)).data;
  assert.equal(own.email,null);assert.equal(own.loginEmail,user.data.email);assert.equal(own.enabled,true);assert.equal(own.verified,false);
  assert.equal((await server.call('GET','/api/notifications',undefined,cookie)).data.enabled,false);
  assert.equal((await server.call('POST','/api/notifications/test',{},member)).status,400);
  assert.equal((await server.call('PUT','/api/notifications',{enabled:false},member)).status,200);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('personal boards require direct membership even for system admins and workspace owners',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-private-boards-'));let server;
 try{
  server=await start(dir);const root=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'root-private@example.test',password:'test-password'});const ac=root.cookie;
  const makeUser=async(name,role='member')=>{const created=await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',role},ac);assert.equal(created.status,201);const login=await server.call('POST','/api/auth/login',{email:created.data.email,password:'test-password'});return {...created.data,cookie:login.cookie};};
  const owner=await makeUser('private-owner'),otherAdmin=await makeUser('private-admin','admin'),guest=await makeUser('private-guest');
  const space=(await server.call('POST','/api/workspaces',{name:'Owner workspace',visibility:'company'},ac)).data;
  await server.call('PUT',`/api/workspaces/${space.id}/members/${owner.id}`,{level:'normal'},ac);
  const board=(await server.call('POST','/api/boards',{name:'Private board',workspaceId:space.id,private:false},owner.cookie)).data;
  assert.equal(board.private,true);assert.equal(board.createdBy,owner.id);
  for(const cookie of [ac,otherAdmin.cookie,guest.cookie]){
    assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,cookie)).status,404);
    assert.equal((await server.call('GET','/api/boards',undefined,cookie)).data.some(b=>b.id===board.id),false);
  }
  assert.equal((await server.call('DELETE',`/api/workspaces/${space.id}`,undefined,guest.cookie)).status,403);
  const detail=(await server.call('GET',`/api/boards/${board.id}`,undefined,owner.cookie)).data;
  assert.deepEqual(detail.members.map(m=>m.id),[owner.id]);
  const card=(await server.call('POST',`/api/lists/${detail.lists[0].id}/cards`,{title:'Private visibility marker'},owner.cookie)).data;
  assert.equal((await server.call('GET',`/api/cards/${card.id}`,undefined,ac)).status,404);
  const search=(await server.call('GET','/api/boards-search?q=Private',undefined,ac)).data;
  assert.equal(JSON.stringify(search).includes(card.id),false);
  await server.call('PUT',`/api/boards/${board.id}/members/${otherAdmin.id}`,{level:'observer'},owner.cookie);
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,otherAdmin.cookie)).data.level,'observer');
  assert.equal((await server.call('POST',`/api/lists/${detail.lists[0].id}/cards`,{title:'Denied'},otherAdmin.cookie)).status,403);
  await server.call('PUT',`/api/boards/${board.id}/members/${guest.id}`,{level:'normal'},owner.cookie);
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,guest.cookie)).status,200);
  await server.call('DELETE',`/api/boards/${board.id}/members/${guest.id}`,undefined,owner.cookie);
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,guest.cookie)).status,404);
  assert.equal((await server.call('DELETE',`/api/boards/${board.id}/members/${owner.id}`,undefined,owner.cookie)).status,400);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('projects require explicit members, retain team classification and revoke nested access',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-project-access-'));let server;
 try{
  server=await start(dir);const root=await server.call('POST','/api/auth/setup',{code:'test-setup-only',email:'project-owner@example.test',password:'test-password'}),cookie=root.cookie;
  const makeUser=async(name,role='member')=>{const r=await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',role},cookie);assert.equal(r.status,201);const login=await server.call('POST','/api/auth/login',{email:r.data.email,password:'test-password'});return {...r.data,cookie:login.cookie};};
  const member=await makeUser('project-member'),stranger=await makeUser('project-admin','admin');
  const customer=(await server.call('POST','/api/customers',{name:'Private Project Client',databaseOnly:true},cookie)).data;
  const projectResponse=await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Private Project'},cookie);assert.equal(projectResponse.status,201,JSON.stringify(projectResponse.data));const project=projectResponse.data;
  const team=(await server.call('POST','/api/roles',{name:'Project Team'},cookie)).data;
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/team`,{teamId:team.id},cookie)).status,200);
  const campaign=(await server.call('POST',`/api/task-projects/${project.id}/campaigns`,{name:'Private Campaign'},cookie)).data;
  const task=(await server.call('POST','/api/tasks',{title:'Project secret task',projectId:project.id,campaignId:campaign.id},cookie)).data;
  await server.call('PUT',`/api/customers/${customer.id}/members/${member.id}`,{level:'normal'},cookie);
  await server.call('PUT',`/api/customers/${customer.id}/members/${stranger.id}`,{level:'admin'},cookie);
  for(const who of [member,stranger]){
   assert.equal((await server.call('GET',`/api/task-projects/${project.id}/campaigns`,undefined,who.cookie)).status,404);
   assert.equal((await server.call('GET',`/api/tasks/${task.id}`,undefined,who.cookie)).status,404);
   assert.equal((await server.call('GET','/api/tasks/meta',undefined,who.cookie)).data.projects.some(p=>p.id===project.id),false);
   assert.equal((await server.call('GET',`/api/customers/${customer.id}/projects`,undefined,who.cookie)).data.some(p=>p.id===project.id),false);
   assert.equal((await server.call('GET','/api/tasks?scope=all',undefined,who.cookie)).data.tasks.some(t=>t.id===task.id),false);
  }
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${member.id}`,{level:'observer'},cookie)).status,200);
  assert.equal((await server.call('GET',`/api/task-projects/${project.id}/campaigns`,undefined,member.cookie)).status,200);
  const visible=(await server.call('GET','/api/tasks/meta',undefined,member.cookie)).data.projects.find(p=>p.id===project.id);assert.equal(visible.teamId,team.id);assert.equal(visible.level,'observer');
  assert.equal((await server.call('POST',`/api/task-projects/${project.id}/campaigns`,{name:'Denied'},member.cookie)).status,403);
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/team`,{teamId:null},member.cookie)).status,403);
  assert.equal((await server.call('DELETE',`/api/task-projects/${project.id}/members/${root.data.user.id}`,undefined,cookie)).status,400);
  assert.equal((await server.call('DELETE',`/api/task-projects/${project.id}/members/${member.id}`,undefined,cookie)).status,200);
  assert.equal((await server.call('GET',`/api/task-projects/${project.id}/members`,undefined,member.cookie)).status,404);
  await server.close();server=await start(dir);
  assert.equal((await server.call('GET','/api/tasks/meta',undefined,cookie)).data.projects.find(p=>p.id===project.id).teamId,team.id);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a customer is deleted only by its owner or the head of the owner\'s department',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-customer-owner-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'owner-boss@example.test',password:'test-password'})).cookie;
  const [media,sale]=(await server.call('GET','/api/roles',undefined,ac)).data;
  for(const dept of [media,sale])assert.equal((await server.call('PUT',`/api/roles/${dept.id}`,{pages:['workspace']},ac)).status,200);
  const account=async(name,dept,position)=>{const u=(await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',teamRole:dept.id,deptRole:dept.positions[position].id},ac)).data;return{...u,cookie:(await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'})).cookie};};
  const owner=await account('owner',media,1),head=await account('head',media,0),manager=await account('manager',media,1),otherHead=await account('otherhead',sale,0);
  const created=await server.call('POST','/api/customers',{databaseOnly:true,name:'Owned Client'},owner.cookie);assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
  assert.equal((await server.call('PUT',`/api/customers/${id}/members/${manager.id}`,{level:'admin'},owner.cookie)).status,200);
  const seen=async who=>(await server.call('GET','/api/customers/directory',undefined,who.cookie)).data.find(c=>c.id===id);
  assert.deepEqual([(await seen(owner)).canDelete,(await seen(head)).canDelete,(await seen(manager)).canDelete,await seen(otherHead)],[true,true,false,undefined]);
  assert.equal((await seen(head)).canManage,true);
  assert.equal((await server.call('POST',`/api/customers/${id}/transfer-owner`,{userId:manager.id},otherHead.cookie)).status,404);
  assert.equal((await server.call('POST',`/api/customers/${id}/transfer-owner`,{userId:manager.id},owner.cookie)).status,200);
  let mems=(await server.call('GET',`/api/customers/${id}/members`,undefined,manager.cookie)).data;
  assert.equal(mems.ownerId,manager.id);
  assert.equal(mems.members.find(m=>m.id===owner.id).level,'admin');
  assert.equal((await server.call('POST',`/api/customers/${id}/transfer-owner`,{userId:owner.id},head.cookie)).status,200);
  mems=(await server.call('GET',`/api/customers/${id}/members`,undefined,owner.cookie)).data;
  assert.equal(mems.ownerId,owner.id);
  assert.equal((await server.call('DELETE',`/api/customers/${id}`,undefined,manager.cookie)).status,403);
  assert.equal((await server.call('DELETE',`/api/customers/${id}`,undefined,otherHead.cookie)).status,404);
  assert.equal((await server.call('DELETE',`/api/customers/${id}`,undefined,head.cookie)).status,200);
  assert.equal(await seen(owner),undefined);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('project followers follow each new task, task followers follow each new subtask, and are notified',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-followers-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'follow-boss@example.test',password:'test-password'})).cookie;
  const account=async name=>{const u=(await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',role:'member'},ac)).data;return{...u,cookie:(await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'})).cookie};};
  const watcher=await account('watcher'),reviewer=await account('reviewer'),outsider=await account('outsider'),helper=await account('helper'),doer=await account('doer');
  const customer=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Followed Client'},ac)).data;
  const project=(await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Followed Project'},ac)).data;
  await server.call('PUT',`/api/customers/${customer.id}/members/${reviewer.id}`,{level:'normal'},ac);
  // The customer's manager adding a follower to its project lets them see the customer, view only.
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${watcher.id}`,{level:'observer'},ac)).status,200);
  assert.equal((await server.call('GET',`/api/customers/${customer.id}/members`,undefined,ac)).data.members.find(m=>m.id===watcher.id).level,'observer');
  // Whoever manages the project can add people to it; the customer opens to them.
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${reviewer.id}`,{level:'admin'},ac)).status,200);
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${helper.id}`,{level:'normal'},reviewer.cookie)).status,200);
  assert.equal((await server.call('GET',`/api/customers/${customer.id}/members`,undefined,ac)).data.members.find(m=>m.id===helper.id).level,'normal');
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${reviewer.id}`,{level:'normal'},ac)).status,200);
  const parent=(await server.call('POST','/api/tasks',{title:'Parent task',projectId:project.id},ac)).data;
  let detail=(await server.call('GET',`/api/tasks/${parent.id}`,undefined,ac)).data;
  assert.deepEqual(detail.followers.map(f=>f.id),[watcher.id]);
  // Following a task opens its project to the follower, view only and without following the whole project.
  assert.equal((await server.call('PUT',`/api/tasks/${parent.id}`,{followerUserIds:[watcher.id,outsider.id]},ac)).status,200);
  const projectMembers=(await server.call('GET',`/api/task-projects/${project.id}/members`,undefined,ac)).data.members;
  assert.equal(projectMembers.find(m=>m.id===outsider.id).level,'viewer');
  assert.equal((await server.call('GET',`/api/tasks/${parent.id}`,undefined,outsider.cookie)).data.canEdit,false);
  assert.equal((await server.call('PUT',`/api/tasks/${parent.id}`,{followerUserIds:[watcher.id,reviewer.id]},ac)).status,200);
  const child=(await server.call('POST','/api/tasks',{title:'Child task',projectId:project.id,parentId:parent.id},ac)).data;
  detail=(await server.call('GET',`/api/tasks/${child.id}`,undefined,ac)).data;
  assert.deepEqual(detail.followers.map(f=>f.id).sort(),[watcher.id,reviewer.id].sort());
  assert.equal(detail.canEdit,true);
  const asWatcher=(await server.call('GET',`/api/tasks/${child.id}`,undefined,watcher.cookie)).data;
  assert.equal(asWatcher.canEdit,false);
  const inbox=async who=>(await server.call('GET','/api/notifications/inbox',undefined,who.cookie)).data.items;
  assert.deepEqual((await inbox(reviewer)).filter(i=>i.taskId).map(i=>[i.taskId,i.title]),[[child.id,'Có công việc con mới bạn đang theo dõi'],[parent.id,'Bạn được thêm theo dõi công việc']]);
  assert.ok((await inbox(watcher)).some(i=>i.taskId===parent.id&&i.title==='Công việc mới bạn đang theo dõi'));
  assert.equal((await server.call('PUT',`/api/tasks/${child.id}`,{status:'Đang thực hiện'},ac)).status,200);
  assert.equal((await inbox(watcher))[0].title,'Công việc bạn theo dõi được cập nhật');
  // Only the tasks someone does or follows reach them: not every task of a project they are on, nor their own changes.
  assert.equal((await inbox(helper)).some(i=>i.taskId),false);
  assert.equal((await inbox({cookie:ac})).some(i=>i.taskId),false);
  assert.equal((await server.call('DELETE',`/api/tasks/${child.id}`,undefined,ac)).status,200);
  // Giving someone a task makes them a member of its project and customer, so they can work on it.
  const given=(await server.call('POST','/api/tasks',{title:'Given task',projectId:project.id,assigneeUserIds:[doer.id]},ac)).data;
  assert.equal((await server.call('GET',`/api/task-projects/${project.id}/members`,undefined,ac)).data.members.find(m=>m.id===doer.id).level,'normal');
  assert.equal((await server.call('PUT',`/api/tasks/${given.id}`,{status:'Đang thực hiện'},doer.cookie)).status,200);
  assert.equal((await inbox({cookie:ac})).some(i=>i.taskId===given.id),false);
  // "Công việc của tôi": what is given to the account or followed by it, nothing else.
  const mine=async who=>(await server.call('GET','/api/tasks',undefined,who.cookie)).data.tasks.map(t=>t.id);
  assert.ok((await mine(watcher)).includes(parent.id));
  assert.ok((await mine(doer)).includes(given.id));
  assert.equal((await mine(helper)).includes(parent.id),false);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('any employee can be put on a card: they join its board and its customer opens to them',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-card-people-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'card-boss@example.test',password:'test-password'})).cookie;
  const staff=(await server.call('POST','/api/users',{name:'Outside',email:'card-outside@example.test',password:'test-password',role:'member'},ac)).data;
  const board=(await server.call('POST','/api/boards',{name:'Riêng'},ac)).data;
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.members.some(m=>m.id===staff.id),false);
  const card=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Thẻ mở'},ac)).data;
  assert.equal((await server.call('PUT',`/api/cards/${card.id}/members`,{userId:staff.id,on:true},ac)).status,200);
  const after=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data;
  assert.equal(after.members.find(m=>m.id===staff.id).level,'normal');
  assert.ok((await server.call('GET',`/api/cards/${card.id}`,undefined,ac)).data.members.includes(staff.id));
  const customer=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Kín'},ac)).data;
  const secret=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Thẻ kín'},ac)).data;
  assert.equal((await server.call('PUT',`/api/cards/${secret.id}`,{customerId:customer.id},ac)).status,200);
  assert.equal((await server.call('PUT',`/api/cards/${secret.id}/members`,{userId:staff.id,on:true},ac)).status,200);
  const members=(await server.call('GET',`/api/customers/${customer.id}/members`,undefined,ac)).data.members;
  assert.equal(members.find(m=>m.id===staff.id).level,'normal');
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('someone given a task of a customer finds it on Khách hàng without Drive; its Drive folder stays closed',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-customer-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'tc-boss@example.test',password:'test-password'})).cookie;
  const role=(await server.call('POST','/api/roles',{name:'Content',pages:['editor']},ac)).data;
  const staff=(await server.call('POST','/api/users',{name:'Writer',email:'tc-writer@example.test',password:'test-password',role:'member',teamRole:role.id},ac)).data;
  const customer=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách giao việc'},ac)).data;
  const other=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách khác'},ac)).data;
  const project=(await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Dự án giao'},ac)).data;
  const sc=(await server.call('POST','/api/auth/login',{email:'tc-writer@example.test',password:'test-password'})).cookie;
  assert.deepEqual((await server.call('GET','/api/customers/directory',undefined,sc)).data,[]);
  assert.equal((await server.call('POST','/api/tasks',{title:'Viết bài',projectId:project.id,assigneeUserIds:[staff.id]},ac)).status,201);
  assert.deepEqual((await server.call('GET','/api/customers/directory',undefined,sc)).data.map(c=>c.id),[customer.id]);
  assert.equal((await server.call('GET',`/api/customers/${customer.id}/record`,undefined,sc)).status,200);
  assert.equal((await server.call('GET',`/api/customers/${customer.id}/tasks`,undefined,sc)).data.length,1);
  assert.equal((await server.call('GET',`/api/customers/${other.id}/record`,undefined,sc)).status,404);
  // Not its Drive folder, nor adding customers, nor changing one they only work on.
  assert.equal((await server.call('GET',`/api/customers/${customer.id}`,undefined,sc)).status,403);
  assert.equal((await server.call('POST','/api/customers',{databaseOnly:true,name:'Mới'},sc)).status,403);
  assert.equal((await server.call('PUT',`/api/customers/${customer.id}/record`,{name:'Đổi'},sc)).status,403);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a customer\'s services are its projects\'; services once set on a customer go to its projects',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-project-services-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'ps-boss@example.test',password:'test-password'})).cookie;
  const web=(await server.call('POST','/api/admin/services',{name:'Website'},ac)).data, ads=(await server.call('POST','/api/admin/services',{name:'Meta Ads'},ac)).data;
  const names=async(id)=>(await server.call('GET',`/api/customers/${id}/record`,undefined,ac)).data.needs.map(n=>n.name);
  // Set on a customer before projects carried them (no project yet): still its services, until its first project takes them.
  const old=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách cũ'},ac)).data;
  const db=new DatabaseSync(path.join(dir,'studio.db'));
  db.prepare('INSERT INTO customer_needs(customer_id,service_id,created_at) VALUES(?,?,?),(?,?,?)').run(old.id,web.id,1,old.id,ads.id,1);
  db.close();
  assert.deepEqual(await names(old.id),['Meta Ads','Website']);
  const first=(await server.call('POST',`/api/customers/${old.id}/projects`,{name:'Dự án đầu'},ac)).data;
  const listed=async(id)=>(await server.call('GET',`/api/customers/${id}/projects`,undefined,ac)).data;
  assert.deepEqual((await listed(old.id)).find(p=>p.id===first.id).services.map(n=>n.name),['Meta Ads','Website']);
  // From then on they are the project's: dropping one there drops it from the customer.
  assert.equal((await server.call('PUT',`/api/task-projects/${first.id}`,{services:[web.id]},ac)).status,200);
  assert.deepEqual(await names(old.id),['Website']);
  // A new project gets the services it is created with (the form offers the customer's); the customer has them all.
  const second=(await server.call('POST','/api/task-projects',{name:'Dự án quảng cáo',customerId:old.id,services:[ads.id]},ac)).data;
  assert.deepEqual(await names(old.id),['Meta Ads','Website']);
  const meta=(await server.call('GET','/api/tasks/meta',undefined,ac)).data;
  assert.deepEqual(meta.projects.find(p=>p.id===second.id).services.map(n=>n.name),['Meta Ads']);
  // Deleting a project takes its services off the customer.
  assert.equal((await server.call('DELETE',`/api/task-projects/${second.id}`,undefined,ac)).status,200);
  assert.deepEqual(await names(old.id),['Website']);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a role given customers.create adds customers without Drive; Drive folders still need Drive',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-create-customer-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'cc-boss@example.test',password:'test-password'})).cookie;
  const dept=(await server.call('POST','/api/roles',{name:'Content',pages:['editor']},ac)).data;
  const maxx=(await server.call('POST','/api/users',{name:'Maxx',email:'cc-maxx@example.test',password:'test-password',role:'member',teamRole:dept.id},ac)).data;
  const mc=(await server.call('POST','/api/auth/login',{email:'cc-maxx@example.test',password:'test-password'})).cookie;
  assert.equal((await server.call('POST','/api/customers',{databaseOnly:true,name:'Chưa được'},mc)).status,403);
  const roles=(await server.call('GET','/api/admin/roles',undefined,ac)).data;
  const adminRole=(roles.items||roles).find(r=>r.key==='admin').id;
  assert.equal((await server.call('PUT',`/api/admin/staff/${maxx.id}/roles`,{roles:[{roleId:adminRole,scope:null}]},ac)).status,200);
  const made=await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách của Maxx'},mc);
  assert.equal(made.status,201,JSON.stringify(made.data));
  assert.equal((await server.call('GET',`/api/customers/${made.data.id}/record`,undefined,mc)).status,200,'and opens it');
  assert.equal((await server.call('POST','/api/customers',{name:'Có thư mục'},mc)).status,403,'a Drive folder still needs Drive');
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a board is made for a customer, moved to another or cleared by its admins; only customers they reach',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-board-customer-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'bc-boss@example.test',password:'test-password'})).cookie;
  const one=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách một'},ac)).data, two=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách hai'},ac)).data;
  const board=(await server.call('POST','/api/boards',{name:'Board khách',bg:'ocean',roleId:null,private:true,customerId:one.id},ac)).data;
  const read=async()=>(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data;
  assert.equal((await read()).customerName,'Khách một');
  assert.equal((await server.call('PUT',`/api/boards/${board.id}`,{customerId:two.id},ac)).status,200);
  assert.equal((await read()).customerName,'Khách hai');
  assert.equal((await server.call('PUT',`/api/boards/${board.id}`,{customerId:null},ac)).status,200);
  assert.equal((await read()).customerId,null);
  // Someone else may not tie their board to a customer they cannot reach.
  await server.call('POST','/api/users',{name:'Other',email:'bc-other@example.test',password:'test-password',role:'member'},ac);
  const oc=(await server.call('POST','/api/auth/login',{email:'bc-other@example.test',password:'test-password'})).cookie;
  assert.equal((await server.call('POST','/api/boards',{name:'Của tôi',bg:'ocean',roleId:null,private:true,customerId:one.id},oc)).status,404);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a board has a type it opens in and a start date (now unless given); a task holds a branch of subtasks at any depth',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-board-type-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'bt-boss@example.test',password:'test-password'})).cookie;
  const before=Date.now();
  const plain=(await server.call('POST','/api/boards',{name:'Mặc định',bg:'ocean',roleId:null,private:true},ac)).data;
  assert.equal(plain.view,'board');
  assert.ok(plain.startAt>=before&&plain.startAt<=Date.now(),'no date given: it starts now');
  const day=Date.UTC(2026,9,1,2,0);
  const cal=(await server.call('POST','/api/boards',{name:'Lịch',bg:'ocean',roleId:null,private:true,view:'calendar',startAt:day},ac)).data;
  assert.equal(cal.view,'calendar');assert.equal(cal.startAt,day);
  assert.equal((await server.call('POST','/api/boards',{name:'Lạ',bg:'ocean',roleId:null,private:true,view:'map'},ac)).data.view,'board');
  assert.equal((await server.call('POST','/api/boards',{name:'Sai ngày',bg:'ocean',roleId:null,private:true,startAt:12},ac)).status,400);
  assert.equal((await server.call('PUT',`/api/boards/${cal.id}`,{view:'timeline',startAt:day+864e5},ac)).status,200);
  const read=(await server.call('GET',`/api/boards/${cal.id}`,undefined,ac)).data;
  assert.equal(read.view,'timeline');assert.equal(read.startAt,day+864e5);
  assert.ok((await server.call('GET','/api/boards',undefined,ac)).data.some((b)=>b.id===cal.id&&b.view==='timeline'));
  // Subtasks of subtasks: the task shows the whole branch, each with its parent.
  const root=(await server.call('POST','/api/tasks',{title:'Gốc'},ac)).data.id;
  const a=(await server.call('POST','/api/tasks',{title:'Con A',parentId:root},ac)).data.id;
  const b=(await server.call('POST','/api/tasks',{title:'Con B',parentId:root},ac)).data.id;
  const a1=(await server.call('POST','/api/tasks',{title:'Cháu A1',parentId:a},ac)).data.id;
  const a1x=(await server.call('POST','/api/tasks',{title:'Chắt A1x',parentId:a1},ac)).data.id;
  const branch=(await server.call('GET',`/api/tasks/${root}`,undefined,ac)).data.childTasks;
  assert.deepEqual(branch.map((k)=>[k.title,k.parent.id]).sort(),[['Chắt A1x',a1],['Cháu A1',a],['Con A',root],['Con B',root]].sort());
  assert.deepEqual((await server.call('GET',`/api/tasks/${a1}`,undefined,ac)).data.path.map((p)=>p.id),[root,a]);
  assert.equal((await server.call('PUT',`/api/tasks/${a}`,{parentId:a1x},ac)).status,400,'never under its own branch');
  assert.ok(b);
  // A task names its services; a client's work in a workspace lists its boards' cards with them.
  const svc=(await server.call('POST','/api/admin/services',{name:'Quay video'},ac)).data;
  assert.equal((await server.call('PUT',`/api/tasks/${a}`,{services:[svc.id]},ac)).status,200);
  assert.deepEqual((await server.call('GET',`/api/tasks/${a}`,undefined,ac)).data.services.map((x)=>x.name),['Quay video']);
  assert.equal((await server.call('PUT',`/api/tasks/${a}`,{services:['nope']},ac)).status,400);
  const client=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách bảng'},ac)).data;
  const cb=(await server.call('POST','/api/boards',{name:'Board của khách',bg:'ocean',roleId:null,private:true,customerId:client.id},ac)).data;
  const list=(await server.call('GET',`/api/boards/${cb.id}`,undefined,ac)).data.lists[0];
  const card=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Dựng clip',syncTask:true},ac)).data;
  const linked=(await server.call('GET',`/api/cards/${card.id}`,undefined,ac)).data.linkedTask;
  assert.ok(linked,'a new card is a task');
  await server.call('PUT',`/api/tasks/${linked.id}`,{services:[svc.id]},ac);
  const work=(await server.call('GET','/api/client-work?workspace=company',undefined,ac)).data;
  const row=work.find((x)=>x.id===card.id);
  assert.ok(row,'the card of a client board is listed');
  assert.equal(row.customerName,'Khách bảng');assert.equal(row.listName,list.name);
  assert.deepEqual(row.services.map((x)=>x.name),['Quay video']);
  assert.ok(!work.some((x)=>x.boardId===cal.id),'boards for no client stay out');
  // The work reads as a tree: a subtask of the card's task is listed under it, in the same client.
  const sub=(await server.call('POST','/api/tasks',{title:'Việc con của thẻ',parentId:linked.id},ac)).data.id;
  const again=(await server.call('GET','/api/client-work?workspace=company',undefined,ac)).data;
  const subRow=again.find((x)=>x.taskId===sub);
  assert.ok(subRow,'the subtask is listed');
  assert.equal(subRow.parentTaskId,linked.id);assert.equal(subRow.customerName,'Khách bảng');
  assert.equal(again.find((x)=>x.id===card.id).stage,'todo');
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('@ in a comment or a card description tells the person mentioned, once, if they see the board',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-mention-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'mn-boss@example.test',password:'test-password'})).cookie;
  const ann=(await server.call('POST','/api/users',{name:'Ann',email:'mn-ann@example.test',password:'test-password',role:'member'},ac)).data;
  const bob=(await server.call('POST','/api/users',{name:'Bob',email:'mn-bob@example.test',password:'test-password',role:'member'},ac)).data;
  const annC=(await server.call('POST','/api/auth/login',{email:'mn-ann@example.test',password:'test-password'})).cookie;
  const bobC=(await server.call('POST','/api/auth/login',{email:'mn-bob@example.test',password:'test-password'})).cookie;
  const board=(await server.call('POST','/api/boards',{name:'Nhắc tên',bg:'ocean',roleId:null,private:true},ac)).data;
  assert.equal((await server.call('PUT',`/api/boards/${board.id}/members/${ann.id}`,{level:'normal'},ac)).status,200);
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  const card=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Quay video'},ac)).data;
  const tag=(u)=>`<span data-mention="${u.id}">@${u.name}</span>`;
  const mine=async(c)=>(await server.call('GET','/api/notifications/inbox',undefined,c)).data.items.filter((i)=>i.title==='Bạn được nhắc đến');
  // Ann sees the board and is told; Bob does not see it and is not.
  const made=(await server.call('POST',`/api/cards/${card.id}/comments`,{text:`<div>${tag(ann)} ${tag(bob)} xem giúp</div>`},ac)).data;
  assert.equal((await mine(annC)).length,1);
  assert.equal((await mine(annC))[0].link,`#boards/${board.id}/c/${card.id}`);
  assert.equal((await mine(bobC)).length,0);
  // Editing the comment does not tell her again.
  await server.call('PUT',`/api/comments/${made.id}`,{text:`<div>${tag(ann)} xem giúp nhé</div>`},ac);
  assert.equal((await mine(annC)).length,1);
  // Named in the description: told once more.
  await server.call('PUT',`/api/cards/${card.id}`,{description:`<div>Phụ trách: ${tag(ann)}</div>`},ac);
  assert.equal((await mine(annC)).length,2);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a workspace of one\'s own can be for a customer; its boards\' work counts for that customer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-ws-client-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'wc-boss@example.test',password:'test-password'})).cookie;
  const one=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách workspace'},ac)).data, two=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Khách khác'},ac)).data;
  const ws=(await server.call('POST','/api/workspaces',{name:'Dự án khách',customerId:one.id},ac)).data;
  assert.equal(ws.customerName,'Khách workspace');
  const find=async()=>(await server.call('GET','/api/workspaces',undefined,ac)).data.find((w)=>w.id===ws.id);
  // A board in it with no customer of its own: its cards count for the workspace's customer.
  const board=(await server.call('POST','/api/boards',{name:'Board trong workspace',bg:'ocean',roleId:null,private:true,workspaceId:ws.id},ac)).data;
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  const card=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Việc của workspace'},ac)).data;
  const row=(await server.call('GET',`/api/client-work?workspace=${ws.id}`,undefined,ac)).data.find((x)=>x.id===card.id);
  assert.equal(row?.customerName,'Khách workspace');
  assert.equal((await server.call('PUT',`/api/workspaces/${ws.id}`,{customerId:two.id},ac)).status,200);
  assert.equal((await find()).customerName,'Khách khác');
  assert.equal((await server.call('PUT',`/api/workspaces/${ws.id}`,{customerId:null},ac)).status,200);
  assert.equal((await find()).customerId,null);
  assert.equal((await server.call('POST','/api/workspaces',{name:'Sai',customerId:'nope'},ac)).status,404);
  // A board's type is the services it is for; its cards count for them unless their task names its own.
  const svc=(await server.call('POST','/api/admin/services',{name:'Website'},ac)).data;
  const typed=(await server.call('POST','/api/boards',{name:'Board website',bg:'ocean',roleId:null,private:true,workspaceId:ws.id,services:[svc.id]},ac)).data;
  assert.deepEqual(typed.services.map((x)=>x.name),['Website']);
  assert.deepEqual((await server.call('GET','/api/boards',undefined,ac)).data.find((b)=>b.id===typed.id).services.map((x)=>x.name),['Website']);
  assert.equal((await server.call('PUT',`/api/workspaces/${ws.id}`,{customerId:one.id},ac)).status,200);
  const tl=(await server.call('GET',`/api/boards/${typed.id}`,undefined,ac)).data.lists[0];
  const tc=(await server.call('POST',`/api/lists/${tl.id}/cards`,{title:'Sửa trang chủ'},ac)).data;
  assert.deepEqual((await server.call('GET',`/api/client-work?workspace=${ws.id}`,undefined,ac)).data.find((x)=>x.id===tc.id).services.map((x)=>x.name),['Website']);
  // The timeline asks for the cards for no customer too.
  const loose=(await server.call('POST','/api/boards',{name:'Board không khách',bg:'ocean',roleId:null,private:true},ac)).data;
  const ll=(await server.call('GET',`/api/boards/${loose.id}`,undefined,ac)).data.lists[0];
  const lc=(await server.call('POST',`/api/lists/${ll.id}/cards`,{title:'Việc nội bộ'},ac)).data;
  assert.ok(!(await server.call('GET','/api/client-work?workspace=company',undefined,ac)).data.some((x)=>x.id===lc.id));
  assert.equal((await server.call('GET','/api/client-work?workspace=company&all=1',undefined,ac)).data.find((x)=>x.id===lc.id)?.customerId,'');
  assert.equal((await server.call('PUT',`/api/boards/${typed.id}`,{services:[]},ac)).status,200);
  assert.deepEqual((await server.call('GET',`/api/boards/${typed.id}`,undefined,ac)).data.services,[]);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('chat unread counts follow what each person has read, on any device; support requests carry screenshots',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-chat-read-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'cr-boss@example.test',password:'test-password'})).cookie;
  const boss=(await server.call('GET','/api/auth/me',undefined,ac)).data.user;
  const aeris=(await server.call('POST','/api/users',{name:'Aeris',email:'cr-aeris@example.test',password:'test-password',role:'member'},ac)).data;
  const xc=(await server.call('POST','/api/auth/login',{email:'cr-aeris@example.test',password:'test-password'})).cookie;
  const unread=async(c)=>(await server.call('GET','/api/chat/unread',undefined,c)).data;
  assert.equal((await server.call('POST','/api/chat/messages',{message:'Chào',channel:'dm',recipientId:aeris.id},ac)).status,201);
  assert.equal((await server.call('POST','/api/chat/messages',{message:'Có việc gấp',channel:'dm',recipientId:aeris.id},ac)).status,201);
  assert.deepEqual((await unread(xc)).dms.map(d=>[d.senderId,d.count]),[[boss.id,2]]);
  // Opening the chat reads it: nothing unread any more, on this device or another.
  await server.call('GET',`/api/chat/messages?channel=dm&recipientId=${boss.id}`,undefined,xc);
  const other=(await server.call('POST','/api/auth/login',{email:'cr-aeris@example.test',password:'test-password'})).cookie;
  assert.deepEqual((await unread(other)).dms,[]);
  await new Promise(r=>setTimeout(r,5));
  await server.call('POST','/api/chat/messages',{message:'Thêm một tin',channel:'dm',recipientId:aeris.id},ac);
  assert.deepEqual((await unread(xc)).dms.map(d=>d.count),[1]);
  // The general channel: what came after reading it.
  await server.call('POST','/api/chat/messages',{message:'Cả nhà',channel:'general'},ac);
  assert.equal((await unread(xc)).general,1);
  await server.call('GET','/api/chat/messages?channel=general',undefined,xc);
  assert.equal((await unread(xc)).general,0);
  // A support request: screenshots, text optional with them; the list says how many, the pictures load on their own.
  const png='data:image/png;base64,'+Buffer.from('fake-png').toString('base64');
  assert.equal((await server.call('POST','/api/support',{message:'',images:[png]},xc)).status,201);
  assert.equal((await server.call('POST','/api/support',{message:'Lỗi',images:['javascript:alert(1)']},xc)).status,400);
  assert.equal((await server.call('POST','/api/support',{message:'Lỗi',images:[png,png,png,png]},xc)).status,400);
  const list=(await server.call('GET','/api/admin/support',undefined,ac)).data.items;
  assert.equal(list.length,1);assert.equal(list[0].images,1);assert.equal(list[0].message,'');
  assert.deepEqual((await server.call('GET',`/api/admin/support/${list[0].id}/images`,undefined,ac)).data,[png]);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('each account has its own notification email, and whatever concerns that person is sent there',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-notify-people-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'notify-boss@example.test',password:'test-password'})).cookie;
  const made=await server.call('POST','/api/users',{name:'Dylan',email:'dylan@example.test',password:'test-password',role:'member',notifyEmail:'Dylan.Personal@Example.test'},ac);
  assert.equal(made.status,201,JSON.stringify(made.data));
  const dylan=made.data,cookie=(await server.call('POST','/api/auth/login',{email:'dylan@example.test',password:'test-password'})).cookie;
  assert.equal((await server.call('GET','/api/users',undefined,ac)).data.find(u=>u.id===dylan.id).notifyEmail,'dylan.personal@example.test');
  assert.equal((await server.call('GET','/api/notifications',undefined,cookie)).data.email,'dylan.personal@example.test');
  const board=(await server.call('POST','/api/boards',{name:'Thông báo'},ac)).data;
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists;
  const card=(await server.call('POST',`/api/lists/${list[0].id}/cards`,{title:'Dựng video'},ac)).data;
  await server.call('PUT',`/api/cards/${card.id}/members`,{userId:dylan.id,on:true},ac);
  await server.call('POST',`/api/cards/${card.id}/comments`,{text:'Xem lại bản 2'},ac);
  await server.call('PUT',`/api/cards/${card.id}`,{listId:list[1].id},ac);
  await server.call('POST',`/api/cards/${card.id}/comments`,{text:'Đã sửa'},cookie);
  const items=(await server.call('GET','/api/notifications/inbox',undefined,cookie)).data.items;
  assert.deepEqual(items.map(i=>i.title).sort(),['Bình luận mới trên thẻ của bạn','Bạn được thêm vào thẻ','Thẻ của bạn được chuyển danh sách'].sort());
  assert.ok(items.every(i=>i.link===`#boards/${board.id}/c/${card.id}`));
  // In the app the notification shows what it is about: the comment itself, the card's list (never in the mail).
  assert.equal(items.find(i=>i.title==='Bình luận mới trên thẻ của bạn').detail.text,'Xem lại bản 2');
  assert.equal(items.find(i=>i.title==='Thẻ của bạn được chuyển danh sách').detail.status,list[1].name);
  assert.equal((await server.call('GET','/api/notifications/latest',undefined,cookie)).data.latest,Math.max(...items.map(i=>i.createdAt)));
  assert.equal((await server.call('GET','/api/notifications/inbox',undefined,ac)).data.items.some(i=>i.title==='Bình luận mới trên thẻ của bạn'),false);
  const db=new DatabaseSync(path.join(dir,'studio.db'));
  const queued=db.prepare('SELECT payload FROM mail_outbox WHERE user_id=?').all(dylan.id).map(r=>JSON.parse(r.payload));db.close();
  assert.equal(queued.length,3);assert.ok(queued.every(p=>!JSON.stringify(p).includes('Xem lại bản 2')));
  assert.equal((await server.call('PUT',`/api/users/${dylan.id}`,{notifyEmail:''},ac)).data.notifyEmail,null);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a board looks the same to everyone and interface choices belong to each account',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-personal-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'personal-boss@example.test',password:'test-password'})).cookie;
  const made=(await server.call('POST','/api/users',{name:'Mia',email:'mia@example.test',password:'test-password',role:'member'},ac)).data;
  const mia=(await server.call('POST','/api/auth/login',{email:'mia@example.test',password:'test-password'})).cookie;
  const board=(await server.call('POST','/api/boards',{name:'Nền riêng',bg:'ocean'},ac)).data;
  await server.call('PUT',`/api/boards/${board.id}/members/${made.id}`,{level:'observer'},ac);
  // The background, label names and folded lists are the board's, set by its admins and seen alike by everyone.
  assert.equal((await server.call('PUT',`/api/boards/${board.id}/background`,{bg:'forest'},mia)).status,403);
  assert.equal((await server.call('PUT',`/api/boards/${board.id}/background`,{bg:'nope'},ac)).status,400);
  assert.equal((await server.call('PUT',`/api/boards/${board.id}/background`,{bg:'forest'},ac)).status,200);
  assert.equal((await server.call('PUT',`/api/boards/${board.id}`,{labelText:true},mia)).status,403);
  assert.equal((await server.call('PUT',`/api/boards/${board.id}`,{labelText:true},ac)).status,200);
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  assert.equal((await server.call('PUT',`/api/lists/${list.id}`,{folded:true},mia)).status,403);
  assert.equal((await server.call('PUT',`/api/lists/${list.id}`,{folded:true},ac)).status,200);
  const seen=async who=>{const b=(await server.call('GET',`/api/boards/${board.id}`,undefined,who)).data;const l=(await server.call('GET','/api/boards',undefined,who)).data.find(x=>x.id===board.id);return[b.bg,l.bg,b.labelText,b.lists[0].folded,b.canShape];};
  assert.deepEqual(await seen(mia),['forest','forest',true,true,false]);
  assert.deepEqual(await seen(ac),['forest','forest',true,true,true]);
  // Theme, language, panels and the Drive view are kept with the account: merged, forgotten with null; other keys are
  // left out (an older page may still send them).
  assert.equal((await server.call('GET','/api/auth/me',undefined,mia)).data.prefs,null);
  assert.equal((await server.call('PUT','/api/auth/prefs',{'dms.theme':'dark','dms.lang':'en'},mia)).status,200);
  assert.equal((await server.call('PUT','/api/auth/prefs',{'dms.lang':null,'dms.panels':'{"inbox":false}'},mia)).status,200);
  assert.deepEqual((await server.call('GET','/api/auth/me',undefined,mia)).data.prefs,{'dms.theme':'dark','dms.panels':'{"inbox":false}'});
  assert.equal((await server.call('GET','/api/auth/me',undefined,ac)).data.prefs,null);
  assert.equal((await server.call('PUT','/api/auth/prefs',{'dms.lastProject':'p_1','dms.driveView':'list'},mia)).status,200);
  assert.deepEqual((await server.call('GET','/api/auth/me',undefined,mia)).data.prefs,{'dms.theme':'dark','dms.panels':'{"inbox":false}','dms.driveView':'list'});
  assert.equal((await server.call('PUT','/api/auth/prefs',{'dms.theme':5},mia)).status,400);
  assert.equal((await server.call('PUT','/api/auth/prefs',{'dms.theme':'dark'})).status,401);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('project members update its tasks and their cards; followers only look',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-editors-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'editors-boss@example.test',password:'test-password'})).cookie;
  // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},ac)).status,200);
  const account=async name=>{const u=(await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',role:'member'},ac)).data;return{...u,cookie:(await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'})).cookie};};
  const member=await account('editor-member'),watcher=await account('editor-watcher'),doer=await account('editor-doer');
  const customer=(await server.call('POST','/api/customers',{databaseOnly:true,name:'Editors Client'},ac)).data;
  const project=(await server.call('POST',`/api/customers/${customer.id}/projects`,{name:'Editors Project'},ac)).data;
  await server.call('PUT',`/api/task-projects/${project.id}/members/${member.id}`,{level:'normal'},ac);
  await server.call('PUT',`/api/task-projects/${project.id}/members/${watcher.id}`,{level:'observer'},ac);
  const task=(await server.call('POST','/api/tasks',{title:'Shared work',projectId:project.id,assigneeUserIds:[doer.id],result:'Draft link'},ac)).data;
  const detail=async who=>(await server.call('GET',`/api/tasks/${task.id}`,undefined,who.cookie)).data;
  assert.equal((await detail(member)).canEdit,true);assert.equal((await detail(member)).result,'Draft link');
  assert.equal((await detail(watcher)).canEdit,false);assert.equal((await detail(watcher)).result,null);
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{status:'Đang thực hiện'},member.cookie)).status,200);
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{status:'Hoàn thành'},watcher.cookie)).status,403);
  // On a card the task is the same work: the project's member changes it from the board as well.
  const board=(await server.call('POST','/api/boards',{name:'Editors Board'},ac)).data;
  const lists=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists;
  const linked=await server.call('POST',`/api/tasks/${task.id}/card`,{listId:lists[0].id},ac);
  assert.equal(linked.status,201,JSON.stringify(linked.data));
  await server.call('PUT',`/api/boards/${board.id}/members/${member.id}`,{level:'normal'},ac);
  assert.equal((await server.call('PUT',`/api/cards/${linked.data.cardId}`,{title:'Shared work v2'},member.cookie)).status,200);
  assert.equal((await detail(doer)).title,'Shared work v2');
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{dueAt:Date.now()+864e5},member.cookie)).status,200);
  // A written description stays its writer's: others who edit the work leave it as it is, on the task and on its card.
  assert.equal((await detail(member)).canEditDescription,true);
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{description:'Brief by the member'},member.cookie)).status,200);
  assert.equal((await detail(doer)).canEditDescription,false);
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{description:'Rewritten'},doer.cookie)).status,403);
  await server.call('PUT',`/api/boards/${board.id}/members/${doer.id}`,{level:'normal'},ac);
  assert.equal((await server.call('PUT',`/api/cards/${linked.data.cardId}`,{description:'Rewritten on the board'},doer.cookie)).status,403);
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{status:'Hoàn thành',description:'Brief by the member'},doer.cookie)).status,200);
  assert.equal((await server.call('GET',`/api/cards/${linked.data.cardId}`,undefined,member.cookie)).data.canEditDescription,true);
  assert.equal((await server.call('PUT',`/api/cards/${linked.data.cardId}`,{description:'Brief v2'},member.cookie)).status,200);
  assert.equal((await detail(member)).description,'Brief v2');
  assert.equal((await server.call('PUT',`/api/tasks/${task.id}`,{description:'Admin note'},ac)).status,200);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a card holds the work result: its own note for editors, the linked task\'s once linked, and per-customer result files',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-card-result-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'boss@example.test',password:'test-password'})).cookie;
  // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},ac)).status,200);
  const account=async name=>{const u=(await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password'},ac)).data;return{id:u.id,cookie:(await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'})).cookie};};
  const ed=await account('ed'),sam=await account('sam');
  const ws=(await server.call('POST','/api/workspaces',{name:'Kết quả'},ac)).data;
  const board=(await server.call('POST','/api/boards',{name:'Media',workspaceId:ws.id},ac)).data;
  for(const [who,level] of [[ed,'normal'],[sam,'observer']]){await server.call('PUT',`/api/workspaces/${ws.id}/members/${who.id}`,{level},ac);await server.call('PUT',`/api/boards/${board.id}/members/${who.id}`,{level},ac);}
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  const card=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Bàn giao'},ac)).data;
  // A card without a task keeps its own note, for those who edit the card.
  assert.equal((await server.call('PUT',`/api/cards/${card.id}`,{result:'login: x'},ed.cookie)).status,200);
  assert.equal((await server.call('PUT',`/api/cards/${card.id}`,{result:'nope'},sam.cookie)).status,403);
  const byEd=(await server.call('GET',`/api/cards/${card.id}`,undefined,ed.cookie)).data;
  assert.deepEqual([byEd.result,byEd.resultHidden],['login: x',false]);
  const bySam=(await server.call('GET',`/api/cards/${card.id}`,undefined,sam.cookie)).data;
  assert.deepEqual([bySam.result,bySam.resultHidden],[null,true]);
  // Linked to a task, the card's note joins the task's, and the result is read and written on the task from then on.
  const task=(await server.call('POST','/api/tasks',{title:'Bàn giao'},ac)).data;
  assert.equal((await server.call('POST',`/api/tasks/${task.id}/card`,{cardId:card.id},ac)).status,201);
  assert.equal((await server.call('GET',`/api/tasks/${task.id}`,undefined,ac)).data.result,'login: x');
  const linked=(await server.call('GET',`/api/cards/${card.id}`,undefined,ac)).data;
  assert.deepEqual([linked.linkedTask?.id,linked.result,linked.resultHidden],[task.id,null,false]);
  assert.equal((await server.call('PUT',`/api/cards/${card.id}`,{result:'elsewhere'},ac)).status,400);
  // The cards of one customer, each with its result files (the Drive tab marks the files with them).
  const [a,b]=await Promise.all(['Khách A','Khách B'].map(async name=>(await server.call('POST','/api/customers',{databaseOnly:true,name},ac)).data));
  const other=(await server.call('POST',`/api/lists/${list.id}/cards`,{title:'Khác'},ac)).data;
  await server.call('PUT',`/api/cards/${card.id}`,{customerId:a.id},ac);
  await server.call('PUT',`/api/cards/${other.id}`,{customerId:b.id},ac);
  const ofA=(await server.call('GET',`/api/customer-tasks?customer=${a.id}`,undefined,ac)).data;
  assert.deepEqual(ofA.map(t=>[t.id,t.customerId,t.files.length]),[[card.id,a.id,0]]);
  assert.equal((await server.call('GET','/api/customer-tasks',undefined,ac)).data.length,2);
  assert.equal((await server.call('POST',`/api/cards/${card.id}/files`,{keys:[]},ac)).status,400);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a sheet import links the names it gives people to the employee accounts the importer chooses, and remembers them',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-import-links-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Admin',email:'links-admin@example.test',password:'test-password'})).cookie;
  const minh=(await server.call('POST','/api/users',{name:'Trần Minh',email:'minh@example.test',password:'test-password'},ac)).data;
  await server.call('POST','/api/users',{name:'Khánh Đỗ',email:'khanh@example.test',password:'test-password'},ac);
  const minhCookie=(await server.call('POST','/api/auth/login',{email:'minh@example.test',password:'test-password'})).cookie;
  const sheet='Tên công việc\tDự án\tGiao cho\tMã công việc\nDựng video\tLaunch\tDM, Khánh Đỗ\t501\nCắt teaser\tLaunch\tDM\t502';
  const task=async(cookie,id='501')=>(await visibleTasks(server,cookie)).find(t=>t.externalId===id);
  // The importer says "DM" is Trần Minh: the task shows the employee, who now opens the project of the work.
  assert.equal((await server.call('POST','/api/tasks/import',{text:sheet,people:{DM:'u_missing'}},ac)).status,400);
  const first=await server.call('POST','/api/tasks/import',{text:sheet,people:{DM:minh.id,'Khánh Đỗ':null}},ac);
  assert.equal(first.status,200);assert.equal(first.data.linked,1);
  const linked=(await task(ac)).assignees;
  assert.deepEqual(linked.map(a=>[a.name,a.userId]).sort(),[['Khánh Đỗ',null],['Trần Minh',minh.id]]);
  assert.ok(await task(minhCookie,'502'),'the linked employee sees the tasks given to them');
  // A name nobody chose stays a name, even when an account has the same one.
  const people=(await server.call('GET','/api/tasks/meta',undefined,ac)).data.people;
  assert.equal(people.find(p=>p.name==='Khánh Đỗ').userId,null);
  // The next import remembers the link; choosing "keep the name" lets it go.
  assert.equal((await server.call('POST','/api/tasks/import',{text:sheet},ac)).data.linked,0);
  assert.equal((await task(ac,'502')).assignees[0].userId,minh.id);
  await server.call('POST','/api/tasks/import',{text:sheet,people:{DM:null}},ac);
  assert.deepEqual((await task(ac,'502')).assignees.map(a=>[a.name,a.userId]),[['DM',null]]);
  assert.equal((await server.call('POST','/api/tasks/import',{text:sheet,people:{DM:minh.id}},minhCookie)).status,403);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('my tasks include the tasks whose card has me as a member',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-card-member-tasks-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Admin',email:'members-admin@example.test',password:'test-password'})).cookie;
  // This test links tasks to cards by hand: new tasks are not put on Workspace by themselves here.
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},ac)).status,200);
  const a=(await server.call('POST','/api/users',{name:'Anh',email:'anh@example.test',password:'test-password'},ac)).data;
  const anh=(await server.call('POST','/api/auth/login',{email:'anh@example.test',password:'test-password'})).cookie;
  const ws=(await server.call('POST','/api/workspaces',{name:'Đội'},ac)).data;
  const board=(await server.call('POST','/api/boards',{name:'Ads',workspaceId:ws.id},ac)).data;
  const list=(await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.lists[0];
  // Imported with a name from the sheet (not Anh's account), shown on the board as a card.
  await server.call('POST','/api/tasks/import',{text:'Tên công việc\tDự án\tGiao cho\tMã công việc\nReport lead so với Media Plan\tAds\tSheet Name\t801'},ac);
  const task=(await visibleTasks(server,ac)).find(t=>t.externalId==='801');
  const {cardId}=(await server.call('POST',`/api/tasks/${task.id}/card`,{listId:list.id},ac)).data;
  const mine=async()=>(await server.call('GET','/api/tasks',undefined,anh)).data.tasks.map(t=>t.externalId);
  assert.deepEqual(await mine(),[]);
  assert.equal((await server.call('PUT',`/api/cards/${cardId}/members`,{userId:a.id,on:true},ac)).status,200);
  assert.deepEqual(await mine(),['801']);
  await server.call('PUT',`/api/cards/${cardId}/members`,{userId:a.id,on:false},ac);
  assert.deepEqual(await mine(),[]);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('people list only their own tasks; a department head also the department\'s, a company admin any department\'s',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-scopes-'));let server;
 try{
  server=await start(dir,{DRIVE_DIR:path.join(dir,'drive')});
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Admin',email:'scopes-admin@example.test',password:'test-password'})).cookie;
  const roles=(await server.call('GET','/api/roles',undefined,ac)).data;
  const media=roles.find(r=>r.name==='Media Execute'),sale=roles.find(r=>r.name==='Account / Sale');
  const account=async(name,d,position)=>{const u=(await server.call('POST','/api/users',{name,email:`${name}@example.test`,password:'test-password',teamRole:d.id,deptRole:d.positions.find(p=>p.name===position).id},ac)).data;return{...u,cookie:(await server.call('POST','/api/auth/login',{email:`${name}@example.test`,password:'test-password'})).cookie};};
  const head=await account('head',media,'Trưởng phòng'),staff=await account('staff',media,'Nhân viên'),seller=await account('seller',sale,'Nhân viên');
  const give=async(title,who)=>(await server.call('POST','/api/tasks',{title,assigneeUserIds:[who.id]},ac)).data.id;
  const ofStaff=await give('Staff video',staff),ofHead=await give('Head review',head),ofSeller=await give('Seller call',seller);
  const list=async(cookie,query='')=>(await server.call('GET',`/api/tasks${query}`,undefined,cookie)).data.tasks.map(t=>t.id).sort();
  // Staff: their own work only, whatever they ask for.
  assert.deepEqual(await list(staff.cookie),[ofStaff]);
  assert.deepEqual(await list(staff.cookie,'?scope=all'),[ofStaff]);
  assert.equal((await server.call('GET','/api/tasks?scope=team',undefined,staff.cookie)).status,403);
  // The head of Media: their department's work, never another department's.
  assert.deepEqual(await list(head.cookie,'?scope=team'),[ofStaff,ofHead].sort());
  assert.deepEqual(await list(head.cookie,`?scope=team&team=${sale.id}`),[ofStaff,ofHead].sort());
  // A company admin: any department's.
  assert.deepEqual(await list(ac,`?scope=team&team=${sale.id}`),[ofSeller]);
  assert.deepEqual(await list(ac,`?scope=team&team=${media.id}`),[ofStaff,ofHead].sort());
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});

test('a new task goes onto its project\'s board as a card, shared with the project\'s people, unless an admin turns that off',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-auto-card-'));let server;
 try{
  server=await start(dir);
  const ac=(await server.call('POST','/api/auth/setup',{code:'test-setup-only',name:'Boss',email:'auto-boss@example.test',password:'test-password'})).cookie;
  const user=async(name,email)=>{const u=(await server.call('POST','/api/users',{name,email,password:'test-password',role:'member'},ac)).data;return{...u,cookie:(await server.call('POST','/api/auth/login',{email,password:'test-password'})).cookie};};
  const mia=await user('Mia','auto-mia@example.test'),bob=await user('Bob','auto-bob@example.test');
  assert.equal((await server.call('GET','/api/admin/settings',undefined,ac)).data.taskWorkspaceAuto,true);
  const project=(await server.call('POST','/api/task-projects',{name:'Auto project'},ac)).data;
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}/members/${bob.id}`,{level:'normal'},ac)).status,200);
  const made=await server.call('POST','/api/tasks',{title:'Dựng reel',projectId:project.id,assigneeUserIds:[mia.id]},ac);
  assert.equal(made.status,201);
  // Its card is on the project's own board, named after it; the project's people and the person it is given to are on
  // that board, which holds only the project's work.
  const own=(await server.call('GET',`/api/tasks/${made.data.id}`,undefined,ac)).data;
  const board=(await server.call('GET',`/api/boards/${own.boardLink.boardId}`,undefined,ac)).data;
  assert.equal(board.name,'Auto project');
  assert.deepEqual((await server.call('GET',`/api/cards/${own.boardLink.cardId}`,undefined,ac)).data.members,[mia.id]);
  const levelOf=async(who)=>(await server.call('GET',`/api/boards/${board.id}`,undefined,who.cookie)).data.level;
  assert.equal(await levelOf(mia),'normal');assert.equal(await levelOf(bob),'normal');
  assert.equal((await server.call('GET',`/api/tasks/${made.data.id}`,undefined,mia.cookie)).data.boardLink.cardId,own.boardLink.cardId);
  const listed=(await server.call('GET',`/api/tasks?scope=all&project=${project.id}`,undefined,bob.cookie)).data.tasks;
  assert.deepEqual(listed.map(t=>[t.id,!!t.boardLink]),[[made.data.id,true]]);
  // The maker's work outside the project stays theirs: a task of no project given to Mia puts her on its card only.
  const loose=(await server.call('POST','/api/tasks',{title:'Gia hạn router',result:'pw: R0uter!',assigneeUserIds:[mia.id]},ac)).data;
  const secret=(await server.call('POST','/api/tasks',{title:'Việc riêng',result:'pin 4321'},ac)).data;
  const looseCard=(await server.call('GET',`/api/tasks/${loose.id}`,undefined,ac)).data.boardLink;
  assert.notEqual(looseCard.boardId,board.id);
  assert.equal((await server.call('GET',`/api/boards/${looseCard.boardId}`,undefined,mia.cookie)).status,404);
  assert.equal((await server.call('GET',`/api/tasks/${secret.id}`,undefined,mia.cookie)).status,404);
  // Renamed, the board follows; a person taken off the project comes off its board.
  assert.equal((await server.call('PUT',`/api/task-projects/${project.id}`,{name:'Auto project 2'},ac)).status,200);
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,ac)).data.name,'Auto project 2');
  assert.equal((await server.call('DELETE',`/api/task-projects/${project.id}/members/${bob.id}`,undefined,ac)).status,200);
  assert.equal((await server.call('GET',`/api/boards/${board.id}`,undefined,bob.cookie)).status,404);
  // Given to someone else: they join the card (and the board) and the one it was given to before comes off the card.
  assert.equal((await server.call('PUT',`/api/tasks/${made.data.id}`,{assigneeUserIds:[bob.id]},ac)).status,200);
  assert.deepEqual((await server.call('GET',`/api/cards/${own.boardLink.cardId}`,undefined,ac)).data.members,[bob.id]);
  assert.equal(await levelOf(bob),'normal');
  // Taken off its card, it stays off when edited later.
  assert.equal((await server.call('DELETE',`/api/tasks/${made.data.id}/card`,undefined,ac)).status,200);
  assert.equal((await server.call('PUT',`/api/tasks/${made.data.id}`,{title:'Dựng reel v2'},ac)).status,200);
  assert.equal((await server.call('GET',`/api/tasks/${made.data.id}`,undefined,ac)).data.boardLink,null);
  // Turned off: a new task stays off Workspace until linked or synced.
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:false},ac)).data.taskWorkspaceAuto,false);
  const plain=(await server.call('POST','/api/tasks',{title:'Không lên board'},ac)).data;
  assert.equal((await server.call('GET',`/api/tasks/${plain.id}`,undefined,ac)).data.boardLink,null);
  assert.equal((await server.call('PUT','/api/admin/settings',{taskWorkspaceAuto:true},bob.cookie)).status,403);
 }finally{if(server)await server.close();await rm(dir,{recursive:true,force:true});}
});
