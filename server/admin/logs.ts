// Nhật ký hệ thống, read only: sign-ins, changes made, data changed field by field, permission changes and server errors
// (written by server/audit.ts). People see the entries of the accounts their logs.view scope reaches. There is no API
// to edit or delete an entry.
import { all, get } from '../db';
import { HttpError, json, type Req, type Router } from '../http';
import { need, reach, inSet, paging, sendCsv, csvDate, logAction, matcher, type Ctx } from './common';

const KINDS = ['login', 'action', 'data', 'permission', 'error'] as const;
type Kind = (typeof KINDS)[number];
const ENTITY_WORDS: Record<string, string> = {
  user: 'Nhân viên User Staff', role: 'Vai trò Role', task: 'Công việc Task', task_status: 'Trạng thái công việc',
  task_label: 'Danh mục công việc', task_priority: 'Mức ưu tiên', task_template: 'Mẫu công việc',
  customer: 'Khách hàng Customer Client', customer_category: 'Phân loại khách hàng Tag', customer_source: 'Nguồn khách hàng',
  customer_status: 'Trạng thái khách hàng', service: 'Dịch vụ Service', service_category: 'Danh mục dịch vụ',
  service_package: 'Gói dịch vụ', team: 'Nhóm Team', department: 'Phòng ban Department',
  notification: 'Thông báo Notification', notification_template: 'Mẫu thông báo', settings: 'Cấu hình Settings',
  backup: 'Sao lưu Backup', stats: 'Thống kê Stats', log: 'Nhật ký Log',
};

/** The WHERE clause and its values for a log query from the request's filters; `p`: the table's alias, if any. */
async function filters(c: Ctx, req: Req, kind: Kind, p = '') {
  const q = req.query, where: string[] = [], args: (string | number)[] = [];
  const [scope, scopeArgs] = inSet(`${p}user_id`, await reach(c));
  where.push(scope); args.push(...scopeArgs);
  if (kind !== 'login') { where.push('kind = ?'); args.push(kind); }
  const from = Number(q.get('from')), to = Number(q.get('to'));
  if (from > 0) { where.push(`${p}created_at >= ?`); args.push(from); }
  if (to > 0) { where.push(`${p}created_at < ?`); args.push(to); }
  if (q.get('user')) { where.push(`${p}user_id = ?`); args.push(String(q.get('user'))); }
  if (kind === 'login' && q.get('result')) { where.push(`${p}ok = ?`); args.push(q.get('result') === 'ok' ? 1 : 0); }
  if (kind !== 'login' && q.get('entity')) { where.push('entity_type = ?'); args.push(String(q.get('entity'))); }
  if (kind !== 'login' && q.get('entityId')) { where.push('entity_id = ?'); args.push(String(q.get('entityId'))); }
  return { sql: where.join(' AND '), args };
}
const rowHit = (kind: Kind, q: string | null) => {
  const hit = matcher(q);
  return (r: any) => kind === 'login'
    ? hit(r.id, r.email, r.user_name, r.reason, r.ip, r.method, r.agent, r.ok ? 'Thành công Success OK' : 'Thất bại Failed Error')
    : hit(r.id, r.action, r.entity_label, r.entity_type, ENTITY_WORDS[r.entity_type], r.entity_id, r.user_name, r.path, r.ip, r.method, String(r.status || ''), r.old_data, r.new_data);
};
const kindOf = (req: Req): Kind => {
  const k = String(req.query.get('kind') || 'action') as Kind;
  if (!KINDS.includes(k)) throw new HttpError(400, 'Loại nhật ký không hợp lệ');
  return k;
};
const out = (kind: Kind, r: any) => kind === 'login'
  ? { id: r.id, userId: r.user_id, userName: r.user_name || null, email: r.email, ok: !!r.ok, method: r.method, reason: r.reason, ip: r.ip, agent: r.agent, at: r.created_at }
  : { id: r.id, kind: r.kind, action: r.action, userId: r.user_id, userName: r.user_name, entityType: r.entity_type, entityId: r.entity_id, entityLabel: r.entity_label, method: r.method, path: r.path,
      status: r.status, before: r.old_data ? JSON.parse(r.old_data) : null, after: r.new_data ? JSON.parse(r.new_data) : null, ip: r.ip, agent: r.agent, at: r.created_at };
const select = (kind: Kind) => (kind === 'login' ? 'SELECT l.*, u.name user_name FROM login_logs l LEFT JOIN users u ON u.id = l.user_id' : 'SELECT * FROM audit_logs');
const table = (kind: Kind) => (kind === 'login' ? 'login_logs' : 'audit_logs');
const alias = (kind: Kind) => (kind === 'login' ? 'l.' : '');

export function registerLogs(api: Router) {
  api.get('/api/admin/logs', async (req, res) => {
    const c = await need(req, 'logs.view'), kind = kindOf(req), f = await filters(c, req, kind, alias(kind)), { page, size, offset } = paging(req);
    const q = String(req.query.get('q') || '').trim();
    let total = 0, rows: any[] = [];
    if (!q) {
      total = Number((await get<any>(`SELECT COUNT(*) n FROM ${table(kind)} ${alias(kind).slice(0, -1)} WHERE ${f.sql}`, ...f.args))?.n || 0);
      rows = await all<any>(`${select(kind)} WHERE ${f.sql} ORDER BY ${alias(kind)}created_at DESC LIMIT ? OFFSET ?`, ...f.args, size, offset);
    } else {
      const matched = (await all<any>(`${select(kind)} WHERE ${f.sql} ORDER BY ${alias(kind)}created_at DESC LIMIT 20000`, ...f.args)).filter(rowHit(kind, q));
      total = matched.length;
      rows = matched.slice(offset, offset + size);
    }
    // The oldest entry kept, so the page can say from when its numbers start.
    const since = Number((await get<any>(`SELECT MIN(created_at) n FROM ${table(kind)}`))?.n) || null;
    json(res, 200, { items: rows.map((r) => out(kind, r)), total, page, size, since });
  });
  api.get('/api/admin/logs/export', async (req, res) => {
    const c = await need(req, 'logs.export'), view = await need(req, 'logs.view'), kind = kindOf(req), f = await filters(view, req, kind, alias(kind));
    const q = String(req.query.get('q') || '').trim();
    const rows = (await all<any>(`${select(kind)} WHERE ${f.sql} ORDER BY ${alias(kind)}created_at DESC LIMIT 20000`, ...f.args)).filter(rowHit(kind, q)).map((r) => out(kind, r) as any);
    await logAction(c, `Xuất nhật ký (${kind}, CSV)`, `${rows.length} dòng`, 'log');
    sendCsv(res, `nhat-ky-${kind}.csv`, kind === 'login'
      ? [['Thời gian', 'Email', 'Người dùng', 'Kết quả', 'Cách đăng nhập', 'Lý do', 'IP', 'Trình duyệt'], ...rows.map((r) => [csvDate(r.at), r.email, r.userName, r.ok ? 'Thành công' : 'Thất bại', r.method, r.reason, r.ip, r.agent])]
      : [['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Mã đối tượng', 'Trước', 'Sau', 'Kết quả', 'IP'], ...rows.map((r) => [csvDate(r.at), r.userName, r.action, r.entityLabel || r.entityType, r.entityId, r.before ? JSON.stringify(r.before) : '', r.after ? JSON.stringify(r.after) : '', r.status, r.ip])]);
  });
}
