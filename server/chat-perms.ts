// Who may do what in Tin nhắn, by the site's own permissions rather than rules of its own:
//  • the company's channels (DMI Studio): everyone reads and writes; creating channels, deleting other people's and
//    managing messages (pinning, deleting other people's messages and files, clearing a channel) are the "Tin nhắn"
//    permissions of Quản trị › Phân quyền (messages.create / messages.delete / messages.manage);
//  • a brand workspace's channels: whoever may open the workspace reads and writes; its owner and admins manage them,
//    as do the people holding those permissions who are in it.
// Direct messages belong to no server: always their two people.
import type { Router } from './http';
import { HttpError, json } from './http';
import { get } from './db';
import { currentUser, type User } from './auth';
import { accessOf } from './rbac';

export type ChatAct = 'view' | 'send' | 'create' | 'delete' | 'manage';
const NAME: Record<ChatAct, string> = { view: 'xem kênh này', send: 'gửi tin nhắn ở đây', create: 'tạo kênh', delete: 'xoá kênh này', manage: 'quản lý tin nhắn ở đây' };

/** The server a channel belongs to: a workspace's built-in channels are "ws_<workspace>_<name>", a made one says it. */
export async function serverOfChannel(channel: string) {
  const custom = await get<any>('SELECT server_id FROM chat_channels WHERE id = ?', channel);
  if (custom) return String(custom.server_id || 'company');
  return /^ws_(.+)_[^_]+$/.exec(channel)?.[1] || 'company';
}
/** What this person may do in a server ('company' or a workspace id). */
export async function chatRights(u: User, server: string) {
  const site = (await accessOf(u)).perms, has = (p: string) => site.has(`messages.${p}`);
  if (server === 'company') return { member: true, create: has('create'), delete: has('delete'), manage: has('manage') };
  const w = await get<any>('SELECT owner_id, visibility FROM workspaces WHERE id = ?', server);
  const mine = w && await get<any>('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', server, u.id);
  const admin = !!w && (u.role === 'admin' || w.owner_id === u.id || mine?.role === 'admin');
  const member = admin || !!mine || w?.visibility === 'company';
  return { member, create: member && (admin || has('create')), delete: member && (admin || has('delete')), manage: member && (admin || has('manage')) };
}
export async function needInServer(u: User, server: string, act: ChatAct) {
  const r = await chatRights(u, server);
  if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
  if (act !== 'view' && act !== 'send' && !r[act]) throw new HttpError(403, `Bạn không có quyền ${NAME[act]}`);
}
/** Stops the request unless this person may `act` in a channel (a channel id; direct messages are never asked). */
export const needInChannel = async (u: User, channel: string, act: ChatAct) => needInServer(u, await serverOfChannel(channel), act);

export function registerChatPerms(api: Router) {
  // What the page offers in a server: who may not create a channel or manage messages does not see the buttons.
  api.get('/api/chat/servers/:server/access', async (req, res) => {
    const r = await chatRights((await currentUser(req))!, req.params.server);
    if (!r.member) throw new HttpError(404, 'Không tìm thấy kênh');
    json(res, 200, { create: r.create, delete: r.delete, manage: r.manage });
  });
}
