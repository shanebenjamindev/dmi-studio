// #co-gi-moi, the system's channel in Tin nhắn: each Có gì mới (shared/updates.ts) posted as a message of DMI Workspace,
// so a release announces itself where people talk. Its messages are the list itself, not rows (old chat is cleared after
// 60 days, the updates stay), and nobody writes there. An update is posted when the server first meets it, that is when
// the release that brings it is deployed; those from before the channel keep their own day.
import { get, now, getSetting, setSetting } from './db';
import type { User } from './auth';
import { UPDATES, type Update } from '../shared/updates';

export const NEWS = 'co-gi-moi';
export const NEWS_CHANNEL: [string, string, string, string] = [NEWS, 'KÊNH THÔNG TIN', 'co-gi-moi', 'Bản cập nhật mới của DMI Workspace, đăng tự động mỗi lần hệ thống có thay đổi'];
const POSTED = 'news_posted';

/** "2026-11-18-2": 9h (Vietnam) that day, a minute apart for each update of the day. */
const dayOf = (id: string) => {
  const [y, m, d, n] = id.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, 2) + (n || 0) * 60_000;
};
/** When each update was posted. */
async function postedAt() {
  const at = await getSetting<Record<string, number>>(POSTED, {});
  const first = !Object.keys(at).length, t = now();
  let fresh = false;
  // Oldest first, so updates arriving together keep their order.
  for (const [i, u] of [...UPDATES].reverse().entries()) {
    if (at[u.id]) continue;
    at[u.id] = first ? dayOf(u.id) : t + i;
    fresh = true;
  }
  if (fresh) await setSetting(POSTED, at);
  return at;
}

const line = (u: Update) => [`Có gì mới · ${u.date}`, ...u.items.map((i) => `${i.kind === 'fix' ? '🔧' : '✨'} ${i.vi}`)].join('\n');
/** The channel's messages, oldest first, as GET /api/chat/messages gives them. */
export async function newsMessages() {
  const at = await postedAt();
  return UPDATES.map((u) => ({
    id: `news_${u.id}`, senderId: 'system', senderName: 'DMI Workspace', senderEmail: '', senderAvatarAt: null, senderRole: null,
    recipientId: null, channel: NEWS, message: line(u), replyToId: null, pinned: false, reactions: {}, attachments: [],
    news: { date: u.date, items: u.items }, createdAt: at[u.id], isMe: false, system: true,
  })).sort((a, b) => a.createdAt - b.createdAt);
}
/** Updates posted since this person last read the channel (or joined). */
export async function newsUnread(u: User) {
  const at = await postedAt();
  const read = await get<any>('SELECT read_at FROM chat_reads WHERE user_id = ? AND conversation = ?', u.id, NEWS);
  const since = Number(read?.read_at) || Number((await get<any>('SELECT created_at FROM users WHERE id = ?', u.id))?.created_at) || 0;
  return UPDATES.filter((x) => at[x.id] > since).length;
}
