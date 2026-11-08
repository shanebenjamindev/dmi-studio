// Dịch vụ: the company's catalogue of services (name, code, category, description, picture, price, status) and the
// packages that bundle them. Not the Meta Ads report rows (ads_services), which are a different thing. Removing a service
// or package keeps it in the database (deleted_at) so who changed what stays readable.
import { all, get, run, uid, now } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { need, text, amount, oneOf, exists, changed, registerDict, matcher, page } from './common';

const STATUS = ['active', 'inactive', 'draft'] as const;
const CURRENCIES = ['VND', 'USD'] as const;
/** A picture link: https only (or nothing). */
const imageIn = (v: unknown) => { const s = text(v, 1000, 'link ảnh', false); if (s && !/^https:\/\/[^\s"'<>]+$/.test(s)) throw new HttpError(400, 'Link ảnh phải bắt đầu bằng https://'); return s || null; };

const SERVICE_SQL = `SELECT s.*, c.name category_name, c.color category_color, a.name created_name, b.name updated_name,
  (SELECT COUNT(*) FROM service_package_items i JOIN service_packages p ON p.id = i.package_id AND p.deleted_at IS NULL WHERE i.service_id = s.id) packages
  FROM services s LEFT JOIN service_categories c ON c.id = s.category_id LEFT JOIN users a ON a.id = s.created_by LEFT JOIN users b ON b.id = s.updated_by WHERE s.deleted_at IS NULL`;
const serviceOut = (s: any) => ({
  id: s.id, name: s.name, code: s.code || '', about: s.about, image: s.image || null, price: s.price ?? null, currency: s.currency, unit: s.unit, status: s.status,
  category: s.category_id ? { id: s.category_id, name: s.category_name || '', color: s.category_color || '#64748b' } : null, packages: Number(s.packages) || 0,
  createdBy: s.created_name || null, updatedBy: s.updated_name || null, createdAt: s.created_at, updatedAt: s.updated_at,
});
const mustService = async (id: string) => { const s = await get<any>(`${SERVICE_SQL} AND s.id = ?`, id); if (!s) throw new HttpError(404, 'Không tìm thấy dịch vụ'); return s; };
async function serviceFields(b: any, id = '') {
  const code = text(b.code, 40, 'mã dịch vụ', false);
  if (code && await get('SELECT 1 FROM services WHERE code = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?', code, id)) throw new HttpError(409, `Mã “${code}” đã được dùng`);
  return {
    name: text(b.name, 200, 'tên dịch vụ'), code: code || null, about: text(b.about, 5000, 'mô tả', false), image: imageIn(b.image), price: amount(b.price, 'Giá'),
    currency: oneOf(b.currency, CURRENCIES, 'Tiền tệ', 'VND'), unit: text(b.unit, 40, 'đơn vị', false), status: oneOf(b.status, STATUS, 'Trạng thái', 'active'),
    category: await exists('service_categories', b.categoryId, 'danh mục dịch vụ'),
  };
}
const serviceSnap = (s: ReturnType<typeof serviceOut>) => ({ name: s.name, code: s.code, category: s.category?.name || null, price: s.price, currency: s.currency, unit: s.unit, status: s.status, image: s.image });

const PACKAGE_SQL = 'SELECT p.*, a.name created_name, b.name updated_name FROM service_packages p LEFT JOIN users a ON a.id = p.created_by LEFT JOIN users b ON b.id = p.updated_by WHERE p.deleted_at IS NULL';
const packageOut = async (p: any) => ({
  id: p.id, name: p.name, about: p.about, price: p.price ?? null, currency: p.currency, term: p.term, status: p.status,
  items: (await all<any>('SELECT i.service_id, i.qty, s.name, s.price, s.currency, s.deleted_at FROM service_package_items i JOIN services s ON s.id = i.service_id WHERE i.package_id = ? ORDER BY s.name', p.id))
    .map((i) => ({ serviceId: i.service_id, name: i.name, qty: i.qty, price: i.price ?? null, currency: i.currency, removed: !!i.deleted_at })),
  createdBy: p.created_name || null, updatedBy: p.updated_name || null, createdAt: p.created_at, updatedAt: p.updated_at,
});
const mustPackage = async (id: string) => { const p = await get<any>(`${PACKAGE_SQL} AND p.id = ?`, id); if (!p) throw new HttpError(404, 'Không tìm thấy gói dịch vụ'); return p; };
async function packageFields(b: any) {
  if (!Array.isArray(b.items) || b.items.length > 50) throw new HttpError(400, 'Gói có tối đa 50 dịch vụ');
  const items = new Map<string, number>();
  for (const i of b.items) {
    const qty = Math.round(Number(i?.qty ?? 1));
    if (!Number.isFinite(qty) || qty < 1 || qty > 1000) throw new HttpError(400, 'Số lượng mỗi dịch vụ từ 1 đến 1000');
    if (!(await get('SELECT 1 FROM services WHERE id = ? AND deleted_at IS NULL', String(i?.serviceId)))) throw new HttpError(400, 'Không tìm thấy dịch vụ trong gói');
    items.set(String(i.serviceId), qty);
  }
  return { name: text(b.name, 200, 'tên gói'), about: text(b.about, 5000, 'mô tả', false), price: amount(b.price, 'Giá gói'), currency: oneOf(b.currency, CURRENCIES, 'Tiền tệ', 'VND'),
    term: text(b.term, 60, 'thời hạn gói', false), status: oneOf(b.status, STATUS, 'Trạng thái', 'active'), items };
}
async function saveItems(id: string, items: Map<string, number>) {
  await run('DELETE FROM service_package_items WHERE package_id = ?', id);
  for (const [s, qty] of items) await run('INSERT INTO service_package_items(package_id, service_id, qty) VALUES(?,?,?)', id, s, qty);
}
const packageSnap = (p: Awaited<ReturnType<typeof packageOut>>) => ({ name: p.name, price: p.price, currency: p.currency, term: p.term, status: p.status, items: p.items.map((i) => `${i.name} × ${i.qty}`).join(', ') });

export function registerServices(api: Router) {
  api.get('/api/admin/services', async (req, res) => {
    await need(req, 'services.view');
    const q = req.query, hit = matcher(q.get('q'));
    const rows = (await all<any>(SERVICE_SQL)).map(serviceOut)
      .filter((s) => hit(s.name, s.code, s.about, s.category?.name))
      .filter((s) => !q.get('category') || (q.get('category') === 'none' ? !s.category : s.category?.id === q.get('category')))
      .filter((s) => !q.get('status') || s.status === q.get('status'));
    json(res, 200, page(req, rows, { name: (s) => s.name, price: (s) => s.price, updatedAt: (s) => s.updatedAt, createdAt: (s) => s.createdAt }));
  });
  api.post('/api/admin/services', async (req, res) => {
    const c = await need(req, 'services.create'), f = await serviceFields(await readJson(req)), id = uid('sv_');
    await run('INSERT INTO services(id, name, code, category_id, about, image, price, currency, unit, status, created_by, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, f.name, f.code, f.category, f.about, f.image, f.price, f.currency, f.unit, f.status, c.user.id, c.user.id, now(), now());
    const s = serviceOut(await mustService(id));
    await changed(c, { action: 'Thêm dịch vụ', type: 'service', id, label: s.name, after: serviceSnap(s) });
    json(res, 201, s);
  });
  api.put('/api/admin/services/:id', async (req, res) => {
    const c = await need(req, 'services.update'), old = serviceOut(await mustService(req.params.id));
    const f = await serviceFields({ ...old, categoryId: old.category?.id || null, ...(await readJson(req)) }, old.id);
    await run('UPDATE services SET name = ?, code = ?, category_id = ?, about = ?, image = ?, price = ?, currency = ?, unit = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      f.name, f.code, f.category, f.about, f.image, f.price, f.currency, f.unit, f.status, c.user.id, now(), old.id);
    const s = serviceOut(await mustService(old.id));
    await changed(c, { action: 'Sửa dịch vụ', type: 'service', id: s.id, label: s.name, before: serviceSnap(old), after: serviceSnap(s) });
    json(res, 200, s);
  });
  api.delete('/api/admin/services/:id', async (req, res) => {
    const c = await need(req, 'services.delete'), s = serviceOut(await mustService(req.params.id));
    await run('UPDATE services SET deleted_at = ?, updated_by = ? WHERE id = ?', now(), c.user.id, s.id);
    await changed(c, { action: 'Xoá dịch vụ', type: 'service', id: s.id, label: s.name, before: serviceSnap(s) });
    json(res, 200, { ok: true, inPackages: s.packages });
  });

  api.get('/api/admin/service-packages', async (req, res) => {
    await need(req, 'services.view');
    json(res, 200, await Promise.all((await all<any>(`${PACKAGE_SQL} ORDER BY p.name`)).map(packageOut)));
  });
  api.post('/api/admin/service-packages', async (req, res) => {
    const c = await need(req, 'services.create'), f = await packageFields(await readJson(req)), id = uid('sp_');
    await run('INSERT INTO service_packages(id, name, about, price, currency, term, status, created_by, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id, f.name, f.about, f.price, f.currency, f.term, f.status, c.user.id, c.user.id, now(), now());
    await saveItems(id, f.items);
    const p = await packageOut(await mustPackage(id));
    await changed(c, { action: 'Thêm gói dịch vụ', type: 'service_package', id, label: p.name, after: packageSnap(p) });
    json(res, 201, p);
  });
  api.put('/api/admin/service-packages/:id', async (req, res) => {
    const c = await need(req, 'services.update'), old = await packageOut(await mustPackage(req.params.id));
    const f = await packageFields({ ...old, items: old.items.filter((i) => !i.removed), ...(await readJson(req)) });
    await run('UPDATE service_packages SET name = ?, about = ?, price = ?, currency = ?, term = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?', f.name, f.about, f.price, f.currency, f.term, f.status, c.user.id, now(), old.id);
    await saveItems(old.id, f.items);
    const p = await packageOut(await mustPackage(old.id));
    await changed(c, { action: 'Sửa gói dịch vụ', type: 'service_package', id: p.id, label: p.name, before: packageSnap(old), after: packageSnap(p) });
    json(res, 200, p);
  });
  api.delete('/api/admin/service-packages/:id', async (req, res) => {
    const c = await need(req, 'services.delete'), p = await packageOut(await mustPackage(req.params.id));
    await run('UPDATE service_packages SET deleted_at = ?, updated_by = ? WHERE id = ?', now(), c.user.id, p.id);
    await changed(c, { action: 'Xoá gói dịch vụ', type: 'service_package', id: p.id, label: p.name, before: packageSnap(p) });
    json(res, 200, { ok: true });
  });

  registerDict(api, { path: 'service-categories', table: 'service_categories', type: 'service_category', label: 'danh mục dịch vụ', view: 'services.view', manage: 'services.update',
    usedIn: [{ table: 'services', column: 'category_id', where: 'deleted_at IS NULL' }] });
}
