// Ghi chú nhanh: each account's own sticky notes (formatted text, a colour, where its window sits and whether it is
// open). Only their writer reads or changes them, wherever they sign in; Quản trị and the logs never see them.
import { all, get, run, uid, now } from './db';
import { HttpError, json, readJson, type Router, type Req } from './http';
import { currentUser } from './auth';

const COLORS = ['yellow', 'green', 'pink', 'purple', 'blue', 'dark'];
const MAX_BODY = 600 * 1024, MAX_NOTES = 500;
/** The words of a note, for its title, preview and search (pictures and formatting left out). */
const plain = (html: string) => html.replace(/<\/?(br|p|div|li|h[12]|ul|ol|pre|blockquote)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const out = (n: any, body = false) => {
  const lines = plain(n.body).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { id: n.id, title: lines[0] || '', preview: lines.slice(1).join(' ').slice(0, 160), color: n.color, open: !!n.open, x: n.x ?? null, y: n.y ?? null, w: n.w ?? null, h: n.h ?? null,
    hasImage: /<img\b/i.test(n.body), createdAt: n.created_at, updatedAt: n.updated_at, ...(body ? { body: n.body } : {}) };
};
const me = async (req: Req) => (await currentUser(req))!.id;
async function mine(req: Req) {
  const n = await get<any>('SELECT * FROM quick_notes WHERE id = ? AND user_id = ?', req.params.id, await me(req));
  if (!n) throw new HttpError(404, 'Không tìm thấy ghi chú');
  return n;
}
const pos = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Math.max(-2000, Math.min(20000, Math.round(Number(v)))) : null);

export function registerQuickNotes(api: Router) {
  api.get('/api/quick-notes', async (req, res) => {
    // Without marks either side: “gui bao gia” finds “Gửi báo giá”.
    const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
    const term = fold(String(req.query.get('q') || '').trim());
    // In the order they were dragged into (new ones first); never dragged: the latest changed first.
    const rows = (await all<any>('SELECT * FROM quick_notes WHERE user_id = ? ORDER BY pos, updated_at DESC', await me(req))).map((n) => ({ n, text: fold(plain(n.body)) }));
    json(res, 200, rows.filter((r) => !term || term.split(/\s+/).every((w) => r.text.includes(w))).map((r) => out(r.n)));
  });
  api.get('/api/quick-notes/:id', async (req, res) => json(res, 200, out(await mine(req), true)));
  api.post('/api/quick-notes', async (req, res) => {
    const user = await me(req), b = await readJson(req);
    if (Number((await get<any>('SELECT COUNT(*) n FROM quick_notes WHERE user_id = ?', user))?.n) >= MAX_NOTES) throw new HttpError(400, `Tối đa ${MAX_NOTES} ghi chú; hãy xoá bớt ghi chú cũ`);
    const id = uid('qn_'), first = (await get<any>('SELECT MIN(pos) m FROM quick_notes WHERE user_id = ?', user))?.m;
    await run('INSERT INTO quick_notes(id, user_id, body, color, open, x, y, w, h, pos, created_at, updated_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?)',
      id, user, '', COLORS.includes(b.color) ? b.color : 'yellow', pos(b.x), pos(b.y), pos(b.w), pos(b.h), first === null || first === undefined ? null : Number(first) - 1, now(), now());
    json(res, 201, out(await get('SELECT * FROM quick_notes WHERE id = ?', id), true));
  });
  // The order the list was dragged into: every note of the account, first to last (others' ids are ignored).
  api.put('/api/quick-notes/order', async (req, res) => {
    const b = await readJson(req);
    if (!Array.isArray(b.ids) || b.ids.length > MAX_NOTES || b.ids.some((x: unknown) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách ghi chú không hợp lệ');
    const ids = JSON.stringify(b.ids);
    const user = await me(req);
    await run('UPDATE quick_notes SET pos = (SELECT CAST(key AS REAL) FROM json_each(?) WHERE value = quick_notes.id) WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))', ids, user, ids);
    // One made elsewhere since this list was loaded keeps its place at the top, before the dragged ones.
    await run('UPDATE quick_notes SET pos = -1 WHERE user_id = ? AND pos IS NULL', user);
    json(res, 200, { ok: true });
  });
  // Saves what changed: the text (as edited), the colour, the window (position, size, open or closed).
  api.put('/api/quick-notes/:id', async (req, res) => {
    const n = await mine(req), b = await readJson(req);
    if (b.body !== undefined && (typeof b.body !== 'string' || Buffer.byteLength(b.body) > MAX_BODY)) throw new HttpError(413, 'Ghi chú quá lớn (tối đa 600 KB); hãy bớt ảnh');
    if (b.color !== undefined && !COLORS.includes(b.color)) throw new HttpError(400, 'Màu không hợp lệ');
    const body = b.body ?? n.body, touched = b.body !== undefined && b.body !== n.body;
    await run('UPDATE quick_notes SET body = ?, color = ?, open = ?, x = ?, y = ?, w = ?, h = ?, updated_at = ? WHERE id = ?',
      body, b.color ?? n.color, b.open !== undefined ? (b.open ? 1 : 0) : n.open, b.x !== undefined ? pos(b.x) : n.x, b.y !== undefined ? pos(b.y) : n.y,
      b.w !== undefined ? pos(b.w) : n.w, b.h !== undefined ? pos(b.h) : n.h, touched || b.color !== undefined ? now() : n.updated_at, n.id);
    json(res, 200, out(await get('SELECT * FROM quick_notes WHERE id = ?', n.id)));
  });
  api.delete('/api/quick-notes/:id', async (req, res) => {
    const n = await mine(req);
    await run('DELETE FROM quick_notes WHERE id = ?', n.id);
    json(res, 200, { ok: true });
  });
  // Several at once (Chọn nhiều): only the account's own are touched.
  api.post('/api/quick-notes/delete', async (req, res) => {
    const b = await readJson(req);
    if (!Array.isArray(b.ids) || b.ids.length > MAX_NOTES || b.ids.some((x: unknown) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách ghi chú không hợp lệ');
    const r = await run('DELETE FROM quick_notes WHERE user_id = ? AND id IN (SELECT value FROM json_each(?))', await me(req), JSON.stringify(b.ids));
    json(res, 200, { deleted: r.changes });
  });
}
