// Who may do what in Tin nhắn, by the site's own permissions (Quản trị › Phân quyền › Tin nhắn):
//  • messages.create, "Nhắn tin": writing in channels and to people (messages and files). Member has it, so everyone
//    chats unless an admin takes it from Member and gives it to some roles only;
//  • messages.manage, "Quản lý": creating and deleting channels, pinning and deleting other people's messages and files,
//    clearing a channel, and Quản trị › Tin nhắn (who is blocked from writing).
// People blocked there keep reading but cannot write. Reading follows the channel: the company's are everyone's, a brand
// workspace's are its people's, whose owner and admins also manage them. Direct messages are their two people's.
import type { Router } from './http';
import { HttpError, json, readJson } from './http';
import { all, get, getSetting, setSetting } from './db';
import { currentUser, type User } from './auth';
import { accessOf } from './rbac';
import { need, changed } from './admin/common';

export type ChatAct = 'view' | 'send' | 'manage';
const MUTED = 'chat_muted';
const muted = async () => new Set(await getSetting<string[]>(MUTED, []));

/** The server a channel belongs to: a workspace's built-in channels are "ws_<workspace>_<name>", a made one says it. */
export async function serverOfChannel(channel: string) {
  const custom = await get<any>('SELECT server_id FROM chat_channels WHERE id = ?', channel);
  if (custom) return String(custom.server_id || 'company');
  return /^ws_(.+)_[^_]+$/.exec(channel)?.[1] || 'company';
}
/** What this person may do in a server ('company' or a workspace id); direct messages ask the company's. */
export async function chatRights(u: User, server = 'company') {
  const site = (await accessOf(u)).perms;
  const send = site.has('messages.create') && !(await muted()).has(u.id), manage = site.has('messages.manage');
  if (server === 'company') return { member: true, send, manage };
  const w = await get<any>('SELECT owner_id, visibility FROM workspaces WHERE id = ?', server);
  const mine = w && await get<any>('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', server, u.id);
  const admin = !!w && (u.role === 'admin' || w.owner_id === u.id || mine?.role === 'admin');
  const member = admin || !!mine || w?.visibility === 'company';
  return { member, send: member && send, manage: member && (admin || manage) };
}
const REFUSED: Record<Exclude<ChatAct, 'view'>, string> = { send: 'Bạn không được phép nhắn tin', manage: 'Bạn không có quyền quản lý tin nhắn ở đây' };
export async function needInServer(u: User, server: string, act: ChatAct) {
  const r = await chatRights(u, server);
  if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
  if (act !== 'view' && !r[act]) throw new HttpError(403, REFUSED[act]);
}
/** Stops the request unless this person may `act` in a channel (a channel id). */
export const needInChannel = async (u: User, channel: string, act: ChatAct) => needInServer(u, await serverOfChannel(channel), act);
/** Writing to someone directly: the same "Nhắn tin" permission. */
export const needToSend = (u: User) => needInServer(u, 'company', 'send');

export function registerChatPerms(api: Router) {
  // What the page offers: who may not write gets a closed message box, who may not manage no channel buttons.
  api.get('/api/chat/servers/:server/access', async (req, res) => {
    const r = await chatRights((await currentUser(req))!, req.params.server === 'dm' ? 'company' : req.params.server);
    if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
    json(res, 200, { send: r.send, manage: r.manage });
  });

  // Quản trị › Tin nhắn: which roles may write and manage (set in Phân quyền), and who is blocked from writing.
  api.get('/api/admin/chat', async (req, res) => {
    await need(req, 'messages.manage');
    const roles = await all<any>(`SELECT r.id, r.name, r.rank, r.key,
        EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.perm = 'messages.create') send,
        EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.perm = 'messages.manage') manage,
        (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) people
      FROM roles r ORDER BY r.rank DESC, r.name`);
    const blocked = await muted();
    const people = await all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE');
    json(res, 200, {
      // Super Admin holds every permission whatever its rows say.
      roles: roles.map((r) => ({ id: r.id, name: r.name, member: r.key === 'member', send: r.key === 'super_admin' || !!r.send, manage: r.key === 'super_admin' || !!r.manage, people: Number(r.people) || 0 })),
      people: people.map((p) => ({ ...p, blocked: blocked.has(p.id) })),
    });
  });
  api.put('/api/admin/chat/blocked', async (req, res) => {
    const c = await need(req, 'messages.manage'), b = await readJson(req);
    const valid = new Set((await all<any>('SELECT id FROM users')).map((r) => r.id));
    // Nobody blocks themselves.
    const next: string[] = Array.isArray(b.userIds) ? [...new Set<string>(b.userIds.map(String))].filter((id) => valid.has(id) && id !== c.user.id) : [];
    const before = [...await muted()];
    await setSetting(MUTED, next.length ? next : null);
    const names = async (ids: string[]) => (ids.length ? (await all<any>('SELECT name FROM users WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name', JSON.stringify(ids))).map((r) => r.name) : []);
    await changed(c, { action: 'Đổi danh sách chặn nhắn tin', type: 'settings', id: MUTED, label: 'Tin nhắn', before: { blocked: await names(before) }, after: { blocked: await names(next) } });
    json(res, 200, { blocked: next });
  });
}
