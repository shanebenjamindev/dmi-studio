// Thông báo: messages sent from Quản trị to people, departments, teams or everyone, landing in each person's bell (and
// their email when they have it on, through the same outbox as task notifications); who has read each; templates; and
// the email delivery log. People send only to the accounts their notifications.create scope reaches.
import { createHash } from 'node:crypto';
import { all, get, run, uid, now, getSetting } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { scrub } from '../audit';
import { need, reach, inSet, text, oneOf, paging, page, changed, matcher } from './common';

const AUDIENCE = ['all', 'users', 'departments', 'teams'] as const;
type Audience = { type: (typeof AUDIENCE)[number]; ids: string[] };
/** A link inside the app (#tasks, #boards/…), opened from the bell; or none. */
const linkIn = (v: unknown) => { const s = text(v, 300, 'liên kết', false); if (s && !/^#[A-Za-z0-9/_\-?=&.%]{1,299}$/.test(s)) throw new HttpError(400, 'Liên kết phải là một địa chỉ trong ứng dụng, bắt đầu bằng #'); return s; };

async function audienceIn(v: any): Promise<Audience> {
  const type = oneOf(v?.type, AUDIENCE, 'Người nhận');
  const ids = type === 'all' ? [] : Array.isArray(v?.ids) ? [...new Set<string>(v.ids.filter((x: unknown) => typeof x === 'string'))] : [];
  if (type !== 'all' && (!ids.length || ids.length > 500)) throw new HttpError(400, 'Hãy chọn người nhận');
  return { type, ids };
}
/** The active accounts an audience names. */
async function recipients(a: Audience) {
  const q = a.type === 'all' ? 'SELECT id FROM users WHERE disabled = 0'
    : a.type === 'users' ? 'SELECT id FROM users WHERE disabled = 0 AND id IN (SELECT value FROM json_each(?))'
    : a.type === 'departments' ? 'SELECT id FROM users WHERE disabled = 0 AND team_role IN (SELECT value FROM json_each(?))'
    : 'SELECT DISTINCT u.id FROM team_members m JOIN users u ON u.id = m.user_id JOIN teams t ON t.id = m.team_id AND t.deleted_at IS NULL WHERE u.disabled = 0 AND m.team_id IN (SELECT value FROM json_each(?))';
  return (await all<any>(q, ...(a.type === 'all' ? [] : [JSON.stringify(a.ids)]))).map((r) => r.id as string);
}
async function audienceText(a: Audience) {
  if (a.type === 'all') return 'Toàn hệ thống';
  const table = a.type === 'users' ? 'users' : a.type === 'departments' ? 'team_roles' : 'teams';
  const names = (await all<any>(`SELECT name FROM ${table} WHERE id IN (SELECT value FROM json_each(?)) ORDER BY name`, JSON.stringify(a.ids))).map((r) => r.name);
  return `${{ users: 'Cá nhân', departments: 'Phòng ban', teams: 'Nhóm' }[a.type]}: ${names.join(', ')}`;
}

export function registerNotify(api: Router) {
  api.post('/api/admin/notifications', async (req, res) => {
    const c = await need(req, 'notifications.create'), b = await readJson(req);
    const title = text(b.title, 150, 'tiêu đề'), body = text(b.body, 2000, 'nội dung', false), link = linkIn(b.link), audience = await audienceIn(b.audience);
    const ids = await reach(c), to = (await recipients(audience)).filter((id) => id !== c.user.id);
    if (audience.type === 'all' && ids) throw new HttpError(403, 'Phạm vi của bạn không cho phép gửi thông báo toàn hệ thống');
    const outside = ids ? to.filter((id) => !ids.has(id)) : [];
    if (outside.length) throw new HttpError(403, `${outside.length} người nhận nằm ngoài phạm vi của bạn`);
    if (!to.length) throw new HttpError(400, 'Không có người nhận nào đang hoạt động');
    const id = uid('nl_'), at = now(), base = await getSetting('notification_site_url', process.env.PUBLIC_URL || '');
    const payload = { title, task: body, link: link || null, broadcastId: id, url: base && link ? `${base}/${link}` : base || '' };
    let emailed = 0;
    for (const userId of to) {
      const nid = 'mail_' + createHash('sha256').update(JSON.stringify([id, userId])).digest('hex').slice(0, 32);
      await run('INSERT OR IGNORE INTO notifications(id, user_id, task_id, payload, created_at, broadcast_id) VALUES(?,?,?,?,?,?)', nid, userId, null, JSON.stringify(payload), at, id);
      if (await get('SELECT 1 FROM notification_preferences WHERE user_id = ? AND enabled = 1 AND email IS NOT NULL AND verified_at IS NOT NULL', userId)) {
        await run('INSERT OR IGNORE INTO mail_outbox(id, user_id, payload, created_at) VALUES(?,?,?,?)', nid, userId, JSON.stringify({ ...payload, link: link || '#' }), at); emailed++;
      }
    }
    const who = await audienceText(audience);
    await run('INSERT INTO notification_logs(id, title, body, link, audience, recipients, emailed, template_id, sent_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, title, body, link, JSON.stringify({ ...audience, text: who }), to.length, emailed, b.templateId ? String(b.templateId).slice(0, 40) : null, c.user.id, at);
    await changed(c, { action: 'Gửi thông báo', type: 'notification', id, label: title, after: { audience: who, recipients: to.length, emailed } });
    json(res, 201, { id, recipients: to.length, emailed });
  });
  // Sent notifications (by the senders the scope reaches) with how many have read each.
  api.get('/api/admin/notifications', async (req, res) => {
    const c = await need(req, 'notifications.view'), [cond, args] = inSet('l.sent_by', await reach(c)), hit = matcher(req.query.get('q'));
    const reads = new Map((await all<any>('SELECT broadcast_id, COUNT(*) n, SUM(read_at IS NOT NULL) r FROM notifications WHERE broadcast_id IS NOT NULL GROUP BY broadcast_id')).map((r) => [r.broadcast_id, { n: Number(r.n), r: Number(r.r) }]));
    const rows = (await all<any>(`SELECT l.*, u.name sender FROM notification_logs l LEFT JOIN users u ON u.id = l.sent_by WHERE ${cond}`, ...args))
      .map((l) => ({ id: l.id, title: l.title, body: l.body, link: l.link || null, audience: JSON.parse(l.audience).text as string, recipients: l.recipients, emailed: l.emailed, read: reads.get(l.id)?.r || 0, sentBy: l.sender || null, at: l.created_at }))
      .filter((l) => hit(l.id, l.title, l.body, l.sentBy, l.audience, l.link));
    json(res, 200, page(req, rows, { at: (l) => -l.at, title: (l) => l.title }));
  });
  api.get('/api/admin/notifications/:id', async (req, res) => {
    const c = await need(req, 'notifications.view'), ids = await reach(c);
    const l = await get<any>('SELECT l.*, u.name sender FROM notification_logs l LEFT JOIN users u ON u.id = l.sent_by WHERE l.id = ?', req.params.id);
    if (!l || (ids && !ids.has(l.sent_by))) throw new HttpError(404, 'Không tìm thấy thông báo');
    const people = await all<any>('SELECT u.id, u.name, u.email, n.read_at FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.broadcast_id = ? ORDER BY n.read_at IS NULL, u.name', l.id);
    json(res, 200, { id: l.id, title: l.title, body: l.body, link: l.link || null, audience: JSON.parse(l.audience).text, recipients: l.recipients, emailed: l.emailed, sentBy: l.sender, at: l.created_at,
      people: people.map((p) => ({ id: p.id, name: p.name, email: p.email, readAt: p.read_at || null })) });
  });
  // Email delivery: every message in the outbox (task notifications, Quản trị's, tests) for the accounts the scope reaches.
  api.get('/api/admin/mail-log', async (req, res) => {
    const c = await need(req, 'notifications.view'), [cond, args] = inSet('m.user_id', await reach(c)), { page: p, size, offset } = paging(req);
    const state = String(req.query.get('state') || ''), q = String(req.query.get('q') || '').trim(), hit = matcher(q);
    const where = `${cond}${state ? ' AND m.state = ?' : ''}`, wargs = [...args, ...(state ? [state] : [])];
    const counts = Object.fromEntries((await all<any>(`SELECT state, COUNT(*) n FROM mail_outbox m WHERE ${cond} GROUP BY state`, ...args)).map((r) => [r.state, Number(r.n)]));
    const mapRow = (r: any) => { const b = JSON.parse(r.payload); return { id: r.id, to: r.name || null, title: b.title || '', state: r.state, attempts: r.attempts, at: r.created_at, sentAt: r.sent_at || null, error: r.error ? scrub(r.error) : null, test: !!b.test }; };
    if (!q) {
      const total = Number((await get<any>(`SELECT COUNT(*) n FROM mail_outbox m WHERE ${where}`, ...wargs))?.n || 0);
      const rows = await all<any>(`SELECT m.id, m.user_id, m.payload, m.state, m.attempts, m.created_at, m.sent_at, m.error, u.name FROM mail_outbox m LEFT JOIN users u ON u.id = m.user_id WHERE ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, ...wargs, size, offset);
      json(res, 200, { items: rows.map(mapRow), total, page: p, size, counts, sender: !!(await getSetting('notification_mail', null)) });
      return;
    }
    const allRows = (await all<any>(`SELECT m.id, m.user_id, m.payload, m.state, m.attempts, m.created_at, m.sent_at, m.error, u.name, u.email FROM mail_outbox m LEFT JOIN users u ON u.id = m.user_id WHERE ${where} ORDER BY m.created_at DESC LIMIT 10000`, ...wargs))
      .map((r) => ({ ...mapRow(r), email: r.email || '' }))
      .filter((r) => hit(r.to, r.email, r.title, r.state, r.error));
    json(res, 200, { items: allRows.slice(offset, offset + size), total: allRows.length, page: p, size, counts, sender: !!(await getSetting('notification_mail', null)) });
  });

  // ---------------------------------------------------------------- templates
  const tplOut = (t: any) => ({ id: t.id, name: t.name, title: t.title, body: t.body, link: t.link || '', createdBy: t.created_name || null, updatedBy: t.updated_name || null, createdAt: t.created_at, updatedAt: t.updated_at });
  const TPL = 'SELECT t.*, a.name created_name, b.name updated_name FROM notification_templates t LEFT JOIN users a ON a.id = t.created_by LEFT JOIN users b ON b.id = t.updated_by WHERE t.deleted_at IS NULL';
  const mustTpl = async (id: string) => { const t = await get<any>(`${TPL} AND t.id = ?`, id); if (!t) throw new HttpError(404, 'Không tìm thấy mẫu thông báo'); return t; };
  const fields = (b: any) => ({ name: text(b.name, 80, 'tên mẫu'), title: text(b.title, 150, 'tiêu đề'), body: text(b.body, 2000, 'nội dung', false), link: linkIn(b.link) });
  api.get('/api/admin/notification-templates', async (req, res) => { await need(req, 'notifications.view'); json(res, 200, (await all<any>(`${TPL} ORDER BY t.name`)).map(tplOut)); });
  api.post('/api/admin/notification-templates', async (req, res) => {
    const c = await need(req, 'notifications.manage'), f = fields(await readJson(req)), id = uid('nt_');
    await run('INSERT INTO notification_templates(id, name, title, body, link, created_by, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, f.name, f.title, f.body, f.link, c.user.id, c.user.id, now(), now());
    await changed(c, { action: 'Tạo mẫu thông báo', type: 'notification_template', id, label: f.name, after: f });
    json(res, 201, tplOut(await mustTpl(id)));
  });
  api.put('/api/admin/notification-templates/:id', async (req, res) => {
    const c = await need(req, 'notifications.manage'), old = tplOut(await mustTpl(req.params.id)), f = fields({ ...old, ...(await readJson(req)) });
    await run('UPDATE notification_templates SET name = ?, title = ?, body = ?, link = ?, updated_by = ?, updated_at = ? WHERE id = ?', f.name, f.title, f.body, f.link, c.user.id, now(), old.id);
    await changed(c, { action: 'Sửa mẫu thông báo', type: 'notification_template', id: old.id, label: f.name, before: { name: old.name, title: old.title, body: old.body, link: old.link }, after: f });
    json(res, 200, tplOut(await mustTpl(old.id)));
  });
  api.delete('/api/admin/notification-templates/:id', async (req, res) => {
    const c = await need(req, 'notifications.manage'), t = await mustTpl(req.params.id);
    await run('UPDATE notification_templates SET deleted_at = ?, updated_by = ? WHERE id = ?', now(), c.user.id, t.id);
    await changed(c, { action: 'Xoá mẫu thông báo', type: 'notification_template', id: t.id, label: t.name, before: { name: t.name } });
    json(res, 200, { ok: true });
  });
}
