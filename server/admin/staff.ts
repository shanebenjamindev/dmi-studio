// Nhân viên: accounts with their profile (phone, avatar, direct manager), department, position, teams, roles, sign-ins
// and work; the department list with heads; teams. Each change needs its permission at a scope reaching the person, and
// a role ranked above theirs (server/rbac.ts); nobody changes their own department, roles or lock here.
import { all, get, run, uid, now } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { USER_SQL, hashPass, validPass, validEmail, normEmail, setNotifyEmail, notifyEmails, deptRoleOf, teamRoleOf, mustUser } from '../auth';
import { assertOutranks, activeSuperAdmins, ranks } from '../rbac';
import { historyOf } from '../audit';
import { stateOf } from '../tasks';
import { need, reach, reaches, inSet, text, color, page, sendCsv, csvDate, changed, logAction, matcher, type Ctx } from './common';

/** Each account's tasks (as an assignee), by what they mean now. */
export async function workByUser() {
  const out = new Map<string, { total: number; open: number; overdue: number; done: number; late: number }>();
  for (const t of await all<any>('SELECT DISTINCT p.user_id, t.id, t.status, t.due_at, t.done_at FROM task_assignees a JOIN task_people p ON p.id = a.person_id JOIN tasks t ON t.id = a.task_id WHERE p.user_id IS NOT NULL AND t.stub = 0')) {
    const w = out.get(t.user_id) || { total: 0, open: 0, overdue: 0, done: 0, late: 0 };
    const s = stateOf(t);
    w.total++;
    if (s === 'done') w.done++; else if (s === 'done_late') { w.done++; w.late++; } else if (s === 'overdue') { w.open++; w.overdue++; } else if (s !== 'cancelled') w.open++;
    out.set(t.user_id, w);
  }
  return out;
}

export async function staffRows(ids: Set<string> | null) {
  const [cond, args] = inSet('u.id', ids);
  const users = await all<any>(`SELECT u.id, u.email, u.name, u.role, u.disabled, u.last_login, u.created_at, u.updated_at, u.phone, u.avatar_at, u.manager_id, u.team_role, u.dept_role,
    d.name dept_name, d.color dept_color, p.name pos_name, p.level pos_level, m.name manager_name
    FROM users u LEFT JOIN team_roles d ON d.id = u.team_role LEFT JOIN dept_roles p ON p.id = u.dept_role AND p.team_role_id = u.team_role LEFT JOIN users m ON m.id = u.manager_id WHERE ${cond}`, ...args);
  const teams = new Map<string, any[]>(), roles = new Map<string, any[]>();
  for (const r of await all<any>('SELECT tm.user_id, tm.role, t.id, t.name, t.color FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.deleted_at IS NULL ORDER BY t.name')) teams.set(r.user_id, [...(teams.get(r.user_id) || []), { id: r.id, name: r.name, color: r.color, leader: r.role === 'leader' }]);
  for (const r of await all<any>('SELECT ur.user_id, ur.scope, r.id, r.key, r.name, r.rank FROM user_roles ur JOIN roles r ON r.id = ur.role_id ORDER BY r.rank DESC')) roles.set(r.user_id, [...(roles.get(r.user_id) || []), { id: r.id, key: r.key, name: r.name, rank: Number(r.rank), scope: r.scope || null }]);
  const work = await workByUser(), rank = await ranks();
  const sessions = new Map((await all<any>('SELECT user_id, COUNT(*) n FROM sessions WHERE expires_at > ? GROUP BY user_id', now())).map((r) => [r.user_id, Number(r.n)]));
  return users.map((u) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone || '', avatarAt: u.avatar_at || null, superAdmin: u.role === 'admin', disabled: !!u.disabled,
    lastLogin: u.last_login || null, createdAt: u.created_at, updatedAt: u.updated_at, sessions: sessions.get(u.id) || 0,
    department: u.team_role ? { id: u.team_role, name: u.dept_name || '', color: u.dept_color || '#64748b' } : null,
    position: u.dept_role && u.pos_name ? { id: u.dept_role, name: u.pos_name, level: u.pos_level } : null,
    manager: u.manager_id ? { id: u.manager_id, name: u.manager_name || '' } : null,
    teams: teams.get(u.id) || [], roles: roles.get(u.id) || [], rank: rank.get(u.id) || 0,
    work: work.get(u.id) || { total: 0, open: 0, overdue: 0, done: 0, late: 0 },
  }));
}
export type Staff = Awaited<ReturnType<typeof staffRows>>[number];
/** What the viewer may do to each person: manage (ranked above them, within the scope of staff.update) and lock
 *  (staff.delete); their own name, phone and picture they always edit. */
async function rightsFor(c: Ctx) {
  const update = await reaches(c, 'staff.update'), lock = await reaches(c, 'staff.delete');
  return (s: Staff) => {
    const above = s.id !== c.user.id && (c.access.superAdmin || s.rank < c.access.rank);
    return { canEdit: s.id === c.user.id && c.access.perms.has('staff.update') || (above && update(s.id)), canManage: above && update(s.id), canLock: above && lock(s.id) };
  };
}
const status = (s: Staff) => (s.disabled ? 'locked' : s.lastLogin ? 'active' : 'never');

async function mustReach(c: Ctx, id: string) {
  const ids = await reach(c);
  if (ids && !ids.has(id)) throw new HttpError(404, 'Không tìm thấy nhân viên trong phạm vi của bạn');
  const [s] = await staffRows(new Set([id]));
  if (!s) throw new HttpError(404, 'Không tìm thấy nhân viên');
  return s;
}
/** A direct manager: an account other than the person, and not one who reports to them (no loops). */
async function managerOf(id: string | null, v: unknown) {
  if (v === null || v === '' || v === undefined) return null;
  const m = String(v);
  if (m === id) throw new HttpError(400, 'Một người không thể là quản lý trực tiếp của chính mình');
  if (!(await get('SELECT 1 FROM users WHERE id = ?', m))) throw new HttpError(400, 'Không tìm thấy người quản lý');
  for (let at: string | null = m, n = 0; at && n < 100; n++) {
    if (at === id) throw new HttpError(400, 'Quản lý trực tiếp tạo thành vòng lặp');
    at = (await get<any>('SELECT manager_id FROM users WHERE id = ?', at))?.manager_id || null;
  }
  return m;
}
const phoneIn = (v: unknown) => { const p = text(v, 30, 'số điện thoại', false); if (p && !/^[+0-9 ().\-]{6,30}$/.test(p)) throw new HttpError(400, 'Số điện thoại không hợp lệ'); return p; };
/** Outside the whole organization, people go into (and stay in) the viewer's own department. */
function deptAllowed(c: Ctx, dept: string | null) {
  if (c.scope === 'organization') return;
  if (c.scope !== 'department' || !c.user.team_role || dept !== c.user.team_role) throw new HttpError(403, 'Phạm vi của bạn chỉ cho phép xếp nhân viên vào phòng ban của mình');
}
async function setTeams(userId: string, teamIds: unknown, by: string) {
  if (!Array.isArray(teamIds) || teamIds.length > 50 || teamIds.some((x) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách nhóm không hợp lệ');
  for (const t of teamIds) if (!(await get('SELECT 1 FROM teams WHERE id = ? AND deleted_at IS NULL', t))) throw new HttpError(400, 'Không tìm thấy nhóm');
  await run(`DELETE FROM team_members WHERE user_id = ? AND team_id NOT IN (SELECT value FROM json_each(?))`, userId, JSON.stringify(teamIds));
  for (const t of teamIds) await run('INSERT OR IGNORE INTO team_members(team_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?)', t, userId, 'member', by, now());
}
const snap = (s: Staff) => ({ name: s.name, email: s.email, phone: s.phone, department: s.department?.name || null, position: s.position?.name || null, manager: s.manager?.name || null, teams: s.teams.map((t) => t.name).join(', '), disabled: s.disabled });

export function registerStaff(api: Router) {
  api.get('/api/admin/staff', async (req, res) => {
    const c = await need(req, 'staff.view'), q = req.query, hit = matcher(q.get('q'));
    const rows = (await staffRows(await reach(c)))
      .filter((s) => hit(s.id, s.name, s.email, s.phone, s.department?.name, s.position?.name, s.manager?.name, s.teams.map((t) => t.name).join(' '), s.roles.map((r) => r.name).join(' ') || 'Member Thành viên'))
      .filter((s) => !q.get('dept') || (q.get('dept') === 'none' ? !s.department : s.department?.id === q.get('dept')))
      .filter((s) => !q.get('team') || s.teams.some((t) => t.id === q.get('team')))
      .filter((s) => !q.get('role') || (q.get('role') === 'member' ? !s.roles.length : s.roles.some((r) => r.id === q.get('role'))))
      .filter((s) => { const st = q.get('status') || 'all'; return st === 'all' || (st === 'locked' ? s.disabled : st === 'active' ? !s.disabled : status(s) === st); });
    const out = page(req, rows, { name: (s) => s.name, email: (s) => s.email, department: (s) => s.department?.name || null, lastLogin: (s) => s.lastLogin, createdAt: (s) => s.createdAt, open: (s) => s.work.open, overdue: (s) => s.work.overdue });
    const rights = await rightsFor(c);
    json(res, 200, { ...out, items: out.items.map((s) => ({ ...s, ...rights(s) })) });
  });
  api.get('/api/admin/staff/export', async (req, res) => {
    const c = await need(req, 'staff.export'), view = await need(req, 'staff.view');
    const ids = await reach(view), rows = (await staffRows(ids)).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    await logAction(c, 'Xuất danh sách nhân viên (CSV)', `${rows.length} người`, 'user');
    sendCsv(res, 'nhan-vien.csv', [['Họ tên', 'Email', 'Điện thoại', 'Phòng ban', 'Chức vụ', 'Quản lý trực tiếp', 'Nhóm', 'Vai trò', 'Trạng thái', 'Đăng nhập gần nhất', 'Ngày tạo', 'Việc đang làm', 'Quá hạn', 'Đã xong'],
      ...rows.map((s) => [s.name, s.email, s.phone, s.department?.name, s.position?.name, s.manager?.name, s.teams.map((t) => t.name).join('; '), s.roles.map((r) => r.name).join('; ') || 'Member',
        s.disabled ? 'Đã khoá' : 'Hoạt động', csvDate(s.lastLogin), csvDate(s.createdAt), s.work.open, s.work.overdue, s.work.done])]);
  });
  api.get('/api/admin/staff/:id', async (req, res) => {
    const c = await need(req, 'staff.view'), s = await mustReach(c, req.params.id);
    const logins = await all<any>('SELECT ok, method, reason, ip, agent, created_at FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', s.id);
    const sessions = await all<any>('SELECT created_at, expires_at, ip, agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20', s.id, now());
    const seesLogs = (await reaches(c, 'logs.view'))(s.id), seesTasks = (await reaches(c, 'tasks.view'))(s.id);
    const tasks = seesTasks ? (await all<any>(`SELECT DISTINCT t.id, t.title, t.status, t.due_at, t.done_at, j.name project FROM task_assignees a JOIN task_people p ON p.id = a.person_id JOIN tasks t ON t.id = a.task_id LEFT JOIN task_projects j ON j.id = t.project_id
      WHERE p.user_id = ? AND t.stub = 0 ORDER BY COALESCE(t.done_at, t.due_at, t.created_at) DESC LIMIT 15`, s.id)).map((t) => ({ id: t.id, title: t.title, status: t.status, state: stateOf(t), dueAt: t.due_at, doneAt: t.done_at, project: t.project })) : null;
    json(res, 200, {
      ...s, ...(await rightsFor(c))(s), notifyEmail: (await notifyEmails()).get(s.id) || null,
      logins: logins.map((l) => ({ ok: !!l.ok, method: l.method, reason: l.reason, ip: l.ip, agent: l.agent, at: l.created_at })),
      activeSessions: sessions.map((x) => ({ at: x.created_at, expiresAt: x.expires_at, ip: x.ip, agent: x.agent })),
      actions: seesLogs ? (await all<any>("SELECT action, entity_label, status, created_at FROM audit_logs WHERE user_id = ? AND kind = 'action' ORDER BY created_at DESC LIMIT 15", s.id)).map((a) => ({ action: a.action, label: a.entity_label, status: a.status, at: a.created_at })) : null,
      roleHistory: (await all<any>("SELECT action, user_name, old_data, new_data, created_at FROM audit_logs WHERE kind = 'permission' AND entity_type = 'user' AND entity_id = ? ORDER BY created_at DESC LIMIT 20", s.id))
        .map((a) => ({ action: a.action, by: a.user_name, before: a.old_data ? JSON.parse(a.old_data) : null, after: a.new_data ? JSON.parse(a.new_data) : null, at: a.created_at })),
      changes: (await historyOf('user', s.id, 20)).map((h) => ({ action: h.action, by: h.user_name, before: h.old_data ? JSON.parse(h.old_data) : null, after: h.new_data ? JSON.parse(h.new_data) : null, at: h.created_at })),
      tasks,
    });
  });
  api.post('/api/admin/staff', async (req, res) => {
    const c = await need(req, 'staff.create'), b = await readJson(req);
    if (c.scope === 'personal' || c.scope === 'team') throw new HttpError(403, 'Phạm vi của bạn không cho phép thêm nhân viên');
    const email = validEmail(normEmail(b.email));
    if (await get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    const name = text(b.name, 120, 'họ tên'), phone = phoneIn(b.phone), team = await teamRoleOf(b.departmentId);
    deptAllowed(c, team);
    const id = uid('u_'), pass = b.password ? await hashPass(validPass(b.password)) : null;
    await run('INSERT INTO users(id, email, name, role, pass, team_role, dept_role, phone, manager_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id, email, name, 'member', pass, team, await deptRoleOf(team, b.positionId), phone || null, await managerOf(id, b.managerId), now(), now());
    if (b.teamIds !== undefined && (b.teamIds as unknown[]).length) { await need(req, 'org.update'); await setTeams(id, b.teamIds, c.user.id); }
    await setNotifyEmail(id, b.notifyEmail || undefined);
    const [s] = await staffRows(new Set([id]));
    await changed(c, { action: 'Thêm nhân viên', type: 'user', id, label: name, after: snap(s) });
    json(res, 201, s);
  });
  api.put('/api/admin/staff/:id', async (req, res) => {
    const c = await need(req, 'staff.update'), s = await mustReach(c, req.params.id), b = await readJson(req), self = s.id === c.user.id;
    // Everyone edits their own name, phone and email here; the rest only for people ranked below them.
    const structural = ['departmentId', 'positionId', 'managerId', 'teamIds', 'password', 'notifyEmail'].filter((k) => b[k] !== undefined);
    if (!self || structural.length) await assertOutranks(c.access, s.id, 'nhân viên này');
    let email = s.email;
    if (b.email !== undefined && normEmail(b.email) !== s.email) {
      email = validEmail(normEmail(b.email));
      if (await get('SELECT id FROM users WHERE email = ? AND id <> ?', email, s.id)) throw new HttpError(409, 'Email này đã có tài khoản');
    }
    const team = b.departmentId !== undefined ? await teamRoleOf(b.departmentId) : s.department?.id || null;
    if (team !== (s.department?.id || null)) deptAllowed(c, team);
    const position = b.positionId !== undefined || team !== (s.department?.id || null) ? await deptRoleOf(team, b.positionId) : s.position?.id || null;
    await run('UPDATE users SET name = ?, email = ?, phone = ?, team_role = ?, dept_role = ?, manager_id = ?, updated_at = ? WHERE id = ?',
      b.name !== undefined ? text(b.name, 120, 'họ tên') : s.name, email, b.phone !== undefined ? phoneIn(b.phone) || null : s.phone || null, team, position,
      b.managerId !== undefined ? await managerOf(s.id, b.managerId) : s.manager?.id || null, now(), s.id);
    if (b.teamIds !== undefined) { await need(req, 'org.update'); await setTeams(s.id, b.teamIds, c.user.id); }
    if (b.password) { await run('UPDATE users SET pass = ? WHERE id = ?', await hashPass(validPass(b.password)), s.id); await run('DELETE FROM sessions WHERE user_id = ?', s.id); }
    if (b.notifyEmail !== undefined) await setNotifyEmail(s.id, b.notifyEmail);
    const [after] = await staffRows(new Set([s.id]));
    await changed(c, { action: 'Sửa hồ sơ nhân viên', type: 'user', id: s.id, label: after.name, before: { ...snap(s), ...(b.password ? { password: '(ẩn)' } : {}) }, after: { ...snap(after), ...(b.password ? { password: '(đã đổi)' } : {}) } });
    json(res, 200, { ...after, ...(await rightsFor(c))(after) });
  });
  // Locking signs the person out everywhere; the last active Super Admin stays.
  api.post('/api/admin/staff/:id/lock', async (req, res) => {
    const c = await need(req, 'staff.delete'), s = await mustReach(c, req.params.id), b = await readJson(req), lock = !!b.locked;
    await assertOutranks(c.access, s.id, 'nhân viên này');
    if (lock && s.superAdmin && !s.disabled && await activeSuperAdmins() <= 1) throw new HttpError(400, 'Cần giữ ít nhất một Super Admin đang hoạt động');
    await run('UPDATE users SET disabled = ?, updated_at = ? WHERE id = ?', lock ? 1 : 0, now(), s.id);
    if (lock) await run('DELETE FROM sessions WHERE user_id = ?', s.id);
    await changed(c, { action: lock ? 'Khoá tài khoản' : 'Mở khoá tài khoản', type: 'user', id: s.id, label: s.name, before: { disabled: s.disabled }, after: { disabled: lock } });
    json(res, 200, { ok: true });
  });
  api.post('/api/admin/staff/:id/signout', async (req, res) => {
    const c = await need(req, 'staff.delete'), s = await mustReach(c, req.params.id);
    await assertOutranks(c.access, s.id, 'nhân viên này');
    const n = (await run('DELETE FROM sessions WHERE user_id = ?', s.id)).changes;
    await changed(c, { action: 'Đăng xuất mọi thiết bị', type: 'user', id: s.id, label: s.name, before: { sessions: s.sessions }, after: { sessions: 0 } });
    json(res, 200, { ended: n });
  });
  // A small picture (PNG, JPEG, WebP or GIF, up to 300 KB) kept in the database: there is no disk on the cloud.
  api.put('/api/admin/staff/:id/avatar', async (req, res) => {
    const c = await need(req, 'staff.update'), s = await mustReach(c, req.params.id);
    if (s.id !== c.user.id) await assertOutranks(c.access, s.id, 'nhân viên này');
    const m = String((await readJson(req)).dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, 'Ảnh đại diện phải là PNG, JPEG, WebP hoặc GIF');
    if (Buffer.from(m[2], 'base64').length > 300 * 1024) throw new HttpError(413, 'Ảnh đại diện tối đa 300 KB');
    await run('INSERT INTO user_avatars(user_id, mime, data, updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at', s.id, m[1], m[2], now());
    await run('UPDATE users SET avatar_at = ? WHERE id = ?', now(), s.id);
    await changed(c, { action: 'Đổi ảnh đại diện', type: 'user', id: s.id, label: s.name, before: { avatar: s.avatarAt ? '(ảnh cũ)' : null }, after: { avatar: '(ảnh mới)' } });
    json(res, 200, { avatarAt: now() });
  });
  api.delete('/api/admin/staff/:id/avatar', async (req, res) => {
    const c = await need(req, 'staff.update'), s = await mustReach(c, req.params.id);
    if (s.id !== c.user.id) await assertOutranks(c.access, s.id, 'nhân viên này');
    await run('DELETE FROM user_avatars WHERE user_id = ?', s.id);
    await run('UPDATE users SET avatar_at = NULL WHERE id = ?', s.id);
    await changed(c, { action: 'Xoá ảnh đại diện', type: 'user', id: s.id, label: s.name, before: { avatar: '(ảnh cũ)' }, after: { avatar: null } });
    json(res, 200, { ok: true });
  });
  // Anyone signed in sees a colleague's picture.
  api.get('/api/avatars/:id', async (req, res) => {
    const a = await get<any>('SELECT mime, data FROM user_avatars WHERE user_id = ?', req.params.id);
    if (!a) throw new HttpError(404, 'Chưa có ảnh đại diện');
    const body = Buffer.from(a.data, 'base64');
    res.writeHead(200, { 'content-type': a.mime, 'content-length': body.length, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
    res.end(body);
  });

  // ---------------------------------------------------------------- departments (their changes: /api/roles, auth.ts)
  api.get('/api/admin/departments', async (req, res) => {
    await need(req, 'org.view');
    const people = await all<any>('SELECT u.id, u.name, u.team_role, u.disabled, d.level FROM users u LEFT JOIN dept_roles d ON d.id = u.dept_role AND d.team_role_id = u.team_role WHERE u.team_role IS NOT NULL');
    const teams = await all<any>('SELECT department_id, COUNT(*) n FROM teams WHERE deleted_at IS NULL AND department_id IS NOT NULL GROUP BY department_id');
    const boards = await all<any>('SELECT role_id, COUNT(*) n FROM boards WHERE role_id IS NOT NULL GROUP BY role_id');
    json(res, 200, (await all<any>('SELECT * FROM team_roles ORDER BY pos')).map((d) => {
      const mine = people.filter((p) => p.team_role === d.id);
      return { id: d.id, name: d.name, color: d.color, pages: JSON.parse(d.pages || '[]'), createdAt: d.created_at, members: mine.length, active: mine.filter((p) => !p.disabled).length,
        heads: mine.filter((p) => p.level === 'admin').map((p) => ({ id: p.id, name: p.name })), teams: Number(teams.find((t) => t.department_id === d.id)?.n || 0), boards: Number(boards.find((b) => b.role_id === d.id)?.n || 0) };
    }));
  });

  // ---------------------------------------------------------------- teams
  const teamOut = async (t: any) => ({
    id: t.id, name: t.name, about: t.about, color: t.color, departmentId: t.department_id || null, createdAt: t.created_at, updatedAt: t.updated_at,
    members: (await all<any>('SELECT u.id, u.name, u.email, u.disabled, m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role = ? DESC, u.name', t.id, 'leader'))
      .map((m) => ({ id: m.id, name: m.name, email: m.email, disabled: !!m.disabled, leader: m.role === 'leader' })),
  });
  const mustTeam = async (id: string) => { const t = await get<any>('SELECT * FROM teams WHERE id = ? AND deleted_at IS NULL', id); if (!t) throw new HttpError(404, 'Không tìm thấy nhóm'); return t; };
  const teamFields = async (b: any, old?: any) => ({
    name: b.name !== undefined ? text(b.name, 80, 'tên nhóm') : old.name, about: b.about !== undefined ? text(b.about, 500, 'mô tả', false) : old?.about || '',
    color: b.color !== undefined ? color(b.color) : old?.color || '#64748b', department: b.departmentId !== undefined ? await teamRoleOf(b.departmentId) : old?.department_id || null,
  });
  api.get('/api/admin/teams', async (req, res) => {
    await need(req, 'org.view');
    json(res, 200, await Promise.all((await all<any>('SELECT * FROM teams WHERE deleted_at IS NULL ORDER BY name')).map(teamOut)));
  });
  api.post('/api/admin/teams', async (req, res) => {
    const c = await need(req, 'org.create'), f = await teamFields(await readJson(req)), id = uid('tm_');
    await run('INSERT INTO teams(id, name, about, color, department_id, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', id, f.name, f.about, f.color, f.department, c.user.id, now(), now());
    await changed(c, { action: 'Thêm nhóm', type: 'team', id, label: f.name, after: f });
    json(res, 201, await teamOut(await mustTeam(id)));
  });
  api.put('/api/admin/teams/:id', async (req, res) => {
    const c = await need(req, 'org.update'), t = await mustTeam(req.params.id), f = await teamFields(await readJson(req), t);
    await run('UPDATE teams SET name = ?, about = ?, color = ?, department_id = ?, updated_at = ? WHERE id = ?', f.name, f.about, f.color, f.department, now(), t.id);
    await changed(c, { action: 'Sửa nhóm', type: 'team', id: t.id, label: f.name, before: { name: t.name, about: t.about, color: t.color, department: t.department_id }, after: f });
    json(res, 200, await teamOut(await mustTeam(t.id)));
  });
  // Kept with its history (deleted_at); its people simply stop being a team.
  api.delete('/api/admin/teams/:id', async (req, res) => {
    const c = await need(req, 'org.delete'), t = await mustTeam(req.params.id);
    await run('UPDATE teams SET deleted_at = ?, updated_at = ? WHERE id = ?', now(), now(), t.id);
    await changed(c, { action: 'Xoá nhóm', type: 'team', id: t.id, label: t.name, before: { name: t.name } });
    json(res, 200, { ok: true });
  });
  api.put('/api/admin/teams/:id/members', async (req, res) => {
    const c = await need(req, 'org.update'), t = await mustTeam(req.params.id), b = await readJson(req);
    const ids = b.userIds, leaders = new Set<string>(Array.isArray(b.leaderIds) ? b.leaderIds.filter((x: unknown) => typeof x === 'string') : []);
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((x: unknown) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách thành viên không hợp lệ');
    for (const id of ids) await mustUser(id);
    const before = (await teamOut(t)).members;
    await run('DELETE FROM team_members WHERE team_id = ? AND user_id NOT IN (SELECT value FROM json_each(?))', t.id, JSON.stringify(ids));
    for (const id of ids) await run('INSERT INTO team_members(team_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role', t.id, id, leaders.has(id) ? 'leader' : 'member', c.user.id, now());
    const after = (await teamOut(t)).members;
    const names = (m: typeof before) => m.map((x) => x.name + (x.leader ? ' (trưởng nhóm)' : '')).join(', ');
    await changed(c, { action: 'Đổi thành viên nhóm', type: 'team', id: t.id, label: t.name, before: { members: names(before) }, after: { members: names(after) } });
    json(res, 200, await teamOut(t));
  });
}
