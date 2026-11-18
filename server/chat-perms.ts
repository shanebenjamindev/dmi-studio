// Roles and permissions of Tin nhắn, as on Discord. Each server (the company's "DMI Studio", and each brand workspace)
// has its own roles: @everyone (everyone in the server) and the roles its managers make, each with a colour, a place in
// the order and a set of permissions. A channel may allow or deny some of them per role on top (a private channel:
// View denied to @everyone, allowed to a role). Direct messages are not part of any server: always its two people.
//
// Who is in a server: everyone for the company's; for a workspace, its people (everyone if the company may view it).
// Its owners hold every permission whatever the roles: company admins, and a workspace's owner and admins.
import type { Router, Req } from './http';
import { HttpError, json, readJson } from './http';
import { all, get, run, uid, now } from './db';
import { currentUser, type User } from './auth';

export const PERMS = ['view', 'send', 'attach', 'manage_messages', 'manage_channels', 'manage_roles', 'admin'] as const;
export type Perm = (typeof PERMS)[number];
const EVERYONE_DEFAULT: Perm[] = ['view', 'send', 'attach'];
const ALL = new Set<Perm>(PERMS);
const NAME: Record<Perm, string> = {
  view: 'xem kênh này', send: 'gửi tin nhắn ở đây', attach: 'gửi file ở đây', manage_messages: 'quản lý tin nhắn',
  manage_channels: 'quản lý kênh', manage_roles: 'quản lý role và quyền', admin: 'quản trị máy chủ',
};
const clean = (v: unknown): Perm[] => (Array.isArray(v) ? [...new Set(v.filter((p): p is Perm => ALL.has(p as Perm)))] : []);
const parse = (s: string | null | undefined): Perm[] => { try { return clean(JSON.parse(s || '[]')); } catch { return []; } };

/** The server a channel belongs to: a workspace's built-in channels are "ws_<workspace>_<name>", a made one says it. */
export async function serverOfChannel(channel: string) {
  const custom = await get<any>('SELECT server_id FROM chat_channels WHERE id = ?', channel);
  if (custom) return String(custom.server_id || 'company');
  return /^ws_(.+)_[^_]+$/.exec(channel)?.[1] || 'company';
}
async function standing(u: User, server: string) {
  if (server === 'company') return { member: true, owner: u.role === 'admin' };
  const w = await get<any>('SELECT owner_id, visibility FROM workspaces WHERE id = ?', server);
  if (!w) return { member: false, owner: false };
  const mine = await get<any>('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', server, u.id);
  const owner = u.role === 'admin' || w.owner_id === u.id || mine?.role === 'admin';
  return { member: owner || !!mine || w.visibility === 'company', owner };
}
const everyoneId = (server: string) => `@${server}`;
/** @everyone of a server, made with its default permissions the first time it is needed. */
async function everyone(server: string) {
  const id = everyoneId(server);
  await run('INSERT OR IGNORE INTO chat_roles(id, server_id, name, color, position, perms, created_at) VALUES(?,?,?,?,?,?,?)', id, server, '@everyone', '', 0, JSON.stringify(EVERYONE_DEFAULT), now());
  return (await get<any>('SELECT * FROM chat_roles WHERE id = ?', id))!;
}

/** What this person may do in a server, or in one of its channels. */
export async function permsIn(u: User, server: string, channel?: string): Promise<Set<Perm>> {
  const s = await standing(u, server);
  if (!s.member) return new Set();
  if (s.owner) return new Set(ALL);
  const base = await everyone(server);
  const roles = [base, ...await all<any>('SELECT r.* FROM chat_roles r JOIN chat_role_members m ON m.role_id = r.id WHERE r.server_id = ? AND m.user_id = ?', server, u.id)];
  const have = new Set<Perm>(roles.flatMap((r) => parse(r.perms)));
  if (have.has('admin')) return new Set(ALL);
  if (channel) {
    const over = await all<any>(`SELECT role_id, allow, deny FROM chat_channel_perms WHERE channel_id = ? AND role_id IN (SELECT value FROM json_each(?))`, channel, JSON.stringify(roles.map((r) => r.id)));
    // As Discord: @everyone's override first, then the person's roles together (an allow of one wins over a deny of another).
    const e = over.find((o) => o.role_id === base.id);
    if (e) { parse(e.deny).forEach((p) => have.delete(p)); parse(e.allow).forEach((p) => have.add(p)); }
    const rest = over.filter((o) => o.role_id !== base.id);
    rest.flatMap((o) => parse(o.deny)).forEach((p) => have.delete(p));
    rest.flatMap((o) => parse(o.allow)).forEach((p) => have.add(p));
  }
  // Nothing else of a channel works without seeing it.
  if (channel && !have.has('view')) return new Set();
  return have;
}
/** Stops the request unless this person may do `perm` in `channel` (a channel id; direct messages are never asked). */
export async function needInChannel(u: User, channel: string, perm: Perm) {
  if (!(await permsIn(u, await serverOfChannel(channel), channel)).has(perm)) throw new HttpError(403, `Bạn không có quyền ${NAME[perm]}`);
}
export async function needInServer(u: User, server: string, perm: Perm) {
  if (!(await permsIn(u, server)).has(perm)) throw new HttpError(403, `Bạn không có quyền ${NAME[perm]}`);
}

const roleOut = (r: any, members = 0) => ({ id: r.id, name: r.name, color: r.color || '', position: r.position, perms: parse(r.perms), everyone: r.id.startsWith('@'), members });
/** The people of a server (for its member list and role picker). */
async function serverMembers(server: string) {
  if (server === 'company') return all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE');
  const w = await get<any>('SELECT owner_id, visibility FROM workspaces WHERE id = ?', server);
  if (!w) throw new HttpError(404, 'Không tìm thấy máy chủ');
  if (w.visibility === 'company') return all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE');
  return all<any>(`SELECT id, name, email FROM users WHERE disabled = 0 AND (id = ? OR role = 'admin' OR id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ?)) ORDER BY name COLLATE NOCASE`, w.owner_id, server);
}
const color = (v: unknown) => (typeof v === 'string' && /^(#[0-9a-f]{6})?$/i.test(v) ? v : '');

export function registerChatPerms(api: Router) {
  const ctx = async (req: Req) => {
    const u = (await currentUser(req))!, server = String(req.params.server || '');
    if (!(await standing(u, server)).member) throw new HttpError(404, 'Không tìm thấy máy chủ');
    return { u, server };
  };

  // What the person may do in the server and in each channel asked about (the page hides and greys what they may not).
  api.get('/api/chat/servers/:server/access', async (req, res) => {
    const { u, server } = await ctx(req), s = await standing(u, server);
    const channels: Record<string, Perm[]> = {};
    for (const id of String(req.query.get('channels') || '').split(',').filter(Boolean).slice(0, 100)) channels[id] = [...await permsIn(u, server, id)];
    json(res, 200, { owner: s.owner, perms: [...await permsIn(u, server)], channels });
  });

  // The roles (highest first, @everyone last) and who has which: anyone in the server sees them, for names' colours.
  api.get('/api/chat/servers/:server/roles', async (req, res) => {
    const { server } = await ctx(req);
    await everyone(server);
    const rows = await all<any>('SELECT r.*, (SELECT COUNT(*) FROM chat_role_members m WHERE m.role_id = r.id) n FROM chat_roles r WHERE r.server_id = ? ORDER BY CASE WHEN r.id LIKE \'@%\' THEN 1 ELSE 0 END, r.position DESC, r.created_at', server);
    const holders = await all<any>('SELECT m.role_id, m.user_id FROM chat_role_members m JOIN chat_roles r ON r.id = m.role_id WHERE r.server_id = ?', server);
    const of: Record<string, string[]> = {};
    for (const h of holders) (of[h.user_id] ||= []).push(h.role_id);
    json(res, 200, { roles: rows.map((r) => roleOut(r, Number(r.n) || 0)), members: of });
  });
  api.post('/api/chat/servers/:server/roles', async (req, res) => {
    const { u, server } = await ctx(req);
    await needInServer(u, server, 'manage_roles');
    const b = await readJson(req), name = String(b.name || '').trim().slice(0, 40) || 'Role mới';
    const top = Number((await get<any>('SELECT MAX(position) p FROM chat_roles WHERE server_id = ?', server))?.p) || 0;
    const id = uid('cr_');
    // A new role adds nothing until permissions are ticked: @everyone already gives the usual ones.
    await run('INSERT INTO chat_roles(id, server_id, name, color, position, perms, created_at) VALUES(?,?,?,?,?,?,?)', id, server, name, color(b.color), top + 1, '[]', now());
    json(res, 201, roleOut(await get<any>('SELECT * FROM chat_roles WHERE id = ?', id)));
  });
  api.put('/api/chat/servers/:server/roles/:id', async (req, res) => {
    const { u, server } = await ctx(req);
    await needInServer(u, server, 'manage_roles');
    const r = await get<any>('SELECT * FROM chat_roles WHERE id = ? AND server_id = ?', req.params.id, server);
    if (!r) throw new HttpError(404, 'Không tìm thấy role');
    const b = await readJson(req), mine = await permsIn(u, server);
    if (b.perms !== undefined) {
      const next = clean(b.perms);
      // Only someone who administers the server gives Quản trị viên.
      if (next.includes('admin') && !parse(r.perms).includes('admin') && !mine.has('admin')) throw new HttpError(403, 'Chỉ quản trị máy chủ mới cấp được quyền Quản trị viên');
      await run('UPDATE chat_roles SET perms = ? WHERE id = ?', JSON.stringify(next), r.id);
    }
    if (!r.id.startsWith('@')) {
      if (b.name !== undefined) await run('UPDATE chat_roles SET name = ? WHERE id = ?', String(b.name).trim().slice(0, 40) || r.name, r.id);
      if (b.color !== undefined) await run('UPDATE chat_roles SET color = ? WHERE id = ?', color(b.color), r.id);
    }
    json(res, 200, roleOut(await get<any>('SELECT * FROM chat_roles WHERE id = ?', r.id)));
  });
  // The order of the roles, highest first (@everyone always last).
  api.put('/api/chat/servers/:server/role-order', async (req, res) => {
    const { u, server } = await ctx(req);
    await needInServer(u, server, 'manage_roles');
    const b = await readJson(req), ordered = await ownRoles(Array.isArray(b.ids) ? b.ids : [], server);
    for (let i = 0; i < ordered.length; i++) await run('UPDATE chat_roles SET position = ? WHERE id = ?', ordered.length - i, ordered[i]);
    json(res, 200, { ok: true });
  });
  api.delete('/api/chat/servers/:server/roles/:id', async (req, res) => {
    const { u, server } = await ctx(req);
    await needInServer(u, server, 'manage_roles');
    const r = await get<any>('SELECT id FROM chat_roles WHERE id = ? AND server_id = ?', req.params.id, server);
    if (!r || r.id.startsWith('@')) throw new HttpError(400, 'Không xoá được role này');
    await run('DELETE FROM chat_role_members WHERE role_id = ?', r.id);
    await run('DELETE FROM chat_channel_perms WHERE role_id = ?', r.id);
    await run('DELETE FROM chat_roles WHERE id = ?', r.id);
    json(res, 200, { ok: true });
  });

  api.get('/api/chat/servers/:server/members', async (req, res) => {
    const { server } = await ctx(req);
    json(res, 200, await serverMembers(server));
  });
  api.put('/api/chat/servers/:server/members/:userId/roles', async (req, res) => {
    const { u, server } = await ctx(req);
    await needInServer(u, server, 'manage_roles');
    if (!(await serverMembers(server)).some((m) => m.id === req.params.userId)) throw new HttpError(404, 'Người này không ở trong máy chủ');
    const b = await readJson(req), want = await ownRoles(Array.isArray(b.roles) ? b.roles : [], server);
    // Quản trị viên is given only by someone who administers the server.
    if (!(await permsIn(u, server)).has('admin')) {
      const admins = new Set((await all<any>('SELECT id, perms FROM chat_roles WHERE server_id = ?', server)).filter((r) => parse(r.perms).includes('admin')).map((r) => r.id));
      const had = new Set((await all<any>('SELECT role_id FROM chat_role_members WHERE user_id = ?', req.params.userId)).map((r) => r.role_id));
      if (want.some((id) => admins.has(id) && !had.has(id))) throw new HttpError(403, 'Chỉ quản trị máy chủ mới gán được role có quyền Quản trị viên');
    }
    await run("DELETE FROM chat_role_members WHERE user_id = ? AND role_id IN (SELECT id FROM chat_roles WHERE server_id = ? AND id NOT LIKE '@%')", req.params.userId, server);
    for (const id of want) await run('INSERT OR IGNORE INTO chat_role_members(role_id, user_id) VALUES(?,?)', id, req.params.userId);
    json(res, 200, { roles: want });
  });

  api.get('/api/chat/channels/:channel/perms', async (req, res) => {
    const u = (await currentUser(req))!, server = await serverOfChannel(req.params.channel);
    await needInServer(u, server, 'manage_roles');
    const rows = await all<any>('SELECT role_id, allow, deny FROM chat_channel_perms WHERE channel_id = ?', req.params.channel);
    json(res, 200, rows.map((r) => ({ roleId: r.role_id, allow: parse(r.allow), deny: parse(r.deny) })));
  });
  // One role's allow and deny on a channel (both empty: back to the server's roles).
  api.put('/api/chat/channels/:channel/perms/:roleId', async (req, res) => {
    const u = (await currentUser(req))!, server = await serverOfChannel(req.params.channel);
    await needInServer(u, server, 'manage_roles');
    if (!(await get('SELECT 1 FROM chat_roles WHERE id = ? AND server_id = ?', req.params.roleId, server)) && req.params.roleId !== everyoneId(server)) throw new HttpError(404, 'Không tìm thấy role');
    if (req.params.roleId === everyoneId(server)) await everyone(server);
    const b = await readJson(req), allow = clean(b.allow).filter((p) => p !== 'admin'), deny = clean(b.deny).filter((p) => p !== 'admin' && !allow.includes(p));
    if (!allow.length && !deny.length) await run('DELETE FROM chat_channel_perms WHERE channel_id = ? AND role_id = ?', req.params.channel, req.params.roleId);
    else await run('INSERT INTO chat_channel_perms(channel_id, role_id, allow, deny) VALUES(?,?,?,?) ON CONFLICT(channel_id, role_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny', req.params.channel, req.params.roleId, JSON.stringify(allow), JSON.stringify(deny));
    json(res, 200, { roleId: req.params.roleId, allow, deny });
  });
}
/** The ids given that are roles of this server (not @everyone), in the order given. */
async function ownRoles(ids: unknown[], server: string) {
  const mine = new Set((await all<any>("SELECT id FROM chat_roles WHERE server_id = ? AND id NOT LIKE '@%'", server)).map((r) => r.id));
  return [...new Set(ids.map(String))].filter((id) => mine.has(id));
}
