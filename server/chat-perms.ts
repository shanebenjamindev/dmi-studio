// Who may do what in Tin nhắn, by the site's own permissions (Quản trị › Phân quyền › Tin nhắn):
//  • messages.create, "Nhắn tin": writing in channels and to people (messages and files). Member has it, so everyone
//    chats unless an admin takes it from Member and gives it to some roles only;
//  • messages.manage, "Quản lý": creating and deleting channels, pinning and deleting other people's messages and files,
//    clearing a channel, and Quản trị › Tin nhắn (who is blocked from writing).
// People blocked there keep reading but cannot write. Reading follows the channel: the company's are everyone's, a brand
// workspace's are its people's, whose owner and admins also manage them. Direct messages are their two people's.
// On top, each channel may say who sees it (a private channel) and who writes in it (the others only read), as people,
// departments and roles of the site; those who manage Tin nhắn always see and write, and are the ones who set it.
import type { Router } from './http';
import { HttpError, json, readJson } from './http';
import { all, get, run, now, getSetting, setSetting } from './db';
import { currentUser, type User } from './auth';
import { accessOf } from './rbac';
import { need, changed } from './admin/common';
import { MEMBER } from '../shared/permissions';

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

// ---------------------------------------------------------------- a channel's own rules
/** Who: people ("u:<id>"), departments ("d:<id>") and roles ("r:<id>"). `all`: everyone (then `who` is unused). */
export interface Rule { view: { all: boolean; who: string[] }; send: { all: boolean; who: string[] } }
const OPEN: Rule = { view: { all: true, who: [] }, send: { all: true, who: [] } };
async function ruleOf(channel: string): Promise<Rule> {
  const r = await get<any>('SELECT rules FROM chat_channel_rules WHERE channel_id = ?', channel);
  try { return r ? { ...OPEN, ...JSON.parse(r.rules) } : OPEN; } catch { return OPEN; }
}
/** What this person is, in the terms a rule names them by. */
async function tagsOf(u: User) {
  const roles = (await all<any>('SELECT role_id FROM user_roles WHERE user_id = ?', u.id)).map((r) => `r:${r.role_id}`);
  return new Set([`u:${u.id}`, ...(u.team_role ? [`d:${u.team_role}`] : []), ...roles, `r:role_${MEMBER}`]);
}
/** In a channel: whether this person sees it and writes in it (its rules on top of the server's rights). */
export async function channelRights(u: User, channel: string, server?: string) {
  const r = await chatRights(u, server ?? await serverOfChannel(channel)), rule = await ruleOf(channel);
  if (!r.member) return { ...r, view: false, send: false, private: !rule.view.all, readOnly: !rule.send.all };
  const me = r.manage || (rule.view.all && rule.send.all) ? null : await tagsOf(u);
  const hit = (who: string[]) => !!me && who.some((t) => me.has(t));
  const view = r.manage || rule.view.all || hit(rule.view.who);
  return { ...r, view, send: view && r.send && (r.manage || rule.send.all || hit(rule.send.who)), private: !rule.view.all, readOnly: !rule.send.all };
}
/** channelRights for many channels at once (a list of channels): the person's server rights and tags asked once. */
export function rightsMemo(u: User) {
  const servers = new Map<string, ReturnType<typeof chatRights>>();
  let tags: Promise<Set<string>> | null = null;
  return async (channel: string, server: string) => {
    if (!servers.has(server)) servers.set(server, chatRights(u, server));
    const r = await servers.get(server)!, rule = await ruleOf(channel);
    const base = { private: !rule.view.all, readOnly: !rule.send.all };
    if (!r.member) return { ...r, ...base, view: false, send: false };
    if (r.manage || (rule.view.all && rule.send.all)) return { ...r, ...base, view: true, send: r.send };
    const me = await (tags ||= tagsOf(u)), hit = (who: string[]) => who.some((t) => me.has(t));
    const view = rule.view.all || hit(rule.view.who);
    return { ...r, ...base, view, send: view && r.send && (rule.send.all || hit(rule.send.who)) };
  };
}
const REFUSED: Record<Exclude<ChatAct, 'view'>, string> = { send: 'Bạn không được phép nhắn tin ở đây', manage: 'Bạn không có quyền quản lý tin nhắn ở đây' };
export async function needInServer(u: User, server: string, act: ChatAct) {
  const r = await chatRights(u, server);
  if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
  if (act !== 'view' && !r[act]) throw new HttpError(403, REFUSED[act]);
}
/** Stops the request unless this person may `act` in a channel (a channel id), its own rules included. */
export async function needInChannel(u: User, channel: string, act: ChatAct) {
  const r = await channelRights(u, channel);
  if (!r.member || !r.view) throw new HttpError(404, 'Không tìm thấy kênh');
  if (act !== 'view' && !r[act]) throw new HttpError(403, REFUSED[act]);
}
/** Writing to someone directly: the same "Nhắn tin" permission. */
export const needToSend = (u: User) => needInServer(u, 'company', 'send');

export function registerChatPerms(api: Router) {
  // What the page offers: channels it may not see are left out, where it may not write the box is closed, who may not
  // manage gets no channel buttons. `channels`: the server's channels to ask about.
  api.get('/api/chat/servers/:server/access', async (req, res) => {
    const u = (await currentUser(req))!, server = req.params.server === 'dm' ? 'company' : req.params.server;
    const r = await chatRights(u, server);
    if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
    const channels: Record<string, { view: boolean; send: boolean; private: boolean; readOnly: boolean }> = {}, rights = rightsMemo(u);
    for (const id of String(req.query.get('channels') || '').split(',').filter(Boolean).slice(0, 100)) {
      const c = await rights(id, server);
      channels[id] = { view: c.view, send: c.send, private: c.private, readOnly: c.readOnly };
    }
    json(res, 200, { send: r.send, manage: r.manage, channels });
  });

  // A channel's rules, and what can be picked for them: people, departments and roles of the site.
  api.get('/api/chat/channels/:id/rules', async (req, res) => {
    await needInServer((await currentUser(req))!, await serverOfChannel(req.params.id), 'manage');
    json(res, 200, {
      ...await ruleOf(req.params.id),
      options: {
        people: await all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE'),
        departments: await all<any>('SELECT id, name, color FROM team_roles ORDER BY pos, name'),
        roles: await all<any>('SELECT id, name FROM roles ORDER BY rank DESC, name'),
      },
    });
  });
  api.put('/api/chat/channels/:id/rules', async (req, res) => {
    const u = (await currentUser(req))!;
    await needInServer(u, await serverOfChannel(req.params.id), 'manage');
    const b = await readJson(req), known = new Set([
      ...(await all<any>('SELECT id FROM users')).map((r) => `u:${r.id}`),
      ...(await all<any>('SELECT id FROM team_roles')).map((r) => `d:${r.id}`),
      ...(await all<any>('SELECT id FROM roles')).map((r) => `r:${r.id}`),
    ]);
    const part = (v: any) => ({ all: v?.all !== false, who: v?.all === false && Array.isArray(v.who) ? [...new Set<string>(v.who.map(String))].filter((t) => known.has(t)).slice(0, 500) : [] });
    const next: Rule = { view: part(b.view), send: part(b.send) }, before = await ruleOf(req.params.id);
    if (next.view.all && next.send.all) await run('DELETE FROM chat_channel_rules WHERE channel_id = ?', req.params.id);
    else await run('INSERT INTO chat_channel_rules(channel_id, rules, updated_by, updated_at) VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET rules = excluded.rules, updated_by = excluded.updated_by, updated_at = excluded.updated_at', req.params.id, JSON.stringify(next), u.id, now());
    await changed({ user: u, access: await accessOf(u), scope: 'organization', req }, { action: 'Đổi quyền của kênh', type: 'settings', id: `chat:${req.params.id}`, label: `Kênh #${req.params.id}`, before: before as any, after: next as any, kind: 'permission' });
    json(res, 200, next);
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
