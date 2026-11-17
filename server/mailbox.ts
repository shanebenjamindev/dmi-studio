// Hộp thư: each person reads and sends mail from their own Gmail, connected by themselves (Google OAuth, gmail.modify).
// Nobody else, admins included, reaches another person's mailbox: every route works on the signed-in account's own.
// Gmail keeps the mail; DMI keeps only the connection (user_gmail) and asks Gmail each time.
import type { Router, Req } from './http';
import { HttpError, json, readJson, publicOrigin, untrustedHeaders } from './http';
import { all, get, getSetting, run } from './db';
import { currentUser } from './auth';
import * as G from './google';
import { buildMime, header, parseAddresses, person, readParts, type GPart } from './gmail-mime';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** The folders Hộp thư shows, as Gmail's labels. */
const FOLDERS: Record<string, string> = { inbox: 'INBOX', starred: 'STARRED', important: 'IMPORTANT', sent: 'SENT', all: '', spam: 'SPAM', trash: 'TRASH' };
/** What may be sent in one message (the request carries the files as base64, within readJson's 5 MB). */
const ATTACH_MAX = 3.5 * 1024 * 1024;

interface Box { user_id: string; email: string; name: string; picture: string; refresh: string; access: string | null; expiry: number | null; signature: string; signature_on: number }
/** A signature as written in Hộp thư or taken from Gmail: HTML, kept small. */
const SIGNATURE_MAX = 65_536;
const me = async (req: Req) => (await currentUser(req))!;
const boxOf = (userId: string) => get<Box>('SELECT * FROM user_gmail WHERE user_id=?', userId);
/** 409 with need 'reconnect' (never 401: the app would take that for its own session ending). */
const reconnect = (msg: string) => new HttpError(409, msg, 'reconnect');

async function token(box: Box, force = false) {
  if (!force && box.access && (box.expiry || 0) > Date.now()) return box.access;
  const t = await G.tokenCall({ refresh_token: box.refresh, grant_type: 'refresh_token' }).catch(() => {
    throw reconnect(`Phiên Gmail của ${box.email} đã hết hạn, hãy kết nối lại`);
  });
  box.access = t.access_token; box.expiry = Date.now() + ((t.expires_in || 3600) - 60) * 1000;
  await run('UPDATE user_gmail SET access=?,expiry=? WHERE user_id=?', box.access, box.expiry, box.user_id);
  return box.access!;
}
/** A Gmail call as this person; once more with a fresh token if Gmail turns the old one down. */
async function gmail<T = any>(box: Box, path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(GMAIL + path, { ...init, headers: { ...(init.headers as any), authorization: `Bearer ${await token(box, !retry)}`, ...(init.body ? { 'content-type': 'application/json' } : {}) }, signal: AbortSignal.timeout(20000) });
  if (res.status === 401 && retry) return await gmail(box, path, init, false);
  const body: any = await res.json().catch(() => ({}));
  if (res.ok) return body;
  const reasons = JSON.stringify(body?.error || {});
  if (res.status === 401 || /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(reasons)) throw reconnect('Gmail chưa cho phép DMI đọc và gửi thư, hãy kết nối lại');
  if (/SERVICE_DISABLED|accessNotConfigured/.test(reasons)) throw new HttpError(502, 'Gmail API chưa được bật trong Google Cloud project của DMI. Nhờ quản trị viên bật Gmail API rồi thử lại.');
  if (res.status === 404) throw new HttpError(404, 'Không tìm thấy thư (có thể đã bị xoá trong Gmail)');
  if (res.status === 429) throw new HttpError(429, 'Gmail đang giới hạn, hãy thử lại sau ít phút');
  throw new HttpError(502, `Gmail: ${body?.error?.message || res.status}`);
}
async function mustBox(req: Req) {
  const box = await boxOf((await me(req)).id);
  if (!box) throw new HttpError(400, 'Bạn chưa kết nối Gmail', 'connect');
  return box;
}
const gid = (s: string) => { if (!/^[\w-]{1,200}$/.test(s)) throw new HttpError(400, 'Mã thư không hợp lệ'); return s; };

/** A thread as a row of the list: its subject, who wrote, the last message's time, unread or not. */
function threadRow(t: any) {
  const msgs: any[] = t.messages || [], first = msgs[0], last = msgs.at(-1);
  const people = [...new Map(msgs.map((m) => person(header(m.payload, 'From'))).map((p) => [p.email, p])).values()];
  return {
    id: t.id, subject: header(first?.payload, 'Subject') || '(Không có tiêu đề)', snippet: last?.snippet || '',
    from: people.map((p) => p.name), count: msgs.length, at: Number(last?.internalDate || 0),
    unread: msgs.some((m) => m.labelIds?.includes('UNREAD')), starred: msgs.some((m) => m.labelIds?.includes('STARRED')),
    attachments: msgs.some((m) => /multipart\/mixed/i.test(m.payload?.mimeType || '')),
  };
}

export function registerMailbox(api: Router) {
  api.get('/api/mailbox', async (req, res) => {
    const box = await boxOf((await me(req)).id), c = await G.oauthConfig();
    if (!box) return json(res, 200, { connected: false, googleConfigured: !!(c.clientId && c.clientSecret) });
    // The unread count asks Gmail; a mailbox that needs connecting again says so instead of failing the page.
    const inbox = await gmail(box, '/labels/INBOX').catch((e) => (e instanceof HttpError && e.need === 'reconnect' ? { reconnect: e.message } : null));
    json(res, 200, { connected: true, googleConfigured: true, email: box.email, name: box.name, picture: box.picture, unread: inbox?.threadsUnread ?? null, reconnect: inbox?.reconnect ?? null,
      signature: box.signature || '', signatureOn: !!box.signature_on });
  });
  api.get('/api/mailbox/connect', async (req, res) => {
    const user = await me(req);
    res.writeHead(302, { location: await G.authUrl(`${publicOrigin(req)}/api/google/callback`, 'mailbox', user.id) });
    res.end();
  });
  api.delete('/api/mailbox', async (req, res) => {
    const user = await me(req), box = await boxOf(user.id);
    await run('DELETE FROM user_gmail WHERE user_id=?', user.id);
    // Google takes back the access too, unless the same Google account still serves DMI elsewhere (Drive, notification
    // mail, another person's mailbox): its grant is shared, and taking it back would cut those off.
    if (box) {
      const elsewhere = (await G.accounts()).some((a) => a.email === box.email) || (await getSetting<any>('notification_mail', null))?.email === box.email
        || (await all('SELECT 1 FROM user_gmail WHERE email=?', box.email)).length > 0;
      if (!elsewhere) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(box.refresh)}`, { method: 'POST' }).catch(() => {});
    }
    json(res, 200, { ok: true });
  });

  // Settings of one's own mailbox: the signature added to what they write, and whether it is.
  api.put('/api/mailbox/settings', async (req, res) => {
    const box = await mustBox(req), b = await readJson(req);
    const signature = b.signature !== undefined ? String(b.signature) : box.signature;
    if (signature.length > SIGNATURE_MAX) throw new HttpError(400, 'Chữ ký quá dài');
    await run('UPDATE user_gmail SET signature=?, signature_on=? WHERE user_id=?', signature, b.signatureOn !== undefined ? (b.signatureOn ? 1 : 0) : box.signature_on, box.user_id);
    json(res, 200, { ok: true });
  });
  // The signature set in Gmail itself (its main address), to use here as well.
  api.get('/api/mailbox/gmail-signature', async (req, res) => {
    const box = await mustBox(req), r = await gmail(box, '/settings/sendAs');
    const main = (r.sendAs || []).find((a: any) => a.isPrimary) || (r.sendAs || []).find((a: any) => a.sendAsEmail === box.email);
    json(res, 200, { signature: String(main?.signature || '').slice(0, SIGNATURE_MAX) });
  });
  api.get('/api/mailbox/threads', async (req, res) => {
    const box = await mustBox(req), folder = req.query.get('folder') || 'inbox', q = (req.query.get('q') || '').slice(0, 300), page = req.query.get('page') || '';
    if (!(folder in FOLDERS)) throw new HttpError(400, 'Thư mục không hợp lệ');
    const params = new URLSearchParams({ maxResults: '20' });
    if (FOLDERS[folder]) params.set('labelIds', FOLDERS[folder]);
    if (q) params.set('q', q);
    if (page) params.set('pageToken', page);
    // Gmail leaves Spam and Trash out of every list unless asked.
    if (folder === 'spam' || folder === 'trash') params.set('includeSpamTrash', 'true');
    const list = await gmail(box, `/threads?${params}`);
    const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
    const threads = await Promise.all((list.threads || []).map((t: any) => gmail(box, `/threads/${gid(t.id)}?${meta}`).then(threadRow, () => null)));
    json(res, 200, { threads: threads.filter(Boolean), next: list.nextPageToken || null });
  });
  api.get('/api/mailbox/threads/:id', async (req, res) => {
    const box = await mustBox(req), t = await gmail(box, `/threads/${gid(req.params.id)}?format=full`);
    const messages = (t.messages || []).map((m: any) => {
      const p: GPart = m.payload || {}, from = person(header(p, 'From'));
      return { id: m.id, from, to: header(p, 'To'), cc: header(p, 'Cc'), subject: header(p, 'Subject'), at: Number(m.internalDate || 0), messageId: header(p, 'Message-ID') || header(p, 'Message-Id'),
        references: header(p, 'References'), unread: !!m.labelIds?.includes('UNREAD'), mine: from.email === box.email, ...readParts(p) };
    });
    // Opened here is read in Gmail too.
    if (messages.some((m: any) => m.unread)) await gmail(box, `/threads/${gid(t.id)}/modify`, { method: 'POST', body: JSON.stringify({ removeLabelIds: ['UNREAD'] }) }).catch(() => {});
    const labels = [...new Set((t.messages || []).flatMap((m: any) => m.labelIds || []))];
    json(res, 200, { id: t.id, subject: messages[0]?.subject || '(Không có tiêu đề)', messages, spam: labels.includes('SPAM'), trash: labels.includes('TRASH') });
  });
  api.post('/api/mailbox/threads/:id/modify', async (req, res) => {
    const box = await mustBox(req), b = await readJson(req), add: string[] = [], remove: string[] = [];
    if (typeof b.unread === 'boolean') (b.unread ? add : remove).push('UNREAD');
    if (typeof b.starred === 'boolean') (b.starred ? add : remove).push('STARRED');
    if (b.archive === true) remove.push('INBOX');
    // Reported as spam it leaves the inbox; taken out of spam it goes back there (as Gmail does).
    if (b.spam === true) { add.push('SPAM'); remove.push('INBOX'); }
    if (b.spam === false) { remove.push('SPAM'); add.push('INBOX'); }
    const id = gid(req.params.id);
    if (typeof b.trash === 'boolean') await gmail(box, `/threads/${id}/${b.trash ? 'trash' : 'untrash'}`, { method: 'POST', body: '{}' });
    else if (!add.length && !remove.length) throw new HttpError(400, 'Không có gì để đổi');
    if (add.length || remove.length) await gmail(box, `/threads/${id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
    json(res, 200, { ok: true });
  });
  api.get('/api/mailbox/messages/:id/attachments/:att', async (req, res) => {
    const box = await mustBox(req), a = await gmail(box, `/messages/${gid(req.params.id)}/attachments/${gid(req.params.att)}`);
    const body = Buffer.from(a.data || '', 'base64url'), name = (req.query.get('name') || 'tep-dinh-kem').slice(0, 200), type = req.query.get('type') || 'application/octet-stream';
    // Someone else's file: never shown as a page of this site.
    res.writeHead(200, { 'content-type': /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream', 'content-length': body.length, 'cache-control': 'private, no-store', ...untrustedHeaders(type, name),
      ...(req.query.get('download') ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {}) });
    res.end(body);
  });
  api.post('/api/mailbox/send', async (req, res) => {
    const b = await readJson(req);
    let to: string[], cc: string[], bcc: string[];
    try { to = parseAddresses(b.to); cc = parseAddresses(b.cc); bcc = parseAddresses(b.bcc); } catch (e: any) { throw new HttpError(400, e.message); }
    if (!to.length) throw new HttpError(400, 'Hãy nhập người nhận');
    if (to.length + cc.length + bcc.length > 50) throw new HttpError(400, 'Mỗi thư tối đa 50 người nhận');
    const subject = String(b.subject ?? '').slice(0, 500), text = String(b.text ?? ''), html = b.html ? String(b.html) : '';
    if (html.length > 1_000_000) throw new HttpError(400, 'Nội dung thư quá dài');
    if (!subject.trim() && !text.trim()) throw new HttpError(400, 'Thư chưa có tiêu đề và nội dung');
    if (text.length > 200_000) throw new HttpError(400, 'Nội dung thư quá dài');
    const files = Array.isArray(b.attachments) ? b.attachments : [];
    if (files.length > 10) throw new HttpError(400, 'Mỗi thư tối đa 10 tệp đính kèm');
    const attachments = files.map((f: any) => ({ name: String(f?.name || 'file').slice(0, 200), type: String(f?.type || ''), data: Buffer.from(String(f?.data || ''), 'base64') }));
    if (attachments.reduce((n: number, a: any) => n + a.data.length, 0) > ATTACH_MAX) throw new HttpError(400, 'Tệp đính kèm tối đa 3,5 MB mỗi thư; tệp lớn hơn hãy gửi link Drive');
    const box = await mustBox(req), threadId = b.threadId ? gid(String(b.threadId)) : undefined;
    const raw = buildMime({ from: { email: box.email, name: box.name }, to, cc, bcc, subject, text, html: html || undefined, attachments,
      inReplyTo: b.inReplyTo ? String(b.inReplyTo).slice(0, 1000) : undefined, references: b.references ? String(b.references).slice(0, 4000) : undefined });
    const sent = await gmail(box, '/messages/send', { method: 'POST', body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url'), ...(threadId ? { threadId } : {}) }) });
    json(res, 200, { id: sent.id, threadId: sent.threadId });
  });
}
