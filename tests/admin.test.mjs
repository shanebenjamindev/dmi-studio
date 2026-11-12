import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
// A server of its own on a scratch database and Drive folder (never the real data or Drive).
async function start(dataDir) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  await mkdir(path.join(dataDir, 'workspace'), { recursive: true });
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, DRIVE_DIR: path.join(dataDir, 'workspace'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'admin-test', CF_API_TOKEN: '', CF_ACCOUNT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => output += b); child.stderr.on('data', (b) => output += b);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
    const check = () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check); child.once('exit', () => { clearTimeout(t); reject(new Error('Server failed: ' + output)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    async call(method, url, body, cookie) {
      const res = await fetch(origin + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
    },
    async close() { const done = once(child, 'exit'); child.kill(); await done; },
  };
}
const ok = (r, what = '') => { assert.ok(r.status < 300, `${what} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };

/** A company with a super admin, two departments and their people. */
async function company(s) {
  const boss = await s.call('POST', '/api/auth/setup', { code: 'admin-test', name: 'Boss', email: 'boss@x.test', password: 'password-123' });
  assert.equal(boss.status, 201);
  const b = boss.cookie;
  const media = ok(await s.call('POST', '/api/roles', { name: 'Media', color: '#2a78d6', pages: ['workspace'] }, b));
  const sale = ok(await s.call('POST', '/api/roles', { name: 'Sale', color: '#eb6834', pages: ['workspace'] }, b));
  const people = {};
  for (const [key, dept] of [['ann', media], ['bob', media], ['cat', sale], ['dan', sale], ['eve', null]]) {
    people[key] = ok(await s.call('POST', '/api/admin/staff', { name: key, email: `${key}@x.test`, password: 'password-123', departmentId: dept?.id || null }, b), `create ${key}`);
    people[key].cookie = (await s.call('POST', '/api/auth/login', { email: `${key}@x.test`, password: 'password-123' })).cookie;
  }
  const roles = ok(await s.call('GET', '/api/admin/roles', undefined, b));
  const role = (k) => roles.find((r) => r.key === k).id;
  return { b, bossId: boss.data.user.id, media, sale, people, role };
}

test('admin module: permissions come from roles at a scope, and nobody raises their own power', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-admin-'));
  const s = await start(dir);
  try {
    const { b, bossId, media, people: { ann, bob, cat, dan, eve }, role } = await company(s);
    // The first account is Super Admin, the same as the company admin of the other pages.
    const me = ok(await s.call('GET', '/api/auth/me', undefined, b));
    assert.equal(me.admin.superAdmin, true); assert.equal(me.admin.perms['rbac.manage'], 'organization');
    // Members have no admin permission: no page, and every endpoint refuses.
    assert.deepEqual(ok(await s.call('GET', '/api/auth/me', undefined, ann.cookie)).admin.perms, {});
    assert.equal((await s.call('GET', '/api/admin/staff', undefined, ann.cookie)).status, 403);
    assert.equal((await s.call('GET', '/api/admin/logs?kind=action', undefined, ann.cookie)).status, 403);

    // Manager (department scope) sees their department only, and cannot change roles.
    ok(await s.call('PUT', `/api/admin/staff/${ann.id}/roles`, { roles: [{ roleId: role('manager'), scope: null }] }, b), 'make ann manager');
    const seen = ok(await s.call('GET', '/api/admin/staff?size=100', undefined, ann.cookie)).items.map((x) => x.name).sort();
    assert.deepEqual(seen, ['ann', 'bob']);
    assert.equal((await s.call('GET', `/api/admin/staff/${cat.id}`, undefined, ann.cookie)).status, 404);
    assert.equal((await s.call('PUT', `/api/admin/staff/${bob.id}/roles`, { roles: [] }, ann.cookie)).status, 403);
    // A role granted with a narrower scope is capped there.
    ok(await s.call('PUT', `/api/admin/staff/${dan.id}/roles`, { roles: [{ roleId: role('admin'), scope: 'personal' }] }, b));
    assert.equal(ok(await s.call('GET', '/api/auth/me', undefined, dan.cookie)).admin.perms['staff.view'], 'personal');
    assert.deepEqual(ok(await s.call('GET', '/api/admin/staff', undefined, dan.cookie)).items.map((x) => x.name), ['dan']);

    // Admin is not everything: no role changes, no system settings.
    ok(await s.call('PUT', `/api/admin/staff/${cat.id}/roles`, { roles: [{ roleId: role('admin'), scope: null }] }, b));
    assert.equal((await s.call('PUT', '/api/admin/settings', { logRetentionDays: 200 }, cat.cookie)).status, 403);
    assert.equal((await s.call('PUT', `/api/admin/staff/${eve.id}/roles`, { roles: [] }, cat.cookie)).status, 403);
    assert.equal((await s.call('GET', '/api/users', undefined, cat.cookie)).status, 403, 'company-admin endpoints stay with Super Admins');
    // …but org.* opens department editing, which was company-admin only.
    assert.equal((await s.call('PUT', `/api/roles/${media.id}`, { name: 'Media Execute' }, cat.cookie)).status, 200);
    assert.equal((await s.call('PUT', `/api/roles/${media.id}`, { name: 'Nope' }, bob.cookie)).status, 403);

    // A custom HR role (rank 70) that manages roles: only below itself, never itself, never more than it holds.
    const hr = ok(await s.call('POST', '/api/admin/roles', { name: 'HR', rank: 70, perms: { 'rbac.view': 'organization', 'rbac.manage': 'organization', 'staff.view': 'organization' } }, b));
    ok(await s.call('PUT', `/api/admin/staff/${bob.id}/roles`, { roles: [{ roleId: hr.id, scope: null }] }, b));
    assert.equal((await s.call('PUT', `/api/admin/staff/${eve.id}/roles`, { roles: [{ roleId: role('admin'), scope: null }] }, bob.cookie)).status, 403, 'Admin ranks above HR');
    assert.equal((await s.call('PUT', `/api/admin/staff/${bob.id}/roles`, { roles: [{ roleId: role('leader'), scope: null }, { roleId: hr.id, scope: null }] }, bob.cookie)).status, 403, 'not their own roles');
    assert.equal((await s.call('PUT', `/api/admin/staff/${cat.id}/roles`, { roles: [] }, bob.cookie)).status, 403, 'not someone ranked above them');
    ok(await s.call('PUT', `/api/admin/staff/${eve.id}/roles`, { roles: [{ roleId: role('leader'), scope: null }] }, bob.cookie), 'HR gives Leader');
    assert.equal((await s.call('POST', '/api/admin/roles', { name: 'Equal', rank: 70, perms: {} }, bob.cookie)).status, 400);
    assert.equal((await s.call('POST', '/api/admin/roles', { name: 'Sneaky', rank: 30, perms: { 'settings.update': 'organization' } }, bob.cookie)).status, 403);
    assert.equal((await s.call('PUT', `/api/admin/roles/${hr.id}`, { perms: { 'rbac.manage': 'organization', 'settings.update': 'organization' } }, bob.cookie)).status, 403, 'not its own role');
    assert.equal((await s.call('PUT', '/api/admin/roles/role_super_admin', { name: 'x' }, b)).status, 403);
    assert.equal((await s.call('DELETE', `/api/admin/roles/${role('admin')}`, undefined, b)).status, 400, 'built-in roles stay');

    // Super Admin and the company admin flag move together, both ways; the last one stays.
    ok(await s.call('PUT', `/api/admin/staff/${eve.id}/roles`, { roles: [{ roleId: 'role_super_admin', scope: null }] }, b));
    assert.equal((await s.call('GET', '/api/users', undefined, eve.cookie)).status, 200);
    ok(await s.call('PUT', `/api/users/${eve.id}`, { role: 'member' }, b));
    const demoted = ok(await s.call('GET', `/api/admin/staff/${eve.id}`, undefined, b));
    assert.equal(demoted.superAdmin, false); assert.ok(!demoted.roles.some((r) => r.key === 'super_admin'));
    assert.equal((await s.call('GET', '/api/auth/me', undefined, eve.cookie)).data.user, null, 'a lower role signs them out everywhere');
    assert.equal((await s.call('PUT', `/api/admin/staff/${bossId}/roles`, { roles: [] }, b)).status, 403, 'nobody changes their own roles');
    assert.equal((await s.call('POST', `/api/admin/staff/${bossId}/lock`, { locked: true }, b)).status, 403);
    // Locking ends every session at once.
    ok(await s.call('POST', `/api/admin/staff/${dan.id}/lock`, { locked: true }, b));
    assert.equal((await s.call('GET', '/api/auth/me', undefined, dan.cookie)).data.user, null);
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'dan@x.test', password: 'password-123' })).status, 403);

    // Every permission change is in the permission log, which nobody can delete.
    const perms = ok(await s.call('GET', '/api/admin/logs?kind=permission&size=100', undefined, b)).items;
    assert.ok(perms.some((l) => l.action === 'Cấp vai trò' && l.entityId === ann.id && /Manager/.test(l.after.roles)));
    assert.ok(perms.some((l) => l.action === 'Tạo vai trò' && l.entityLabel === 'HR'));
    assert.ok(perms.some((l) => /Super Admin/.test(l.action) && l.entityId === eve.id), 'role changes from the old user form are logged too');
    assert.equal((await s.call('DELETE', '/api/admin/logs', undefined, b)).status, 404);
    const refused = ok(await s.call('GET', '/api/admin/logs?kind=action&q=B%E1%BB%8B%20t%E1%BB%AB%20ch%E1%BB%91i&size=100', undefined, b)).items;
    assert.ok(refused.some((l) => l.userId === bob.id && l.status === 403), 'refused attempts are logged');
    const logins = ok(await s.call('GET', '/api/admin/logs?kind=login&size=100', undefined, b)).items;
    assert.ok(logins.some((l) => l.email === 'dan@x.test' && !l.ok && l.reason === 'Tài khoản đã bị khoá'));
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('admin module: task and customer records, their history, and the lists the other pages use', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-admin-'));
  // A customer imported before the code had a field of its own: its code moves out of the notes once.
  await mkdir(dir, { recursive: true });
  const s0 = await start(dir); await s0.close();
  const db = new DatabaseSync(path.join(dir, 'studio.db'));
  db.prepare("INSERT INTO customers(id,name,notes,links,folder,status,created_at,updated_at) VALUES('c_old','Old',?,'[]','','legacy_status',1,1)").run('Mã khách hàng: KH-7\nTên khác / dự án: Ceramic');
  db.prepare("UPDATE settings SET value=? WHERE key='admin_seeded'").run(JSON.stringify(['task_statuses', 'task_priorities']));
  // Last upgraded by older code: the upgrade runs again on the next start.
  db.prepare("DELETE FROM settings WHERE key='schema_version'").run();
  db.close();
  const s = await start(dir);
  try {
    const check = new DatabaseSync(path.join(dir, 'studio.db'), { readOnly: true });
    assert.deepEqual({ ...check.prepare("SELECT code, notes FROM customers WHERE id='c_old'").get() }, { code: 'KH-7', notes: 'Tên khác / dự án: Ceramic' });
    assert.equal(check.prepare("SELECT id FROM customer_statuses WHERE id='legacy_status'").get().id,'legacy_status');
    check.close();
    const { b, people: { ann, cat }, role } = await company(s);
    ok(await s.call('PUT', `/api/admin/staff/${ann.id}/roles`, { roles: [{ roleId: role('manager'), scope: null }] }, b));

    // Statuses: the Tasks page uses the list; a new name follows into the tasks; the default one stays.
    const t1 = ok(await s.call('POST', '/api/tasks', { title: 'Quay video', status: 'Đang đánh giá', assigneeUserIds: [ann.id], dueAt: Date.now() - 86400e3 }, b));
    const t2 = ok(await s.call('POST', '/api/tasks', { title: 'Báo giá', assigneeUserIds: [cat.id], dueAt: Date.now() + 86400e3 }, b));
    const { statuses } = ok(await s.call('GET', '/api/admin/task-statuses', undefined, b));
    const review = statuses.find((x) => x.name === 'Đang đánh giá'), first = statuses.find((x) => x.locked);
    ok(await s.call('PUT', `/api/admin/task-statuses/${review.id}`, { name: 'Chờ khách duyệt' }, b));
    assert.equal(ok(await s.call('GET', `/api/tasks/${t1.id}`, undefined, b)).status, 'Chờ khách duyệt');
    assert.ok(ok(await s.call('GET', '/api/tasks/meta', undefined, b)).statuses.includes('Chờ khách duyệt'));
    assert.equal((await s.call('PUT', `/api/admin/task-statuses/${first.id}`, { active: false }, b)).status, 400);
    assert.equal((await s.call('DELETE', `/api/admin/task-statuses/${first.id}`, undefined, b)).status, 400);
    // A status a workflow stage gives cannot go; deleting another one gives its tasks the status of their stage.
    assert.equal((await s.call('DELETE', `/api/admin/task-statuses/${review.id}`, undefined, b)).status, 409);
    ok(await s.call('PUT', `/api/tasks/${t2.id}`, { status: 'Tạm dừng' }, b));
    const paused = statuses.find((x) => x.name === 'Tạm dừng');
    const delRes = ok(await s.call('DELETE', `/api/admin/task-statuses/${paused.id}`, undefined, b));
    assert.equal(delRes.tasksReset, 1, 'deleting an in-use status gives its tasks their stage\'s status');
    assert.equal(ok(await s.call('GET', `/api/tasks/${t2.id}`, undefined, b)).status, 'Đang thực hiện');
    const added = ok(await s.call('POST', '/api/admin/task-statuses', { name: 'Huỷ bởi khách', color: '#ef4444' }, b));
    assert.equal(added.category, 'cancelled', 'what a status means comes from its name, as on the Tasks page');

    // Tasks in Quản trị: the manager sees the department's work only, with no description or result; history is kept.
    ok(await s.call('PUT', `/api/tasks/${t1.id}`, { title: 'Quay video Ceramic', result: 'mật khẩu: abc' }, b));
    const theirs = ok(await s.call('GET', '/api/admin/tasks', undefined, ann.cookie));
    assert.deepEqual(theirs.items.map((t) => t.title), ['Quay video Ceramic']);
    assert.equal(theirs.counts.overdue, 1);
    assert.equal((await s.call('GET', `/api/admin/tasks/${t2.id}`, undefined, ann.cookie)).status, 404);
    const detail = ok(await s.call('GET', `/api/admin/tasks/${t1.id}`, undefined, b));
    assert.equal(detail.result, undefined); assert.equal(detail.description, undefined);
    const change = detail.history.find((h) => h.after?.title === 'Quay video Ceramic');
    assert.equal(change.before.title, 'Quay video');
    assert.equal(change.after.result, '(đã đổi)', 'a result is logged as changed, never its value');
    assert.ok(!JSON.stringify(detail.history).includes('abc'));
    const high = ok(await s.call('GET', '/api/admin/task-priorities', undefined, b)).find((p) => p.name === 'Cao');
    ok(await s.call('PUT', `/api/admin/tasks/${t1.id}/priority`, { priorityId: high.id }, ann.cookie));
    assert.equal((await s.call('DELETE', `/api/admin/task-priorities/${high.id}`, undefined, b)).status, 409);

    // Customers: a category, services from their projects (chosen from the catalogue), archiving hides it from the Customers page lists.
    const vip = ok(await s.call('POST', '/api/admin/customer-categories', { name: 'VIP', color: '#2a78d6' }, b));
    const ppf = ok(await s.call('POST', '/api/admin/services', { name: 'Dán PPF', price: 25000000 }, b));
    assert.ok(ok(await s.call('GET','/api/customers/classifications',undefined,b)).some(x=>x.id===vip.id));
    const fresh=ok(await s.call('POST','/api/customers',{name:'New classified customer',databaseOnly:true,status:'caring',categoryId:vip.id},b));
    const freshRecord=ok(await s.call('GET',`/api/customers/${fresh.id}/record`,undefined,b));
    assert.equal(freshRecord.status,'caring');assert.equal(freshRecord.category.id,vip.id);
    const legacy=ok(await s.call('POST','/api/customers',{name:'Unclassified existing customer',databaseOnly:true},b));
    const legacyRecord=ok(await s.call('GET',`/api/customers/${legacy.id}/record`,undefined,b));
    // With no status given, a new customer starts at the first status in use; it has no category until one is chosen.
    assert.equal(legacyRecord.status,'lead');assert.equal(legacyRecord.category,null);
    ok(await s.call('PUT',`/api/customers/${legacy.id}/record`,{status:'active',categoryId:vip.id},b));
    for(const id of [fresh.id,legacy.id]){
      const detail=ok(await s.call('GET',`/api/customers/${id}/record`,undefined,b));
      const directory=ok(await s.call('GET','/api/customers/directory',undefined,b)).find(x=>x.id===id);
      const admin=ok(await s.call('GET','/api/admin/customers',undefined,b)).items.find(x=>x.id===id);
      assert.equal(detail.category.id,directory.category.id);assert.equal(detail.category.id,admin.category.id);
      assert.equal(detail.status,directory.status);assert.equal(detail.status,admin.status);
    }
    for(const invalid of [{status:'toString'},{status:42},{categoryId:'missing'}]){
      assert.equal((await s.call('PUT',`/api/customers/${legacy.id}/record`,{name:'Must not change',...invalid},b)).status,400);
      assert.equal(ok(await s.call('GET',`/api/customers/${legacy.id}/record`,undefined,b)).name,'Unclassified existing customer');
    }
    // A project names only services of the catalogue; nothing is made when one is unknown.
    assert.equal((await s.call('POST',`/api/customers/${legacy.id}/projects`,{name:'Invalid project',services:['missing']},b)).status,400);
    assert.ok(!ok(await s.call('GET',`/api/customers/${legacy.id}/projects`,undefined,b)).some(x=>x.name==='Invalid project'));
    ok(await s.call('PUT',`/api/customers/${legacy.id}/record`,{status:null,categoryId:null},b));
    assert.equal(ok(await s.call('GET',`/api/customers/${legacy.id}/record`,undefined,b)).category,null);

    assert.equal((await s.call('POST', '/api/admin/services', { name: 'x', image: 'http://insecure.test/a.png' }, b)).status, 400);
    const c = ok(await s.call('POST', '/api/admin/customers', { name: 'Garage A', categoryId: vip.id, managerId: ann.id, status: 'lead' }, b));
    // Its services are those of its projects: set on a project, seen on the customer, gone when the project drops them.
    const garageProject = ok(await s.call('POST', `/api/customers/${c.id}/projects`, { name: 'Dán PPF Garage A', services: [ppf.id] }, b));
    assert.deepEqual(ok(await s.call('GET', `/api/customers/${c.id}/record`, undefined, b)).needs.map((n) => n.name), ['Dán PPF']);
    assert.deepEqual(ok(await s.call('GET', `/api/customers/${c.id}/projects`, undefined, b)).find((p) => p.id === garageProject.id).services.map((n) => n.name), ['Dán PPF']);
    assert.equal((await s.call('PUT', `/api/task-projects/${garageProject.id}`, { services: ['sv_missing'] }, b)).status, 400);
    ok(await s.call('PUT', `/api/customers/${c.id}/record`, { needs: [] }, b));
    assert.deepEqual(ok(await s.call('GET', `/api/customers/${c.id}/record`, undefined, b)).needs.map((n) => n.name), ['Dán PPF'], 'a customer no longer sets its own');
    assert.ok(ok(await s.call('GET', `/api/admin/customers?need=${ppf.id}`, undefined, b)).items.some((x) => x.id === c.id));
    assert.ok(ok(await s.call('GET', '/api/admin/customers', undefined, ann.cookie)).items.some((x) => x.id === c.id), 'the staff member in charge reaches it');
    assert.equal((await s.call('GET', `/api/customers/${c.id}/record`, undefined, ann.cookie)).status, 200, 'and may open it on the Customers page');
    ok(await s.call('POST', `/api/admin/customers/${c.id}/archive`, { archived: true }, b));
    assert.ok(!ok(await s.call('GET', '/api/customers/directory', undefined, b)).some((x) => x.id === c.id));
    ok(await s.call('POST', `/api/admin/customers/${c.id}/archive`, { archived: false }, b));
    assert.ok(ok(await s.call('GET', '/api/customers/directory', undefined, b)).some((x) => x.id === c.id));

    // Drive: a link must be a Drive folder link; unlinking keeps the folder and does not bring it back as a new customer.
    assert.equal((await s.call('PUT', `/api/customers/${c.id}/folder`, { link: 'not a link' }, b)).status, 400);
    await mkdir(path.join(dir, 'workspace', 'Garage A folder'), { recursive: true });
    ok(await s.call('PUT', `/api/customers/${c.id}/folder`, { loc: { kind: 'fs', dir: path.join(dir, 'workspace', 'Garage A folder') } }, b));
    assert.equal(ok(await s.call('GET', `/api/customers/${c.id}/record`, undefined, b)).drive.label, 'Garage A folder');
    assert.equal(ok(await s.call('DELETE', `/api/customers/${c.id}/folder`, undefined, b)).drive, null);
    const listed = ok(await s.call('GET', '/api/customers', undefined, b));
    assert.ok(!listed.some((x) => x.name === 'Garage A folder'), 'the unlinked folder is not imported again');
    assert.equal((await s.call('DELETE', `/api/customers/${c.id}/folder`, undefined, cat.cookie)).status, 404, 'someone without the customer cannot unlink');

    // The customer's own tabs: its people see its tasks and history; others reach none of it.
    assert.equal((await s.call('GET', `/api/customers/${c.id}/history`, undefined, cat.cookie)).status, 404);
    assert.ok(ok(await s.call('GET', `/api/customers/${c.id}/history`, undefined, b)).some((h) => h.after?.folder === ''), 'unlinking shows in the history');
    const proj = ok(await s.call('POST', `/api/customers/${c.id}/projects`, { name: 'Video' }, b));
    ok(await s.call('POST', '/api/tasks', { title: 'Quay PPF', projectId: proj.id }, b));
    assert.deepEqual(ok(await s.call('GET', `/api/customers/${c.id}/tasks`, undefined, b)).map((t) => t.title), ['Quay PPF']);
    assert.deepEqual(ok(await s.call('GET', `/api/customers/${c.id}/tasks`, undefined, ann.cookie)), [], 'only the projects one may open');
    const listed2 = ok(await s.call('GET', '/api/customers/directory', undefined, b)).find((x) => x.id === c.id);
    assert.equal(listed2.status, 'lead'); assert.equal(listed2.category.name, 'VIP'); assert.equal(listed2.manager.name, 'ann');

    // Notifications reach only the scope: a manager may send to their department, not to everyone.
    const sent = ok(await s.call('POST', '/api/admin/notifications', { title: 'Họp phòng', body: '9h', link: '#tasks', audience: { type: 'departments', ids: [ann.department ? ann.department.id : (await s.call('GET', '/api/admin/departments', undefined, b)).data[0].id] } }, ann.cookie));
    assert.ok(sent.recipients >= 1);
    assert.equal((await s.call('POST', '/api/admin/notifications', { title: 'Tất cả', audience: { type: 'all' } }, ann.cookie)).status, 403);
    assert.equal((await s.call('POST', '/api/admin/notifications', { title: 'Cat', audience: { type: 'users', ids: [cat.id] } }, ann.cookie)).status, 403);
    assert.equal((await s.call('POST', '/api/admin/notifications', { title: 'Bad link', link: 'https://evil.test', audience: { type: 'all' } }, b)).status, 400);

    // Numbers come from the records; an export needs its own permission and is logged.
    const stats = ok(await s.call('GET', '/api/admin/stats?view=overview&period=month', undefined, b));
    assert.equal(stats.kpis.overdue, 1); assert.ok(stats.keys.length >= 12);
    assert.equal((await s.call('GET', '/api/admin/stats/export?view=performance', undefined, ann.cookie)).status, 200);
    assert.equal((await s.call('GET', '/api/admin/staff/export', undefined, ann.cookie)).status, 403);
    const csv = await s.call('GET', '/api/admin/customers/export', undefined, b);
    assert.match(csv.data, /Garage A/);
    assert.ok(ok(await s.call('GET', '/api/admin/logs?kind=action&q=CSV', undefined, b)).items.length >= 1);
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('quick notes belong to their writer alone, stay out of the logs; task tabs list given, made and followed work', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-admin-'));
  const s = await start(dir);
  try {
    const { b, people: { ann, bob } } = await company(s);
    const note = ok(await s.call('POST', '/api/quick-notes', { color: 'green' }, ann.cookie));
    ok(await s.call('PUT', `/api/quick-notes/${note.id}`, { body: '<div>Gọi khách</div><ul data-check=""><li>Gửi báo giá</li></ul>' }, ann.cookie));
    const mine = ok(await s.call('GET', '/api/quick-notes?q=gui', undefined, ann.cookie));
    assert.deepEqual(mine.map((n) => [n.title, n.color]), [['Gọi khách', 'green']]);
    // Nobody else reads, changes or deletes it, not even a Super Admin.
    for (const cookie of [bob.cookie, b]) {
      assert.deepEqual(ok(await s.call('GET', '/api/quick-notes', undefined, cookie)), []);
      assert.equal((await s.call('GET', `/api/quick-notes/${note.id}`, undefined, cookie)).status, 404);
      assert.equal((await s.call('PUT', `/api/quick-notes/${note.id}`, { body: 'x' }, cookie)).status, 404);
      assert.equal(ok(await s.call('POST', '/api/quick-notes/delete', { ids: [note.id] }, cookie)).deleted, 0);
    }
    assert.equal((await s.call('PUT', `/api/quick-notes/${note.id}`, { color: 'red' }, ann.cookie)).status, 400);
    // Dragged into an order, the list keeps it (new notes go first); someone else's ids change nothing.
    const two = ok(await s.call('POST', '/api/quick-notes', {}, ann.cookie)), three = ok(await s.call('POST', '/api/quick-notes', {}, ann.cookie));
    const bobs = ok(await s.call('POST', '/api/quick-notes', {}, bob.cookie));
    ok(await s.call('PUT', '/api/quick-notes/order', { ids: [note.id, three.id, two.id, bobs.id] }, ann.cookie));
    const order = async (cookie) => ok(await s.call('GET', '/api/quick-notes', undefined, cookie)).map((n) => n.id);
    assert.deepEqual(await order(ann.cookie), [note.id, three.id, two.id]);
    assert.deepEqual(await order(bob.cookie), [bobs.id]);
    const four = ok(await s.call('POST', '/api/quick-notes', {}, ann.cookie));
    assert.deepEqual(await order(ann.cookie), [four.id, note.id, three.id, two.id]);
    assert.equal((await s.call('PUT', '/api/quick-notes/order', { ids: 'x' }, ann.cookie)).status, 400);
    ok(await s.call('POST', '/api/quick-notes/delete', { ids: [two.id, three.id, four.id] }, ann.cookie));
    const logs = ok(await s.call('GET', '/api/admin/logs?kind=action&size=200', undefined, b)).items;
    assert.ok(!logs.some((l) => /quick-notes/.test(l.path || '')), 'quick notes never enter the logs');
    ok(await s.call('DELETE', `/api/quick-notes/${note.id}`, undefined, ann.cookie));

    // A formatted description is kept whole (never cut), too long is refused, and notifications read only its words.
    const rich = '<h1>Brief</h1><p><b>Gửi</b> <span style="color: #d62828">báo giá</span></p><ul><li>PPF</li></ul>';
    const rt = ok(await s.call('POST', '/api/tasks', { title: 'Rich', description: rich, assigneeUserIds: [ann.id] }, bob.cookie));
    assert.equal(ok(await s.call('GET', `/api/tasks/${rt.id}`, undefined, bob.cookie)).description, rich);
    assert.equal((await s.call('PUT', `/api/tasks/${rt.id}`, { description: '<p>' + 'x'.repeat(700 * 1024) + '</p>' }, bob.cookie)).status, 413);
    const told = ok(await s.call('GET', '/api/notifications/inbox', undefined, ann.cookie)).items.find((x) => x.taskId === rt.id);
    assert.equal(told?.detail?.text, 'Brief Gửi báo giá PPF', 'notification previews carry words, not markup');
    ok(await s.call('DELETE', `/api/tasks/${rt.id}`, undefined, bob.cookie));

    // "Giao cho tôi", "Tôi giao đi", "Đang theo dõi".
    const given = ok(await s.call('POST', '/api/tasks', { title: 'Given to ann', assigneeUserIds: [ann.id] }, bob.cookie));
    const made = ok(await s.call('POST', '/api/tasks', { title: 'Made by ann', assigneeUserIds: [bob.id] }, ann.cookie));
    const followed = ok(await s.call('POST', '/api/tasks', { title: 'Followed by ann', assigneeUserIds: [bob.id], followerUserIds: [ann.id] }, bob.cookie));
    const titles = async (rel) => ok(await s.call('GET', `/api/tasks?scope=mine&rel=${rel}`, undefined, ann.cookie)).tasks.map((t) => t.id);
    assert.deepEqual(await titles('assigned'), [given.id]);
    assert.deepEqual(await titles('created'), [made.id]);
    assert.deepEqual(await titles('following'), [followed.id]);
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});


test('customer statuses are configurable, retain old links and survive restart', async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-customer-status-'));
 let s=await start(dir);
 try {
  const boss=await s.call('POST','/api/auth/setup',{code:'admin-test',name:'Boss',email:'status@x.test',password:'password-123'});
  const cookie=boss.cookie;
  const defaults=ok(await s.call('GET','/api/customers/statuses',undefined,cookie));
  assert.deepEqual(defaults.map(x=>x.id),['lead','caring','active','paused','ended']);
  assert.equal((await s.call('POST','/api/admin/customer-statuses',{name:'Denied',color:'#112233'})).status,401);
  const staff=ok(await s.call('POST','/api/users',{name:'Staff',email:'staff-status@x.test',password:'password-123',role:'member'},cookie));
  const staffLogin=await s.call('POST','/api/auth/login',{email:staff.email,password:'password-123'});
  assert.equal((await s.call('POST','/api/admin/customer-statuses',{name:'Denied',color:'#112233'},staffLogin.cookie)).status,403);
  const customer=ok(await s.call('POST','/api/customers',{name:'Existing',status:'lead',databaseOnly:true},cookie));
  ok(await s.call('PUT','/api/admin/customer-statuses/lead',{name:'Khách mới',color:'#112233'},cookie));
  assert.equal(ok(await s.call('GET',`/api/customers/${customer.id}/record`,undefined,cookie)).status,'lead');
  const custom=ok(await s.call('POST','/api/admin/customer-statuses',{name:'Chờ ký hợp đồng',color:'#778899'},cookie));
  const ids=[custom.id,...defaults.map(x=>x.id)];
  ok(await s.call('POST','/api/admin/customer-statuses/order',{ids},cookie));
  assert.equal((await s.call('POST','/api/admin/customer-statuses/order',{ids:[custom.id,custom.id]},cookie)).status,400);
  assert.equal(ok(await s.call('GET','/api/customers/statuses',undefined,cookie))[0].id,custom.id);
  ok(await s.call('PUT',`/api/customers/${customer.id}/record`,{status:custom.id},cookie));
  assert.equal((await s.call('DELETE',`/api/admin/customer-statuses/${custom.id}`,undefined,cookie)).status,409);
  ok(await s.call('PUT',`/api/admin/customer-statuses/${custom.id}`,{active:false},cookie));
  ok(await s.call('PUT',`/api/customers/${customer.id}/record`,{name:'Edited existing'},cookie));
  assert.equal(ok(await s.call('GET',`/api/customers/${customer.id}/record`,undefined,cookie)).status,custom.id);
  assert.equal((await s.call('POST','/api/customers',{name:'Invalid new',databaseOnly:true,status:custom.id},cookie)).status,400);
  assert.equal((await s.call('POST','/api/admin/customers',{name:'Invalid admin new',status:custom.id},cookie)).status,400);
  ok(await s.call('PUT',`/api/customers/${customer.id}/record`,{status:null},cookie));
  ok(await s.call('DELETE',`/api/admin/customer-statuses/${custom.id}`,undefined,cookie));
  ok(await s.call('DELETE','/api/admin/customer-statuses/ended',undefined,cookie));
  await s.close();s=await start(dir);
  const restarted=ok(await s.call('GET','/api/customers/statuses',undefined,cookie));
  assert.equal(restarted.find(x=>x.id==='lead').name,'Khách mới');
  assert.equal(restarted.find(x=>x.id==='lead').color,'#112233');
  assert.ok(!restarted.some(x=>x.id==='ended'||x.id===custom.id),'deleted defaults must not reappear');
 } finally {await s.close();await rm(dir,{recursive:true,force:true});}
});

test('admin & global search handle #, brackets, hyphens, unaccented Vietnamese, tone placement, multi-tags and bulk delete', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-qa-search-'));
  const s = await start(dir);
  try {
    const { b, people: { ann } } = await company(s);
    const depts = ok(await s.call('GET', '/api/admin/departments', undefined, b));
    const deptId = ann.department?.id || depts[0].id;

    // 1. Import a task with #externalId and bracketed title [Paid Ads | AutoPro]
    const csv = 'Tên công việc\tDự án\tTrạng thái\tThời hạn\tMã công việc (ID)\n[Paid Ads | AutoPro] Tối ưu chiến dịch\t[Master] AutoPro - DFW\tChưa thực hiện\t01/01/2025 17:00\t11755918';
    ok(await s.call('POST', '/api/tasks/import', { text: csv, sourceName: 'export.tsv' }, b));

    const projId = ok(await s.call('GET', '/api/admin/tasks', undefined, b)).items[0].project.id;

    // Search with #11755918, [Paid Ads], and AutoPro - DFW in /api/admin/tasks and /api/tasks
    for (const query of ['#11755918', '[Paid Ads]', 'AutoPro - DFW', 'qua han', 'Quá hạn']) {
      const adminFound = ok(await s.call('GET', `/api/admin/tasks?q=${encodeURIComponent(query)}`, undefined, b));
      assert.equal(adminFound.items.length, 1, `admin tasks search should match "${query}"`);
      const wsFound = ok(await s.call('GET', `/api/tasks?scope=all&project=${projId}&q=${encodeURIComponent(query)}`, undefined, b));
      assert.equal(wsFound.tasks.length, 1, `workspace tasks search should match "${query}"`);
    }

    // Department filter on /api/admin/tasks matches project's department even if task has no assignees
    ok(await s.call('PUT', `/api/task-projects/${projId}/team`, { teamId: deptId }, b));
    assert.equal(ok(await s.call('GET', `/api/admin/tasks?dept=${encodeURIComponent(deptId)}`, undefined, b)).items.length, 1);

    // 2. Customer multi-tags, notes search, and bulk delete
    const cat1 = ok(await s.call('POST', '/api/admin/customer-categories', { name: 'Detailing', color: '#2563eb' }, b));
    const cat2 = ok(await s.call('POST', '/api/admin/customer-categories', { name: 'Ceramic', color: '#16a34a' }, b));
    const c1 = ok(await s.call('POST', '/api/customers', {
      name: 'AutoPro DFW',
      databaseOnly: true,
      status: 'active',
      tags: [{ id: cat1.id }, { id: cat2.id }],
      notes: 'Khách chỉ chạy dịch vụ mobile Roanoke',
    }, b));
    const c2 = ok(await s.call('POST', '/api/customers', { name: 'Summer Breeze', databaseOnly: true }, b));

    // Secondary tag cat2 is searchable and filterable in Admin Customers
    assert.equal(ok(await s.call('GET', `/api/admin/customers?category=${cat2.id}`, undefined, b)).items.length, 1);
    assert.equal(ok(await s.call('GET', `/api/admin/customers?q=${encodeURIComponent('Ceramic')}`, undefined, b)).items.length, 1);
    // Customer notes and status label are searchable in Admin Customers and Global Search
    assert.equal(ok(await s.call('GET', `/api/admin/customers?q=${encodeURIComponent('Roanoke')}`, undefined, b)).items.length, 1);
    assert.equal(ok(await s.call('GET', `/api/search?q=${encodeURIComponent('Roanoke')}&type=customers`, undefined, b)).customers.items.length, 1);

    // Bulk delete customers
    const delRes = ok(await s.call('POST', '/api/admin/customers/bulk-delete', { ids: [c1.id, c2.id] }, b));
    assert.equal(delRes.deleted, 2);

    // 3. Admin Logs search with unaccented Vietnamese and old-style tone placement ("xóa" vs "xoá", "khach hang")
    for (const logQuery of ['xóa', 'xoá', 'xoa', 'khach hang', 'AutoPro']) {
      const logHits = ok(await s.call('GET', `/api/admin/logs?kind=action&q=${encodeURIComponent(logQuery)}`, undefined, b));
      assert.ok(logHits.items.length >= 1, `admin logs search should match "${logQuery}"`);
    }

    // 4. Bulk delete task projects
    const p1 = ok(await s.call('POST', '/api/task-projects', { name: 'Proj Bulk 1' }, b));
    const p2 = ok(await s.call('POST', '/api/task-projects', { name: 'Proj Bulk 2' }, b));
    const pDel = ok(await s.call('POST', '/api/task-projects/bulk-delete', { ids: [p1.id, p2.id] }, b));
    assert.equal(pDel.deleted, 2);
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('developer support: users send message only, name/email auto-bound; admin lists and updates status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-admin-'));
  const s = await start(dir);
  try {
    const { b, people: { ann, bob } } = await company(s);

    // Unauthenticated request rejected
    assert.equal((await s.call('POST', '/api/support', { message: 'Help me' })).status, 401);

    // Empty message rejected
    assert.equal((await s.call('POST', '/api/support', { message: '   ' }, ann.cookie)).status, 400);

    // Ann sends a support message: sender only submits message
    const res = ok(await s.call('POST', '/api/support', { message: 'Tôi gặp sự cố khi tải file lên Drive' }, ann.cookie));
    assert.ok(res.ok && res.id);

    // Bob cannot view admin support tickets (Bob has no settings.view)
    assert.equal((await s.call('GET', '/api/admin/support', undefined, bob.cookie)).status, 403);

    // Admin lists support tickets: includes Ann's name and email automatically
    const list = ok(await s.call('GET', '/api/admin/support', undefined, b));
    assert.equal(list.items.length, 1);
    const item = list.items[0];
    assert.equal(item.id, res.id);
    assert.equal(item.userName, ann.name);
    assert.equal(item.userEmail, ann.email);
    assert.equal(item.message, 'Tôi gặp sự cố khi tải file lên Drive');
    assert.equal(item.status, 'pending');

    // Admin updates status to resolved
    ok(await s.call('PUT', `/api/admin/support/${res.id}`, { status: 'resolved' }, b));
    const resolvedList = ok(await s.call('GET', '/api/admin/support?status=resolved', undefined, b));
    assert.equal(resolvedList.items.length, 1);
    assert.equal(resolvedList.items[0].status, 'resolved');

    // Admin deletes the support ticket
    ok(await s.call('DELETE', `/api/admin/support/${res.id}`, undefined, b));
    const emptyList = ok(await s.call('GET', '/api/admin/support', undefined, b));
    assert.equal(emptyList.items.length, 0);
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('an id written encoded is checked like any other, and an uploaded file never runs as a page of the site', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-encoded-'));
  const s = await start(dir);
  try {
    const { b, people: { cat } } = await company(s);
    const customer = ok(await s.call('POST', '/api/customers', { name: 'Secret Client', notes: 'NDA' }, b));
    const project = ok(await s.call('POST', '/api/task-projects', { name: 'Secret project', customerId: customer.id }, b));
    const task = ok(await s.call('POST', '/api/tasks', { title: 'Launch plan', projectId: project.id, description: 'secret' }, b));
    // Someone with no right to them gets nothing, however the id is written (%63 is "c", %74 is "t").
    const encode = (id) => '%' + id.charCodeAt(0).toString(16) + id.slice(1);
    for (const url of [`/api/customers/${customer.id}`, `/api/customers/${encode(customer.id)}`, `/api/customers/${encode(customer.id)}/record`, `/api/tasks/${task.id}`, `/api/tasks/${encode(task.id)}`])
      assert.equal((await s.call('GET', url, undefined, cat.cookie)).status, 404, url);
    assert.equal((await s.call('PUT', `/api/customers/${encode(customer.id)}/record`, { name: 'Taken' }, cat.cookie)).status, 404);
    assert.equal((await s.call('PUT', `/api/tasks/${encode(task.id)}`, { title: 'Taken' }, cat.cookie)).status, 404);
    assert.equal(ok(await s.call('GET', `/api/customers/${customer.id}/record`, undefined, b)).name, 'Secret Client');
    // An HTML or SVG file put in a customer's folder is only downloaded; a picture still shows.
    const up = async (name, type, body) => { const r = await fetch(`${s.origin}/api/customers/${customer.id}/videos?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { cookie: b, 'content-type': type }, body }); assert.equal(r.status, 201, name); return (await r.json()).key; };
    const get = (key) => fetch(`${s.origin}/api/customers/${customer.id}/files/${encodeURIComponent(key)}`, { headers: { cookie: b } });
    for (const [name, type] of [['brief.html', 'text/html'], ['logo.svg', 'image/svg+xml']]) {
      const r = await get(await up(name, type, '<script>parent.stolen=1</script>'));
      assert.equal(r.status, 200, name);
      assert.match(r.headers.get('content-disposition') || '', /^attachment/, name);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    const png = await get(await up('cover.png', 'image/png', Buffer.from('89504e470d0a1a0a', 'hex')));
    assert.equal(png.headers.get('content-disposition'), null);
    assert.equal(png.headers.get('x-content-type-options'), 'nosniff');
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a database this code already upgraded starts without upgrading again; one from older code is upgraded', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-upgrade-'));
  try {
    await (await start(dir)).close();
    // The upgrade's repairs make every board private: a board left public shows whether they ran.
    const edit = (sql) => { const db = new DatabaseSync(path.join(dir, 'studio.db')); db.exec(sql); db.close(); };
    const isPrivate = () => { const db = new DatabaseSync(path.join(dir, 'studio.db'), { readOnly: true }); const r = db.prepare("SELECT private FROM boards WHERE id='b_open'").get(); db.close(); return r.private; };
    edit("INSERT INTO boards(id,name,bg,pos,created_at,updated_at,private) VALUES('b_open','Mở','#000',1,1,1,0)");
    await (await start(dir)).close();
    assert.equal(isPrivate(), 0);
    edit("DELETE FROM settings WHERE key='schema_version'");
    await (await start(dir)).close();
    assert.equal(isPrivate(), 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a forgotten password is set again from a one-time link; the answer never tells which emails have accounts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-reset-'));
  const s = await start(dir);
  try {
    const boss = await s.call('POST', '/api/auth/setup', { code: 'admin-test', name: 'Boss', email: 'boss@x.test', password: 'password-123' });
    // Known and unknown emails get the same answer; only the known one gets a link (no mail sender here, so none is sent).
    assert.deepEqual(ok(await s.call('POST', '/api/auth/forgot', { email: 'boss@x.test' })), { ok: true });
    assert.deepEqual(ok(await s.call('POST', '/api/auth/forgot', { email: 'nobody@x.test' })), { ok: true });
    const db = new DatabaseSync(path.join(dir, 'studio.db'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM password_resets').get().n, 1);
    // A link of our own (the mailed one's secret is never stored, only its hash).
    const token = 'a'.repeat(43), id = createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO password_resets(id,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(id, boss.data.user.id, Date.now() + 60e3, Date.now());
    db.close();
    assert.equal((await s.call('POST', '/api/auth/reset', { token: 'b'.repeat(43), password: 'new-password-1' })).status, 400);
    assert.equal((await s.call('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
    ok(await s.call('POST', '/api/auth/reset', { token, password: 'new-password-1' }), 'reset');
    // Once only; the old password and the old session no longer work; the new password does.
    assert.equal((await s.call('POST', '/api/auth/reset', { token, password: 'new-password-2' })).status, 400);
    assert.equal((await s.call('GET', '/api/auth/me', undefined, boss.cookie)).data.user, null);
    assert.equal((await s.call('POST', '/api/auth/login', { email: 'boss@x.test', password: 'password-123' })).status, 401);
    ok(await s.call('POST', '/api/auth/login', { email: 'boss@x.test', password: 'new-password-1' }), 'login with the new password');
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});

test('hosting shows what this database uses and has left; only a Super Admin runs SQL, writes need consent and every run is logged', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-sql-'));
  const s = await start(dir);
  try {
    const { b, people } = await company(s);
    const h = ok(await s.call('GET', '/api/admin/hosting', undefined, b));
    assert.equal(h.cloudflare.configured, false, 'no token here: the account is not asked');
    assert.equal(h.limits.databaseBytes, 500e6); assert.equal(h.limits.accountBytes, 5e9);
    assert.ok(h.database.bytes > 0 && h.database.tables > 10);

    assert.equal((await s.call('POST', '/api/admin/sql', { sql: 'SELECT 1' }, people.ann.cookie)).status, 403);
    const read = ok(await s.call('POST', '/api/admin/sql', { sql: "SELECT email, name FROM users WHERE email = 'boss@x.test'; -- a ; in a comment\nSELECT 'a;b' AS t, NULL AS z" }, b));
    assert.equal(read.results.length, 2);
    assert.deepEqual(read.results[0].columns, ['email', 'name']); assert.deepEqual(read.results[0].rows, [['boss@x.test', 'Boss']]);
    assert.deepEqual(read.results[1].rows, [['a;b', null]]);

    const refused = await s.call('POST', '/api/admin/sql', { sql: "SELECT 1; UPDATE users SET name = 'X' WHERE email = 'boss@x.test'" }, b);
    assert.equal(refused.status, 400); assert.match(refused.data.error, /Cho phép sửa dữ liệu/);
    assert.equal((await s.call('POST', '/api/admin/sql', { sql: "WITH x AS (SELECT 1) DELETE FROM quick_notes" }, b)).status, 400);
    assert.equal((await s.call('POST', '/api/admin/sql', { sql: "ATTACH DATABASE '/tmp/x.db' AS x", allowWrite: true }, b)).status, 400);
    assert.equal((await s.call('POST', '/api/admin/sql', { sql: "VACUUM INTO '/tmp/x.db'", allowWrite: true }, b)).status, 400);

    const write = ok(await s.call('POST', '/api/admin/sql', { sql: "CREATE TABLE scratch_t (a TEXT); CREATE TRIGGER scratch_tr AFTER INSERT ON scratch_t BEGIN UPDATE scratch_t SET a = upper(a); END; INSERT INTO scratch_t VALUES ('x'), ('y'); SELECT a FROM scratch_t ORDER BY a", allowWrite: true }, b));
    assert.equal(write.results.length, 4, 'the trigger body stays one statement');
    assert.equal(write.results[2].changes, 2); assert.deepEqual(write.results[3].rows, [['X'], ['Y']]);

    // A failing statement stops the rest; what ran before it is kept and shown.
    const failed = ok(await s.call('POST', '/api/admin/sql', { sql: 'SELECT COUNT(*) n FROM scratch_t; SELECT * FROM no_such_table; SELECT 2', allowWrite: true }, b));
    assert.equal(failed.results.length, 1); assert.equal(failed.error.index, 1); assert.match(failed.error.message, /no_such_table/);

    const logged = ok(await s.call('GET', '/api/admin/logs?kind=action&size=100', undefined, b)).items;
    assert.ok(logged.some((l) => l.action === 'Chạy SQL (sửa dữ liệu)' && /CREATE TABLE scratch_t/.test(l.entityLabel)));
    assert.ok(logged.some((l) => l.action === 'Chạy SQL' && /boss@x\.test/.test(l.entityLabel)));
  } finally { await s.close(); await rm(dir, { recursive: true, force: true }); }
});
