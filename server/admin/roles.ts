// Phân quyền: roles (the built-in five and any made here), what each may do at which scope, and who holds which.
// Nobody raises their own power: people change only roles ranked below their own and the roles of people ranked below
// them, never their own; they give a role no permission (nor wider scope) they do not hold; the last Super Admin stays.
// Every change is logged as 'permission' in Nhật ký hệ thống.
import { all, get, run, uid, now } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { assertOutranks, activeSuperAdmins, scopeIn, syncSuperAdmin, SUPER_ROLE_ID } from '../rbac';
import { ADMIN_RANK, MEMBER, PERM_GROUPS, SUPER_ADMIN, isPerm, scopedPerm, scopeRank, SCOPE_LABEL, type Scope } from '../../shared/permissions';
import { need, reach, text, page, changed, matcher, type Ctx } from './common';
import { staffRows } from './staff';

const roleOut = async (r: any, c: Ctx) => {
  const perms = Object.fromEntries((await all<any>('SELECT perm, scope FROM role_permissions WHERE role_id = ?', r.id)).filter((p) => isPerm(p.perm)).map((p) => [p.perm, p.scope]));
  const holders = Number((await get<any>('SELECT COUNT(*) n FROM user_roles WHERE role_id = ?', r.id))?.n || 0);
  const below = c.access.superAdmin || Number(r.rank) < c.access.rank;
  return {
    id: r.id, key: r.key || null, name: r.name, about: r.about, rank: Number(r.rank), system: !!r.system, createdAt: r.created_at, updatedAt: r.updated_at,
    perms: r.key === SUPER_ADMIN ? 'all' : perms, holders: r.key === MEMBER ? Number((await get<any>('SELECT COUNT(*) n FROM users WHERE disabled = 0'))?.n || 0) : holders,
    canEdit: r.key !== SUPER_ADMIN && below && c.access.perms.has('rbac.manage'), canAssign: r.key !== MEMBER && below && c.access.perms.has('rbac.manage'),
    canDelete: !r.system && below && c.access.perms.has('rbac.manage'),
  };
};
const mustRole = async (id: string) => { const r = await get<any>('SELECT * FROM roles WHERE id = ?', id); if (!r) throw new HttpError(404, 'Không tìm thấy vai trò'); return r; };
const permText = (perms: Record<string, string> | 'all') => (perms === 'all' ? 'Tất cả' : Object.entries(perms).map(([p, s]) => `${p}${scopedPerm(p) ? ` (${SCOPE_LABEL[s as Scope]})` : ''}`).sort().join(', '));
/** A role's permissions from a request: known ones only, each at a scope; nothing beyond what the editor holds. */
function permsIn(c: Ctx, v: unknown): Record<string, Scope> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Danh sách quyền không hợp lệ');
  const out: Record<string, Scope> = {};
  for (const [p, s] of Object.entries(v as Record<string, unknown>)) {
    if (!isPerm(p)) throw new HttpError(400, `Không có quyền “${p}”`);
    const scope: Scope = scopedPerm(p) ? scopeIn(s) || 'personal' : 'organization';
    const mine = c.access.perms.get(p);
    if (!c.access.superAdmin && (!mine || scopeRank(scope) > scopeRank(mine))) throw new HttpError(403, `Bạn không thể cấp quyền ${p}${mine ? ' ở phạm vi rộng hơn của mình' : ' mà chính bạn chưa có'}`);
    out[p] = scope;
  }
  return out;
}
function rankIn(c: Ctx, v: unknown) {
  const n = Math.round(Number(v));
  const max = c.access.superAdmin ? 99 : c.access.rank - 1;
  if (!Number.isFinite(n) || n < 1 || n > max) throw new HttpError(400, `Cấp của vai trò phải từ 1 đến ${max} (thấp hơn cấp của bạn)`);
  return n;
}
async function savePerms(roleId: string, perms: Record<string, Scope>) {
  await run('DELETE FROM role_permissions WHERE role_id = ?', roleId);
  for (const [p, s] of Object.entries(perms)) await run('INSERT INTO role_permissions(role_id, perm, scope) VALUES(?,?,?)', roleId, p, s);
}
const heldText = (rs: { name: string; scope: string | null }[]) => rs.map((r) => r.name + (r.scope ? ` (${SCOPE_LABEL[r.scope as Scope]})` : '')).join(', ') || 'Member';

export function registerRoles(api: Router) {
  api.get('/api/admin/permissions', async (req, res) => {
    await need(req, 'rbac.view');
    const held = await all<any>('SELECT rp.perm, rp.scope, r.name FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ORDER BY r.rank DESC');
    json(res, 200, PERM_GROUPS.map((g) => ({ ...g, perms: Object.entries(g.actions).map(([action, about]) => {
      const key = `${g.key}.${action}`;
      return { key, action, about, roles: ['Super Admin', ...held.filter((h) => h.perm === key).map((h) => h.name + (g.scoped ? ` · ${SCOPE_LABEL[h.scope as Scope]}` : ''))] };
    }) })));
  });
  api.get('/api/admin/roles', async (req, res) => {
    const c = await need(req, 'rbac.view');
    json(res, 200, await Promise.all((await all<any>('SELECT * FROM roles ORDER BY rank DESC, name')).map((r) => roleOut(r, c))));
  });
  api.post('/api/admin/roles', async (req, res) => {
    const c = await need(req, 'rbac.manage'), b = await readJson(req);
    const name = text(b.name, 60, 'tên vai trò');
    if (await get('SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE', name)) throw new HttpError(409, `Đã có vai trò “${name}”`);
    const id = uid('role_'), rank = rankIn(c, b.rank ?? 30), perms = permsIn(c, b.perms ?? {});
    await run('INSERT INTO roles(id, key, name, about, rank, system, created_by, updated_by, created_at, updated_at) VALUES(?,NULL,?,?,?,0,?,?,?,?)', id, name, text(b.about, 500, 'mô tả', false), rank, c.user.id, c.user.id, now(), now());
    await savePerms(id, perms);
    await changed(c, { kind: 'permission', action: 'Tạo vai trò', type: 'role', id, label: name, after: { rank, perms: permText(perms) } });
    json(res, 201, await roleOut(await mustRole(id), c));
  });
  api.put('/api/admin/roles/:id', async (req, res) => {
    const c = await need(req, 'rbac.manage'), r = await mustRole(req.params.id), b = await readJson(req);
    if (r.key === SUPER_ADMIN) throw new HttpError(403, 'Super Admin luôn có mọi quyền và không sửa được');
    if (!c.access.superAdmin && Number(r.rank) >= c.access.rank) throw new HttpError(403, 'Bạn chỉ sửa được vai trò thấp hơn vai trò của mình');
    const name = b.name !== undefined ? text(b.name, 60, 'tên vai trò') : r.name;
    if (name !== r.name && await get('SELECT 1 FROM roles WHERE name = ? COLLATE NOCASE AND id <> ?', name, r.id)) throw new HttpError(409, `Đã có vai trò “${name}”`);
    // The built-in roles keep their place in the order.
    const rank = b.rank !== undefined && !r.system ? rankIn(c, b.rank) : Number(r.rank);
    const before = await roleOut(r, c);
    await run('UPDATE roles SET name = ?, about = ?, rank = ?, updated_by = ?, updated_at = ? WHERE id = ?', name, b.about !== undefined ? text(b.about, 500, 'mô tả', false) : r.about, rank, c.user.id, now(), r.id);
    if (b.perms !== undefined) await savePerms(r.id, permsIn(c, b.perms));
    const after = await roleOut(await mustRole(r.id), c);
    await changed(c, { kind: 'permission', action: 'Sửa vai trò', type: 'role', id: r.id, label: name, before: { name: before.name, rank: before.rank, perms: permText(before.perms) }, after: { name: after.name, rank: after.rank, perms: permText(after.perms) } });
    json(res, 200, after);
  });
  api.delete('/api/admin/roles/:id', async (req, res) => {
    const c = await need(req, 'rbac.manage'), r = await mustRole(req.params.id);
    if (r.system) throw new HttpError(400, 'Vai trò mặc định không xoá được');
    if (!c.access.superAdmin && Number(r.rank) >= c.access.rank) throw new HttpError(403, 'Bạn chỉ xoá được vai trò thấp hơn vai trò của mình');
    const holders = await all<any>('SELECT u.name FROM user_roles ur JOIN users u ON u.id = ur.user_id WHERE ur.role_id = ?', r.id);
    await run('DELETE FROM roles WHERE id = ?', r.id);
    await changed(c, { kind: 'permission', action: 'Xoá vai trò', type: 'role', id: r.id, label: r.name, before: { holders: holders.map((h) => h.name).join(', ') || '(không ai)' }, after: null });
    json(res, 200, { ok: true, removedFrom: holders.length });
  });

  // ---------------------------------------------------------------- who holds which roles
  const assignments = async (c: Ctx) => {
    const rows = await staffRows(await reach(c));
    return rows.map((s) => ({ ...s, canAssign: c.access.perms.has('rbac.manage') && s.id !== c.user.id && (c.access.superAdmin || s.rank < c.access.rank) }));
  };
  api.get('/api/admin/assignments', async (req, res) => {
    const c = await need(req, 'rbac.view'), q = req.query, hit = matcher(q.get('q'));
    const rows = (await assignments(c))
      .filter((s) => hit(s.id, s.name, s.email, s.phone, s.department?.name, s.position?.name, s.roles.map((r) => r.name).join(' ') || 'Member Thành viên'))
      .filter((s) => !q.get('role') || (q.get('role') === 'member' ? !s.roles.length : s.roles.some((r) => r.id === q.get('role'))))
      .filter((s) => !q.get('dept') || s.department?.id === q.get('dept'))
      .filter((s) => q.get('admins') !== '1' || s.rank >= ADMIN_RANK);
    json(res, 200, page(req, rows, { rank: (s) => -s.rank, name: (s) => s.name, lastLogin: (s) => s.lastLogin }));
  });
  // Tài khoản Admin: people holding a role ranked as high as Admin, with when and by whom it was given.
  api.get('/api/admin/admins', async (req, res) => {
    const c = await need(req, 'rbac.view');
    const granted = new Map((await all<any>('SELECT ur.user_id, ur.role_id, ur.created_at, g.name by_name FROM user_roles ur LEFT JOIN users g ON g.id = ur.granted_by')).map((g) => [`${g.user_id}|${g.role_id}`, g]));
    json(res, 200, (await assignments(c)).filter((s) => s.rank >= ADMIN_RANK).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name, 'vi'))
      .map((s) => ({ ...s, roles: s.roles.map((r) => ({ ...r, grantedAt: granted.get(`${s.id}|${r.id}`)?.created_at || null, grantedBy: granted.get(`${s.id}|${r.id}`)?.by_name || null })) })));
  });
  // The whole set of someone's roles at once ([] = Member only), each optionally capped to a scope.
  api.put('/api/admin/staff/:id/roles', async (req, res) => {
    const c = await need(req, 'rbac.manage'), b = await readJson(req), id = req.params.id;
    const target = await get<any>('SELECT id, name, role, disabled FROM users WHERE id = ?', id);
    if (!target) throw new HttpError(404, 'Không tìm thấy nhân viên');
    const ids = await reach(c);
    if (ids && !ids.has(id)) throw new HttpError(404, 'Không tìm thấy nhân viên trong phạm vi của bạn');
    await assertOutranks(c.access, id, 'vai trò của người này');
    if (!Array.isArray(b.roles) || b.roles.length > 20) throw new HttpError(400, 'Danh sách vai trò không hợp lệ');
    const want = new Map<string, Scope | null>();
    for (const x of b.roles) {
      const r = await mustRole(String(x?.roleId || ''));
      if (r.key === MEMBER) continue;
      want.set(r.id, x.scope ? scopeIn(x.scope) || (() => { throw new HttpError(400, 'Phạm vi không hợp lệ'); })() : null);
    }
    const before = await all<any>('SELECT ur.role_id, ur.scope, r.name, r.rank, r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?', id);
    const touched = [...[...want.keys()].filter((r) => !before.some((x) => x.role_id === r && (x.scope || null) === want.get(r))), ...before.filter((x) => !want.has(x.role_id)).map((x) => x.role_id)];
    for (const rid of new Set(touched)) {
      const r = await mustRole(rid);
      if (!c.access.superAdmin && Number(r.rank) >= c.access.rank) throw new HttpError(403, `Bạn không thể cấp hoặc thu hồi vai trò ${r.name} (ngang hoặc cao hơn vai trò của bạn)`);
    }
    const wasSuper = target.role === 'admin' || before.some((x) => x.key === SUPER_ADMIN), isSuper = want.has(SUPER_ROLE_ID);
    if (wasSuper && !isSuper && !target.disabled && await activeSuperAdmins() <= 1) throw new HttpError(400, 'Không thể thu hồi quyền của Super Admin cuối cùng');
    await run('DELETE FROM user_roles WHERE user_id = ? AND role_id NOT IN (SELECT value FROM json_each(?))', id, JSON.stringify([...want.keys()]));
    for (const [rid, scope] of want) await run('INSERT INTO user_roles(user_id, role_id, scope, granted_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id, role_id) DO UPDATE SET scope = excluded.scope', id, rid, scope, c.user.id, now());
    if (wasSuper !== isSuper) await syncSuperAdmin(id, isSuper, c.user.id);
    const after = await all<any>('SELECT ur.scope, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? ORDER BY r.rank DESC', id);
    await changed(c, { kind: 'permission', action: !before.length && after.length ? 'Cấp vai trò' : before.length && !after.length ? 'Thu hồi vai trò' : 'Đổi vai trò', type: 'user', id, label: target.name,
      before: { roles: heldText(before) }, after: { roles: heldText(after) } });
    const [s] = await staffRows(new Set([id]));
    json(res, 200, s);
  });
}
