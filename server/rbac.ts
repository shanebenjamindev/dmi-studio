// Who may do what in the admin module: a person's roles (user_roles) give permissions (role_permissions) at a scope,
// capped by the scope the role was granted with; Member's apply to everyone. Super Admin is every permission, everywhere,
// and is the same thing as the company admin of the other pages (users.role = 'admin'): the two are kept in step here.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { ALL_PERMS, DEFAULT_ROLES, MEMBER, SCOPES, SUPER_ADMIN, scopedPerm, scopeRank, type Perm, type Scope } from '../shared/permissions';

export const MEMBER_RANK = DEFAULT_ROLES.find((r) => r.key === MEMBER)!.rank;
export const SUPER_RANK = DEFAULT_ROLES.find((r) => r.key === SUPER_ADMIN)!.rank;
export const SUPER_ROLE_ID = 'role_' + SUPER_ADMIN;
export interface Access { userId: string; superAdmin: boolean; rank: number; perms: Map<Perm, Scope> }

const narrower = (a: Scope, b: Scope | null | undefined) => (b && scopeRank(b) < scopeRank(a) ? b : a);
export const scopeIn = (x: unknown): Scope | null => (SCOPES.includes(x as Scope) ? (x as Scope) : null);

/** Everything this account may do in the admin module, and its rank (the highest of its roles). */
export async function accessOf(u: { id: string; role: string }): Promise<Access> {
  const held = await all<any>('SELECT r.id, r.key, r.rank, ur.scope FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?', u.id);
  const rank = Math.max(MEMBER_RANK, ...held.map((r) => Number(r.rank)));
  if (u.role === 'admin' || held.some((r) => r.key === SUPER_ADMIN)) return { userId: u.id, superAdmin: true, rank: Math.max(rank, SUPER_RANK), perms: new Map(ALL_PERMS.map((p) => [p, 'organization'])) };
  const member = await get<any>('SELECT id FROM roles WHERE key = ?', MEMBER);
  const caps = new Map<string, Scope | null>(held.map((r) => [r.id, scopeIn(r.scope)]));
  if (member && !caps.has(member.id)) caps.set(member.id, null);
  const perms = new Map<Perm, Scope>();
  if (caps.size) {
    for (const p of await all<any>('SELECT role_id, perm, scope FROM role_permissions WHERE role_id IN (SELECT value FROM json_each(?))', JSON.stringify([...caps.keys()]))) {
      if (!ALL_PERMS.includes(p.perm)) continue;
      const scope = scopedPerm(p.perm) ? narrower(scopeIn(p.scope) || 'personal', caps.get(p.role_id)) : 'organization';
      if (scopeRank(scope) > scopeRank(perms.get(p.perm))) perms.set(p.perm, scope);
    }
  }
  return { userId: u.id, superAdmin: false, rank, perms };
}

/** The scope this account holds a permission at; throws 403 without it. */
export function scopeFor(a: Access, perm: Perm): Scope {
  const scope = a.perms.get(perm);
  if (!scope) throw new HttpError(403, 'Bạn chưa được cấp quyền thực hiện thao tác này');
  return scope;
}

/** The accounts a scope reaches for this person, themselves included (null: everyone). A wider scope reaches at least
 *  what a narrower one does, so a department scope also covers the person's teams. */
export async function scopeUsers(userId: string, scope: Scope): Promise<Set<string> | null> {
  if (scope === 'organization') return null;
  const ids = new Set([userId]);
  if (scope === 'team' || scope === 'department') {
    for (const r of await all<any>('SELECT DISTINCT m2.user_id FROM team_members m1 JOIN teams t ON t.id = m1.team_id AND t.deleted_at IS NULL JOIN team_members m2 ON m2.team_id = m1.team_id WHERE m1.user_id = ?', userId)) ids.add(r.user_id);
  }
  if (scope === 'department') {
    const dept = (await get<any>('SELECT team_role FROM users WHERE id = ?', userId))?.team_role;
    if (dept) for (const r of await all<any>('SELECT id FROM users WHERE team_role = ?', dept)) ids.add(r.id);
  }
  return ids;
}
/** A condition keeping `column` within an id set (null: no restriction). One JSON parameter, as D1 binds at most 100. */
export const inSet = (column: string, ids: Set<string> | Iterable<string> | null): [string, string[]] =>
  ids === null ? ['1=1', []] : [`${column} IN (SELECT value FROM json_each(?))`, [JSON.stringify([...ids])]];

/** Each account's rank: the highest of its roles (Member when it has none; Super Admin for company admins). */
export async function ranks(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const u of await all<any>('SELECT id, role FROM users')) out.set(u.id, u.role === 'admin' ? SUPER_RANK : MEMBER_RANK);
  for (const r of await all<any>('SELECT ur.user_id, MAX(r.rank) rank FROM user_roles ur JOIN roles r ON r.id = ur.role_id GROUP BY ur.user_id')) out.set(r.user_id, Math.max(out.get(r.user_id) || 0, Number(r.rank)));
  return out;
}
export const rankOfUser = async (id: string) => (await ranks()).get(id) ?? MEMBER_RANK;

/** May `a` manage this account (edit, lock, change its roles)? Only one ranked below them; a Super Admin also manages
 *  other Super Admins. Nobody manages themselves here: their own profile is edited in Hồ sơ của tôi. */
export async function assertOutranks(a: Access, targetId: string, what = 'tài khoản này') {
  if (targetId === a.userId) throw new HttpError(403, 'Bạn không thể tự thay đổi quyền hoặc trạng thái của chính mình');
  const rank = await rankOfUser(targetId);
  if (!(a.superAdmin || rank < a.rank)) throw new HttpError(403, `Bạn chỉ quản lý được ${what} khi vai trò của họ thấp hơn vai trò của bạn`);
}

export const activeSuperAdmins = async () => Number((await get<any>(`SELECT COUNT(DISTINCT u.id) n FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.role_id = ? WHERE u.disabled = 0 AND (u.role = 'admin' OR ur.role_id IS NOT NULL)`, SUPER_ROLE_ID))?.n || 0);

/** Super Admin and the company admin flag move together, whichever side is changed (Quản trị's user form or the roles). */
export async function syncSuperAdmin(userId: string, admin: boolean, by: string | null) {
  if (admin) await run('INSERT OR IGNORE INTO user_roles(user_id, role_id, granted_by, created_at) VALUES(?,?,?,?)', userId, SUPER_ROLE_ID, by, now());
  else await run('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?', userId, SUPER_ROLE_ID);
  await run("UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND role <> ?", admin ? 'admin' : 'member', now(), userId, admin ? 'admin' : 'member');
}

/** For the interface: what the signed-in account may open in the admin module. */
export const accessOut = (a: Access) => ({ superAdmin: a.superAdmin, rank: a.rank, perms: Object.fromEntries(a.perms) as Record<Perm, Scope> });
