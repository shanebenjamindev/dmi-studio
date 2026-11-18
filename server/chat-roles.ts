// Cài đặt máy chủ of Tin nhắn, as on Discord: each server (the company's "DMI Studio", each brand workspace) has roles
// of its own, made by who manages Tin nhắn there, each with a colour (names in the chat take the highest one's), a place
// in the order and what it adds to the site's permissions there: Nhắn tin and Quản lý (server/chat-perms.ts). Channels
// pick roles in their rules, so a role can be the people of a private channel or those who write in a read-only one.
import type { Router, Req } from './http';
import { HttpError, json, readJson } from './http';
import { all, get, run, uid, now } from './db';
import { currentUser } from './auth';
import { accessOf } from './rbac';
import { changed } from './admin/common';
import { chatRights, needInServer, rolePerms, ROLE_PERMS } from './chat-perms';

const roleOut = (r: any, members = 0) => ({ id: r.id, name: r.name, color: r.color || '', position: r.position, perms: rolePerms(r.perms), members });
const color = (v: unknown) => (typeof v === 'string' && /^(#[0-9a-f]{6})?$/i.test(v) ? v : '');
const clean = (v: unknown) => (Array.isArray(v) ? ROLE_PERMS.filter((p) => v.includes(p)) : []);
/** The people of a server, for its member list. */
async function serverMembers(server: string) {
  const everyone = 'SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE';
  if (server === 'company') return all<any>(everyone);
  const w = await get<any>('SELECT owner_id, visibility FROM workspaces WHERE id = ?', server);
  if (!w) throw new HttpError(404, 'Không tìm thấy máy chủ');
  if (w.visibility === 'company') return all<any>(everyone);
  return all<any>(`SELECT id, name, email FROM users WHERE disabled = 0 AND (id = ? OR role = 'admin' OR id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?)) ORDER BY name COLLATE NOCASE`, w.owner_id, server);
}
/** Of these ids, the server's own roles, in the order given. */
async function ownRoles(ids: unknown[], server: string) {
  const mine = new Set((await all<any>("SELECT id FROM chat_roles WHERE server_id = ? AND id NOT LIKE '@%'", server)).map((r) => r.id));
  return [...new Set(ids.map(String))].filter((id) => mine.has(id));
}

export function registerChatRoles(api: Router) {
  const ctx = async (req: Req, manage = false) => {
    const u = (await currentUser(req))!, server = String(req.params.server || '');
    if (manage) await needInServer(u, server, 'manage');
    else if (!(await chatRights(u, server)).member) throw new HttpError(404, 'Không tìm thấy máy chủ');
    return { u, server };
  };
  const log = async (req: Req, u: any, action: string, id: string, label: string, before: any, after: any) =>
    changed({ user: u, access: await accessOf(u), scope: 'organization', req }, { action, type: 'settings', id: `chat-role:${id}`, label, before, after, kind: 'permission' });
  const mustRole = async (id: string, server: string) => {
    const r = await get<any>("SELECT * FROM chat_roles WHERE id = ? AND server_id = ? AND id NOT LIKE '@%'", id, server);
    if (!r) throw new HttpError(404, 'Không tìm thấy role');
    return r;
  };

  // The roles, highest first, and who holds which: anyone in the server sees them (names take their colour).
  api.get('/api/chat/servers/:server/roles', async (req, res) => {
    const { server } = await ctx(req);
    const rows = await all<any>("SELECT r.*, (SELECT COUNT(*) FROM chat_role_members m WHERE m.role_id = r.id) n FROM chat_roles r WHERE r.server_id = ? AND r.id NOT LIKE '@%' ORDER BY r.position DESC, r.created_at", server);
    const of: Record<string, string[]> = {};
    for (const h of await all<any>("SELECT m.role_id, m.user_id FROM chat_role_members m JOIN chat_roles r ON r.id = m.role_id WHERE r.server_id = ? AND r.id NOT LIKE '@%'", server)) (of[h.user_id] ||= []).push(h.role_id);
    json(res, 200, { roles: rows.map((r) => roleOut(r, Number(r.n) || 0)), members: of });
  });
  api.post('/api/chat/servers/:server/roles', async (req, res) => {
    const { u, server } = await ctx(req, true), b = await readJson(req);
    const name = String(b.name || '').trim().slice(0, 40) || 'Role mới';
    const top = Number((await get<any>('SELECT MAX(position) p FROM chat_roles WHERE server_id = ?', server))?.p) || 0;
    const id = uid('cr_');
    await run('INSERT INTO chat_roles(id, server_id, name, color, position, perms, created_at) VALUES(?,?,?,?,?,?,?)', id, server, name, color(b.color), top + 1, JSON.stringify(clean(b.perms)), now());
    await log(req, u, 'Tạo role chat', id, name, null, { name, perms: clean(b.perms) });
    json(res, 201, roleOut(await mustRole(id, server)));
  });
  // Its name, colour and permissions.
  api.put('/api/chat/servers/:server/roles/:id', async (req, res) => {
    const { u, server } = await ctx(req, true), r = await mustRole(req.params.id, server), b = await readJson(req);
    const next = {
      name: b.name !== undefined ? String(b.name).trim().slice(0, 40) || r.name : r.name,
      color: b.color !== undefined ? color(b.color) : r.color,
      perms: b.perms !== undefined ? clean(b.perms) : rolePerms(r.perms),
    };
    await run('UPDATE chat_roles SET name = ?, color = ?, perms = ? WHERE id = ?', next.name, next.color, JSON.stringify(next.perms), r.id);
    if (b.perms !== undefined || b.name !== undefined) await log(req, u, 'Sửa role chat', r.id, next.name, { name: r.name, perms: rolePerms(r.perms) }, { name: next.name, perms: next.perms });
    json(res, 200, roleOut(await mustRole(r.id, server)));
  });
  // The order of the roles, highest first.
  api.put('/api/chat/servers/:server/role-order', async (req, res) => {
    const { server } = await ctx(req, true), b = await readJson(req), ids = await ownRoles(Array.isArray(b.ids) ? b.ids : [], server);
    for (const [i, id] of ids.entries()) await run('UPDATE chat_roles SET position = ? WHERE id = ?', ids.length - i, id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/chat/servers/:server/roles/:id', async (req, res) => {
    const { u, server } = await ctx(req, true), r = await mustRole(req.params.id, server);
    await run('DELETE FROM chat_role_members WHERE role_id = ?', r.id);
    await run('DELETE FROM chat_roles WHERE id = ?', r.id);
    await log(req, u, 'Xoá role chat', r.id, r.name, { name: r.name, perms: rolePerms(r.perms) }, null);
    json(res, 200, { ok: true });
  });

  api.get('/api/chat/servers/:server/members', async (req, res) => {
    const { server } = await ctx(req);
    json(res, 200, await serverMembers(server));
  });
  // The roles one person holds in the server.
  api.put('/api/chat/servers/:server/members/:userId/roles', async (req, res) => {
    const { u, server } = await ctx(req, true), b = await readJson(req);
    const who = (await serverMembers(server)).find((m) => m.id === req.params.userId);
    if (!who) throw new HttpError(404, 'Người này không ở trong máy chủ');
    const want = await ownRoles(Array.isArray(b.roles) ? b.roles : [], server);
    const names = async (ids: string[]) => (ids.length ? (await all<any>('SELECT name FROM chat_roles WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(ids))).map((r) => r.name) : []);
    const had = (await all<any>("SELECT role_id FROM chat_role_members m JOIN chat_roles r ON r.id = m.role_id WHERE m.user_id = ? AND r.server_id = ?", who.id, server)).map((r) => r.role_id);
    await run("DELETE FROM chat_role_members WHERE user_id = ? AND role_id IN (SELECT id FROM chat_roles WHERE server_id = ?)", who.id, server);
    for (const id of want) await run('INSERT OR IGNORE INTO chat_role_members(role_id, user_id) VALUES(?,?)', id, who.id);
    await log(req, u, 'Gán role chat', who.id, who.name, { roles: await names(had) }, { roles: await names(want) });
    json(res, 200, { roles: want });
  });
}
