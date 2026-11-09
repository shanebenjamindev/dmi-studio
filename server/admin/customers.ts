// Khách hàng in Quản trị: the customer records of the Customers page (the same table) that the account's customers.*
// scope reaches (through their owner, the staff member in charge, or a member), with a category, a source, a status, the
// staff member in charge and archiving (an archived customer leaves the Customers page lists). Drive folders and files
// stay on the Customers page.
import { all, get, run, uid, now } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { historyOf } from '../audit';
import { need, reach, text, exists, page, sendCsv, csvDate, changed, logAction, registerDict, matcher, inSet, type Ctx } from './common';
import type { Perm } from '../../shared/permissions';

import {customerStatuses,customerStatus,defaultCustomerStatus} from '../customer-statuses';
import { customerServices } from '../project-services';

/** Every customer with what describes it; `ids`: only those reached through these accounts (null: all). */
export async function customerRows(ids: Set<string> | null) {
  const [own] = inSet('c.created_by', ids), [man] = inSet('c.manager_id', ids), [mem] = inSet('cm.user_id', ids);
  const args = ids === null ? [] : [JSON.stringify([...ids]), JSON.stringify([...ids]), JSON.stringify([...ids])];
  const rows = await all<any>(`SELECT c.id, c.name, c.code, c.contact, c.phone, c.email, c.notes, c.status, c.created_at, c.updated_at, c.archived_at, c.gloc, c.created_by, c.manager_id, c.category_id, c.source_id,
    o.name owner_name, m.name manager_name, cat.name category_name, cat.color category_color, src.name source_name, src.color source_color,
    (SELECT COUNT(*) FROM task_projects p WHERE p.customer_id = c.id) projects,
    (SELECT COUNT(*) FROM tasks t JOIN task_projects p ON p.id = t.project_id WHERE p.customer_id = c.id AND t.stub = 0) tasks
    FROM customers c LEFT JOIN users o ON o.id = c.created_by LEFT JOIN users m ON m.id = c.manager_id LEFT JOIN customer_categories cat ON cat.id = c.category_id LEFT JOIN customer_sources src ON src.id = c.source_id
    WHERE ${ids === null ? '1=1' : `(${own} OR ${man} OR EXISTS(SELECT 1 FROM customer_members cm WHERE cm.customer_id = c.id AND ${mem}))`}`, ...args);
  const needs = await customerServices();
  const tags = new Map<string, { id: string; name: string; color: string }[]>();
  for (const r of await all<any>('SELECT t.customer_id, cc.id, cc.name, cc.color FROM customer_tags t JOIN customer_categories cc ON cc.id = t.tag_id ORDER BY cc.pos, cc.name')) tags.set(r.customer_id, [...(tags.get(r.customer_id) || []), { id: r.id, name: r.name, color: r.color || '#64748b' }]);
  const statusMap = new Map((await customerStatuses()).map((s) => [s.id, s.name]));
  return rows.map((c) => {
    const rowTags = tags.get(c.id) || (c.category_id ? [{ id: c.category_id, name: c.category_name || '', color: c.category_color || '#64748b' }] : []);
    return {
      id: c.id, name: c.name, code: (c.code || null) as string | null, contact: c.contact || '', phone: c.phone || '', email: c.email || '', status: (c.status || null) as string | null,
      statusLabel: c.status ? statusMap.get(c.status) || c.status : '',
      notesPreview: String(c.notes || '').slice(0, 300),
      category: c.category_id ? { id: c.category_id, name: c.category_name || '', color: c.category_color || '#64748b' } : (rowTags[0] || null),
      tags: rowTags,
      source: c.source_id ? { id: c.source_id, name: c.source_name || '', color: c.source_color || '#64748b' } : null,
      owner: c.created_by ? { id: c.created_by, name: c.owner_name || '' } : (c.manager_id ? { id: c.manager_id, name: c.manager_name || '' } : null),
      manager: c.manager_id ? { id: c.manager_id, name: c.manager_name || '' } : (c.created_by ? { id: c.created_by, name: c.owner_name || '' } : null),
      createdAt: c.created_at, updatedAt: c.updated_at, archivedAt: c.archived_at || null, hasDrive: !!c.gloc,
      needs: needs.get(c.id) || [], projects: Number(c.projects) || 0, tasks: Number(c.tasks) || 0,
    };
  });
}
type Row = Awaited<ReturnType<typeof customerRows>>[number];
const snap = (c: Row & { notes?: string }) => ({ name: c.name, contact: c.contact, phone: c.phone, email: c.email, status: c.status, category: c.category?.name || null, source: c.source?.name || null, manager: c.manager?.name || null, archived: !!c.archivedAt });

/** The customers another of the account's permissions reaches (empty without it). */
async function reachedBy(c: Ctx, perm: Perm) {
  const scope = c.access.perms.get(perm);
  return new Set(scope ? (await customerRows(await reach({ ...c, scope }))).map((x) => x.id) : []);
}
async function mustReach(c: Ctx, id: string) {
  const [row] = (await customerRows(await reach(c))).filter((x) => x.id === id);
  if (!row) throw new HttpError(404, 'Không tìm thấy khách hàng trong phạm vi của bạn');
  return row;
}
/** The staff member in charge: an active account the scope reaches; they get to manage the customer. */
async function managerIn(c: Ctx, v: unknown) {
  const id = await exists('users', v, 'nhân viên phụ trách', ' AND disabled = 0'), ids = await reach(c);
  if (id && ids && !ids.has(id)) throw new HttpError(403, 'Nhân viên phụ trách phải trong phạm vi của bạn');
  return id;
}
const grantManager = (customerId: string, userId: string | null, by: string) => (userId
  ? run('INSERT INTO customer_members(customer_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id, user_id) DO UPDATE SET role = excluded.role', customerId, userId, 'admin', by, now())
  : Promise.resolve());
async function fields(b: any, old?: any) {
  const pick = (k: string, max: number, label: string, required = false) => text(b[k] !== undefined ? b[k] : old?.[k], max, label, required);
  const email = pick('email', 320, 'email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ');
  const phone = pick('phone', 60, 'số điện thoại');
  if (phone && !/^[+0-9 ().\-/]{6,60}$/.test(phone)) throw new HttpError(400, 'Số điện thoại không hợp lệ');
  return {
    name: pick('name', 200, 'tên khách hàng', true), contact: pick('contact', 200, 'người liên hệ'), phone, email, notes: pick('notes', 20000, 'ghi chú'),
    status: !old && b.status === undefined ? await defaultCustomerStatus() : await customerStatus(b.status,old?.status||null),
    category: b.categoryId !== undefined ? await exists('customer_categories', b.categoryId, 'phân loại') : old?.category_id || null,
    source: b.sourceId !== undefined ? await exists('customer_sources', b.sourceId, 'nguồn khách hàng') : old?.source_id || null,
  };
}

export function registerCustomers(api: Router) {
  const filtered = async (c: Ctx, q: URLSearchParams) => {
    const hit = matcher(q.get('q')), archived = q.get('archived') || '0';
    return (await customerRows(await reach(c)))
      .filter((x) => archived === 'all' || (archived === '1' ? !!x.archivedAt : !x.archivedAt))
      .filter((x) => hit(x.id, x.name, x.code, x.contact, x.phone, x.email, x.notesPreview, x.category?.name, x.tags.map((t) => t.name).join(' '), x.source?.name, x.manager?.name, x.owner?.name, x.status, x.statusLabel, x.needs.map((n) => n.name).join(' ')))
      .filter((x) => !q.get('category') || (q.get('category') === 'none' ? !x.category && !x.tags.length : x.category?.id === q.get('category') || x.tags.some((t) => t.id === q.get('category'))))
      .filter((x) => !q.get('source') || (q.get('source') === 'none' ? !x.source : x.source?.id === q.get('source')))
      .filter((x) => !q.get('status') || (q.get('status') === 'none' ? !x.status : x.status === q.get('status')))
      .filter((x) => !q.get('manager') || x.manager?.id === q.get('manager'))
      .filter((x) => !q.get('need') || (q.get('need') === 'none' ? !x.needs.length : x.needs.some((n) => n.id === q.get('need'))));
  };
  api.get('/api/admin/customers', async (req, res) => {
    const c = await need(req, 'customers.view'), rows = await filtered(c, req.query);
    const mayUpdate = await reachedBy(c, 'customers.update'), mayArchive = await reachedBy(c, 'customers.delete');
    const out = page(req, rows, { name: (x) => x.name, updatedAt: (x) => x.updatedAt, createdAt: (x) => x.createdAt, tasks: (x) => x.tasks });
    json(res, 200, { ...out, items: out.items.map((x) => ({ ...x, canEdit: mayUpdate.has(x.id), canArchive: mayArchive.has(x.id) })) });
  });
  api.get('/api/admin/customers/export', async (req, res) => {
    const c = await need(req, 'customers.export'), rows = (await filtered(await need(req, 'customers.view'), req.query)).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    await logAction(c, 'Xuất danh sách khách hàng (CSV)', `${rows.length} khách hàng`, 'customer');
    const statuses=new Map((await customerStatuses()).map(s=>[s.id,s.name]));
    sendCsv(res, 'khach-hang.csv', [['Tên', 'Người liên hệ', 'Điện thoại', 'Email', 'Dịch vụ', 'Phân loại', 'Nguồn', 'Trạng thái', 'Phụ trách', 'Người tạo', 'Dự án', 'Công việc', 'Ngày tạo', 'Lưu trữ'],
      ...rows.map((x) => [x.name, x.contact, x.phone, x.email, x.needs.map((n) => n.name).join('; '), x.category?.name, x.source?.name, x.status ? statuses.get(x.status)||x.status : '', x.manager?.name, x.owner?.name, x.projects, x.tasks, csvDate(x.createdAt), x.archivedAt ? csvDate(x.archivedAt) : ''])]);
  });
  api.get('/api/admin/customers/:id', async (req, res) => {
    const c = await need(req, 'customers.view'), x = await mustReach(c, req.params.id);
    const notes = (await get<any>('SELECT notes FROM customers WHERE id = ?', x.id))?.notes || '';
    json(res, 200, {
      ...x, notes,
      members: (await all<any>('SELECT u.id, u.name, m.role FROM customer_members m JOIN users u ON u.id = m.user_id WHERE m.customer_id = ? ORDER BY u.name', x.id)).map((m) => ({ id: m.id, name: m.name, level: m.role })),
      history: (await historyOf('customer', x.id, 50)).map((h) => ({ action: h.action, by: h.user_name, before: h.old_data ? JSON.parse(h.old_data) : null, after: h.new_data ? JSON.parse(h.new_data) : null, at: h.created_at })),
      canEdit: (await reachedBy(c, 'customers.update')).has(x.id), canArchive: (await reachedBy(c, 'customers.delete')).has(x.id),
    });
  });
  // Kept in the database only, like the Customers page's "database only" customers: no Drive folder is made.
  api.post('/api/admin/customers', async (req, res) => {
    const c = await need(req, 'customers.create'), b = await readJson(req), f = await fields(b), manager = await managerIn(c, b.managerId), id = uid('c_');
    await run('INSERT INTO customers(id, name, contact, phone, email, notes, links, folder, created_by, status, category_id, source_id, manager_id, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, f.name, f.contact, f.phone, f.email, f.notes, '[]', '', c.user.id, f.status, f.category, f.source, manager, c.user.id, now(), now());
    if (f.category) await run('INSERT OR IGNORE INTO customer_tags(customer_id, tag_id, created_at) VALUES(?,?,?)', id, f.category, now());
    if (manager && manager !== c.user.id) await grantManager(id, manager, c.user.id);
    const made = (await customerRows(null)).find((x) => x.id === id)!;
    await changed(c, { action: 'Thêm khách hàng', type: 'customer', id, label: f.name, after: snap(made) });
    json(res, 201, made);
  });
  api.put('/api/admin/customers/:id', async (req, res) => {
    const c = await need(req, 'customers.update'), x = await mustReach(c, req.params.id), b = await readJson(req);
    const old = await get<any>('SELECT * FROM customers WHERE id = ?', x.id), f = await fields(b, old);
    const manager = b.managerId !== undefined ? await managerIn(c, b.managerId) : old.manager_id || null;
    await run('UPDATE customers SET name = ?, contact = ?, phone = ?, email = ?, notes = ?, status = ?, category_id = ?, source_id = ?, manager_id = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      f.name, f.contact, f.phone, f.email, f.notes, f.status, f.category, f.source, manager, c.user.id, now(), x.id);
    if (b.categoryId !== undefined) {
      await run('DELETE FROM customer_tags WHERE customer_id = ?', x.id);
      if (f.category) await run('INSERT OR IGNORE INTO customer_tags(customer_id, tag_id, created_at) VALUES(?,?,?)', x.id, f.category, now());
    }
    if (manager && manager !== old.manager_id && manager !== old.created_by) await grantManager(x.id, manager, c.user.id);
    const after = (await customerRows(null)).find((r) => r.id === x.id)!;
    await changed(c, { action: 'Sửa khách hàng', type: 'customer', id: x.id, label: f.name, before: { ...snap(x), notes: old.notes ? '(ẩn)' : null }, after: { ...snap(after), notes: f.notes === (old.notes || '') ? (old.notes ? '(ẩn)' : null) : '(đã đổi)' } });
    json(res, 200, after);
  });
  api.post('/api/admin/customers/:id/archive', async (req, res) => {
    const c = await need(req, 'customers.delete'), x = await mustReach(c, req.params.id), archive = !!(await readJson(req)).archived;
    await run('UPDATE customers SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ?', archive ? now() : null, c.user.id, now(), x.id);
    await changed(c, { action: archive ? 'Lưu trữ khách hàng' : 'Khôi phục khách hàng', type: 'customer', id: x.id, label: x.name, before: { archived: !!x.archivedAt }, after: { archived: archive } });
    json(res, 200, { ok: true });
  });
  const removeCustomer = async (c: Ctx, x: Row) => {
    await run('UPDATE projects SET customer_id = NULL WHERE customer_id = ?', x.id);
    await run('UPDATE task_projects SET customer_id = NULL WHERE customer_id = ?', x.id);
    await run('UPDATE reports SET customer_id = NULL WHERE customer_id = ?', x.id);
    await run('UPDATE board_cards SET customer_id = NULL WHERE customer_id = ?', x.id);
    await run('UPDATE boards SET customer_id = NULL WHERE customer_id = ?', x.id); // its boards become unclassified
    await run('UPDATE card_attachments SET customer_id = NULL, file_key = NULL WHERE customer_id = ?', x.id);
    await run('DELETE FROM customer_tags WHERE customer_id = ?', x.id);
    await run('DELETE FROM customer_needs WHERE customer_id = ?', x.id);
    await run('DELETE FROM customer_members WHERE customer_id = ?', x.id);
    await run('DELETE FROM customers WHERE id = ?', x.id);
    await changed(c, { action: 'Xoá khách hàng', type: 'customer', id: x.id, label: x.name, before: snap(x) });
  };
  api.delete('/api/admin/customers/:id', async (req, res) => {
    const c = await need(req, 'customers.delete'), x = await mustReach(c, req.params.id);
    await removeCustomer(c, x);
    json(res, 200, { ok: true });
  });
  api.post('/api/admin/customers/bulk-delete', async (req, res) => {
    const c = await need(req, 'customers.delete'), b = await readJson(req);
    const ids = Array.isArray(b.ids) ? [...new Set<string>(b.ids.filter((id: unknown) => typeof id === 'string' && id))] : [];
    if (!ids.length || ids.length > 200) throw new HttpError(400, 'Hãy chọn từ 1 đến 200 khách hàng để xoá');
    const reachable = new Map((await customerRows(await reach(c))).map((x) => [x.id, x]));
    let deleted = 0;
    for (const id of ids) {
      const x = reachable.get(id);
      if (!x) continue;
      await removeCustomer(c, x);
      deleted++;
    }
    json(res, 200, { ok: true, deleted });
  });

  registerDict(api, { path: 'customer-statuses', strictOrder:true, table: 'customer_statuses', type: 'customer_status', label: 'trạng thái khách hàng', view: 'customers.view', manage: 'customers.manage', usedIn: [{table:'customers',column:'status'}] });
  registerDict(api, { path: 'customer-categories', table: 'customer_categories', type: 'customer_category', label: 'phân loại khách hàng', view: 'customers.view', manage: 'customers.manage', usedIn: [{ table: 'customers', column: 'category_id' }, { table: 'customer_tags', column: 'tag_id' }] });
  registerDict(api, { path: 'customer-sources', table: 'customer_sources', type: 'customer_source', label: 'nguồn khách hàng', view: 'customers.view', manage: 'customers.manage', usedIn: [{ table: 'customers', column: 'source_id' }] });
}
