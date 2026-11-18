// The channels of Tin nhắn, kept here (not in the page): each server starts with its usual channels, made once (one an
// admin deletes stays deleted), and those who manage Tin nhắn add, rename, move to another category and delete them.
// #general stays: the small chat window talks there. A channel's list shows only those its viewer may see
// (server/chat-perms.ts), so a private channel's name stays private. #co-gi-moi, the system's, came later: it is made
// once on its own (server/chat-news.ts).
import type { Router } from './http';
import { HttpError, json, readJson } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { currentUser } from './auth';
import { needInServer, needInChannel, rightsMemo } from './chat-perms';
import { dropConversation } from './chat-files';
import { NEWS_CHANNEL } from './chat-news';

const COMPANY: [string, string, string, string][] = [
  ['thong-bao', 'KÊNH THÔNG TIN', 'thong-bao', 'Thông báo chung và cập nhật quan trọng toàn công ty'],
  ['general', 'KÊNH CHUNG', 'general', 'Kênh trao đổi công việc chung của cả công ty'],
  ['y-tuong', 'KÊNH CHUNG', 'y-tuong', 'Đóng góp ý tưởng sáng tạo, cải tiến quy trình'],
  ['account', 'PHÒNG BAN & DỊCH VỤ', 'account', 'Trao đổi brief khách hàng, tiến độ Account'],
  ['execution', 'PHÒNG BAN & DỊCH VỤ', 'execution', 'Triển khai sản xuất Media, Design, Video, Content'],
  ['paid-ads', 'PHÒNG BAN & DỊCH VỤ', 'paid-ads', 'Chiến dịch quảng cáo, tối ưu ngân sách & báo cáo'],
  ['website', 'PHÒNG BAN & DỊCH VỤ', 'website', 'Kỹ thuật website, hosting, domain & SEO'],
];
/** A brand workspace's: "ws_<workspace>_<key>", the ids its messages were kept under before channels were rows. */
const workspaceDefaults = (w: { id: string; name: string; customer: string | null }): [string, string, string, string][] => [
  [`ws_${w.id}_chung`, 'KÊNH NHÃN HÀNG', 'chung', `Trao đổi chung của nhãn hàng ${w.name}`],
  [`ws_${w.id}_brief`, 'KÊNH NHÃN HÀNG', 'brief-khach-hang', `Brief, tài liệu và yêu cầu từ khách hàng ${w.customer || w.name}`],
  [`ws_${w.id}_san-xuat`, 'TRIỂN KHAI', 'san-xuat', `Sản xuất nội dung, hình ảnh, video cho ${w.name}`],
  [`ws_${w.id}_bao-cao`, 'TRIỂN KHAI', 'bao-cao-nghiem-thu', `Báo cáo kết quả và nghiệm thu công việc ${w.name}`],
];
const SEEDED = 'chat_seeded';
/** Every server's usual channels, once each. */
async function seed() {
  const done = new Set(await getSetting<string[]>(SEEDED, []));
  const servers: [string, [string, string, string, string][]][] = [];
  if (!done.has('company')) servers.push(['company', COMPANY]);
  if (!done.has('news')) servers.push(['news', [NEWS_CHANNEL]]);
  for (const w of await all<any>('SELECT w.id, COALESCE(b.name, w.name) name, c.name customer FROM workspaces w LEFT JOIN brands b ON b.id = w.brand_id LEFT JOIN customers c ON c.id = w.customer_id')) {
    if (!done.has(w.id)) servers.push([w.id, workspaceDefaults(w)]);
  }
  if (!servers.length) return;
  const t = now();
  for (const [server, list] of servers) {
    for (const [i, [id, category, name, topic]] of list.entries()) await run('INSERT OR IGNORE INTO chat_channels(id, server_id, category, name, topic, created_by, created_at) VALUES(?,?,?,?,?,NULL,?)', id, server === 'news' ? 'company' : server, category, name, topic, t + i);
    done.add(server);
  }
  await setSetting(SEEDED, [...done]);
}
/** A channel's name as Discord writes them: lower case, words joined by "-". */
const channelName = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_đàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ-]/gi, '').slice(0, 48);
const category = (v: unknown, fallback = 'KÊNH CHUNG') => String(v ?? '').trim().slice(0, 60) || fallback;
const out = (r: any, extra: { private: boolean; readOnly: boolean }) => ({ id: r.id, serverId: r.server_id || 'company', category: r.category || 'KÊNH CHUNG', name: r.name, topic: r.topic || '', createdBy: r.created_by || null, createdAt: r.created_at, ...extra, ...(r.id === NEWS_CHANNEL[0] ? { system: true } : {}) });
const mustChannel = async (id: string) => {
  const ch = await get<any>('SELECT * FROM chat_channels WHERE id = ?', id);
  if (!ch) throw new HttpError(404, 'Không tìm thấy kênh');
  return ch;
};

export function registerChatChannels(api: Router) {
  api.get('/api/chat/channels', async (req, res) => {
    const u = (await currentUser(req))!;
    await seed();
    const rights = rightsMemo(u), list: ReturnType<typeof out>[] = [];
    for (const r of await all<any>('SELECT * FROM chat_channels ORDER BY created_at ASC')) {
      const c = await rights(r.id, r.server_id || 'company');
      if (c.view) list.push(out(r, { private: c.private, readOnly: c.readOnly }));
    }
    json(res, 200, list);
  });
  api.post('/api/chat/channels', async (req, res) => {
    const u = (await currentUser(req))!, b = await readJson(req), name = channelName(b.name);
    if (!name) throw new HttpError(400, 'Hãy nhập tên kênh');
    const serverId = String(b.serverId || 'company').trim() || 'company';
    await needInServer(u, serverId, 'manage');
    const id = `ch_${uid('').slice(0, 12)}`, t = now();
    await run('INSERT INTO chat_channels(id, server_id, category, name, topic, created_by, created_at) VALUES(?,?,?,?,?,?,?)', id, serverId, category(b.category), name, String(b.topic || '').trim().slice(0, 200), u.id, t);
    json(res, 201, out(await mustChannel(id), { private: false, readOnly: false }));
  });
  // Its name, topic and category.
  api.put('/api/chat/channels/:id', async (req, res) => {
    const u = (await currentUser(req))!, ch = await mustChannel(req.params.id), b = await readJson(req);
    await needInChannel(u, ch.id, 'manage');
    const name = b.name !== undefined ? channelName(b.name) : ch.name;
    if (!name) throw new HttpError(400, 'Hãy nhập tên kênh');
    await run('UPDATE chat_channels SET name = ?, topic = ?, category = ? WHERE id = ?', name, b.topic !== undefined ? String(b.topic).trim().slice(0, 200) : ch.topic, b.category !== undefined ? category(b.category, ch.category) : ch.category, ch.id);
    json(res, 200, out(await mustChannel(ch.id), { private: false, readOnly: false }));
  });
  // A category renamed: every channel of the server in it.
  api.put('/api/chat/servers/:server/categories', async (req, res) => {
    const u = (await currentUser(req))!, b = await readJson(req);
    await needInServer(u, req.params.server, 'manage');
    const from = String(b.from || ''), to = category(b.to, '');
    if (!from || !to) throw new HttpError(400, 'Hãy nhập tên danh mục');
    await run('UPDATE chat_channels SET category = ? WHERE server_id = ? AND category = ?', to, req.params.server, from);
    json(res, 200, { ok: true });
  });
  // With its messages, files and rules. Its maker, or who manages Tin nhắn; #general stays.
  api.delete('/api/chat/channels/:id', async (req, res) => {
    const u = (await currentUser(req))!, ch = await mustChannel(req.params.id);
    if (ch.id === 'general') throw new HttpError(400, 'Kênh #general là kênh chung của cả công ty, không xoá được');
    if (ch.created_by !== u.id) await needInChannel(u, ch.id, 'manage');
    await run('DELETE FROM chat_messages WHERE channel = ?', ch.id);
    await dropConversation(ch.id);
    await run('DELETE FROM chat_channel_rules WHERE channel_id = ?', ch.id);
    await run('DELETE FROM chat_channels WHERE id = ?', ch.id);
    json(res, 200, { ok: true });
  });
}
