// Hỗ trợ lập trình viên (Developer Support):
// Users submit feedback/bug reports/feature requests directly to developer Dylan (phone 0962099349 VN).
import { all, get, run, uid, now } from './db';
import { HttpError, json, readJson, type Router } from './http';
import { currentUser } from './auth';
import { need, page, fold } from './admin/common';

export interface SupportTicketRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  message: string;
  status: 'pending' | 'resolved';
  createdAt: number;
  /** How many screenshots came with it (they load on their own, GET /api/admin/support/:id/images). */
  images: number;
}
/** A screenshot: a PNG, JPEG or WebP picture as a data URL, made small by the dialog. */
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const pictures = (v: string | null) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a as string[] : []; } catch { return []; } };

export function registerSupport(api: Router) {
  // Public endpoint for logged-in users to submit support requests.
  // The sender only enters the message; name and email are automatically bound.
  api.post('/api/support', async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Hãy đăng nhập');
    const b = await readJson(req);
    const message = String(b.message || '').trim();
    // Up to three screenshots (pasted or chosen, made small by the dialog); together under 1.8 MB, as a D1 row holds 2 MB.
    const images = b.images === undefined ? [] : b.images;
    if (!Array.isArray(images) || images.length > 3 || images.some((x) => typeof x !== 'string' || !PICTURE.test(x))) throw new HttpError(400, 'Tối đa 3 ảnh PNG, JPEG hoặc WebP');
    if (images.reduce((n: number, x: string) => n + x.length, 0) > 1_800_000) throw new HttpError(400, 'Ảnh quá lớn: hãy bớt ảnh hoặc chụp vùng nhỏ hơn');
    if (!message && !images.length) throw new HttpError(400, 'Hãy nhập nội dung cần nói với người phát triển');
    if (message.length > 5000) throw new HttpError(400, 'Nội dung tối đa 5000 ký tự');
    const id = uid('sup_');
    await run(
      'INSERT INTO support_tickets (id, user_id, user_name, user_email, message, status, created_at, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, user.id, user.name, user.email || null, message, 'pending', now(), images.length ? JSON.stringify(images) : null
    );
    json(res, 201, { ok: true, id });
  });

  // Admin endpoint: list support tickets
  api.get('/api/admin/support', async (req, res) => {
    await need(req, 'settings.view');
    const status = req.query.get('status');
    const q = fold(String(req.query.get('q') || '').trim());
    const rows = (await all<any>("SELECT id, user_id, user_name, user_email, message, status, created_at, json_array_length(COALESCE(images, '[]')) images FROM support_tickets ORDER BY created_at DESC")).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email || null,
      message: r.message,
      status: r.status as 'pending' | 'resolved',
      createdAt: r.created_at,
      images: Number(r.images) || 0,
    }));
    const filtered = rows.filter((r) => {
      if (status && status !== 'all' && r.status !== status) return false;
      if (q) {
        const text = fold(`${r.userName} ${r.userEmail || ''} ${r.message}`);
        if (!q.split(/\s+/).every((w) => text.includes(w))) return false;
      }
      return true;
    });
    json(res, 200, page(req, filtered, {
      createdAt: (r) => r.createdAt,
      userName: (r) => r.userName,
      status: (r) => r.status,
    }));
  });

  // Admin endpoint: a ticket's screenshots
  api.get('/api/admin/support/:id/images', async (req, res) => {
    await need(req, 'settings.view');
    const row = await get<any>('SELECT images FROM support_tickets WHERE id = ?', req.params.id);
    if (!row) throw new HttpError(404, 'Không tìm thấy yêu cầu hỗ trợ');
    json(res, 200, pictures(row.images));
  });

  // Admin endpoint: update ticket status
  api.put('/api/admin/support/:id', async (req, res) => {
    await need(req, 'settings.view');
    const b = await readJson(req);
    const status = String(b.status || '').trim();
    if (!['pending', 'resolved'].includes(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
    const row = await get<any>('SELECT id FROM support_tickets WHERE id = ?', req.params.id);
    if (!row) throw new HttpError(404, 'Không tìm thấy yêu cầu hỗ trợ');
    await run('UPDATE support_tickets SET status = ? WHERE id = ?', status, req.params.id);
    json(res, 200, { ok: true });
  });

  // Admin endpoint: delete ticket
  api.delete('/api/admin/support/:id', async (req, res) => {
    await need(req, 'settings.view');
    const row = await get<any>('SELECT id FROM support_tickets WHERE id = ?', req.params.id);
    if (!row) throw new HttpError(404, 'Không tìm thấy yêu cầu hỗ trợ');
    await run('DELETE FROM support_tickets WHERE id = ?', req.params.id);
    json(res, 200, { ok: true });
  });
}

