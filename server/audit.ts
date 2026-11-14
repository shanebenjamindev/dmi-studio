// Nhật ký hệ thống. login_logs: every sign-in attempt. audit_logs, by kind: 'action' (each change made through the API,
// and refused ones), 'data' (the fields a change altered on a record, before and after), 'permission' (who may do what)
// and 'error' (server faults). No API edits or deletes them; entries older than the retention set in Cấu hình chung go.
// Secrets never enter a log: passwords, task results and descriptions, customer notes and request bodies are left out
// (a changed one shows as changed, without its value), and error messages are scrubbed of addresses and tokens.
import type http from 'node:http';
import { all, get, run, uid, now, getSetting } from './db';
import { IS_CLOUDFLARE } from './config';
import { HttpError, pathOf, type Req, type Res } from './http';

type Who = { id: string; name: string } | null | undefined;
export type AuditKind = 'action' | 'data' | 'permission' | 'error';

/** The visitor's address: Cloudflare's, which a client cannot set, on the cloud; the socket's locally. */
export const clientIp = (req: http.IncomingMessage) => String((IS_CLOUDFLARE ? req.headers['cf-connecting-ip'] : req.socket?.remoteAddress) || '').slice(0, 64) || null;
export const clientAgent = (req: http.IncomingMessage) => String(req.headers['user-agent'] || '').slice(0, 300) || null;

export async function audit(e: { kind: AuditKind; action: string; user?: Who; entityType?: string; entityId?: string | null; entityLabel?: string | null; before?: any; after?: any; status?: number; req?: Req }) {
  await run('INSERT INTO audit_logs(id,kind,action,user_id,user_name,entity_type,entity_id,entity_label,method,path,status,old_data,new_data,ip,agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    uid('al_'), e.kind, e.action.slice(0, 200), e.user?.id || null, e.user?.name || null, e.entityType || null, e.entityId || null, e.entityLabel ? String(e.entityLabel).slice(0, 300) : null,
    e.req?.method || null, e.req?.path || null, e.status ?? null, e.before == null ? null : JSON.stringify(e.before), e.after == null ? null : JSON.stringify(e.after),
    e.req ? clientIp(e.req) : null, e.req ? clientAgent(e.req) : null, now());
  await prune();
}

export async function logLogin(req: http.IncomingMessage, e: { user?: Who; email: string; ok: boolean; method: 'password' | 'google' | 'setup'; reason?: string }) {
  await run('INSERT INTO login_logs(id,user_id,email,ok,method,reason,ip,agent,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    uid('ll_'), e.user?.id || null, e.email.slice(0, 320), e.ok ? 1 : 0, e.method, e.reason?.slice(0, 200) || null, clientIp(req), clientAgent(req), now());
}

export const RETENTION_DEFAULT = 365, RETENTION_MIN = 90;
let prunedAt = 0;
/** At most hourly (per server process): drops entries older than the retention. */
async function prune() {
  if (now() - prunedAt < 3600e3) return;
  prunedAt = now();
  const days = Math.max(RETENTION_MIN, Number(await getSetting('log_retention_days', RETENTION_DEFAULT)) || RETENTION_DEFAULT);
  for (const t of ['audit_logs', 'login_logs']) await run(`DELETE FROM ${t} WHERE created_at < ?`, now() - days * 86400e3);
}

/** Error text without what may identify or unlock something. */
export const scrub = (s: string) => s.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]').replace(/\b(bearer|token|key|secret|password)\b\S*\s*\S+/gi, '$1 […]').replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[…]').slice(0, 300);
export async function logError(req: Req, user: Who, e: any, status: number) {
  try { await audit({ kind: 'error', action: String(e?.name || 'Error').slice(0, 60), user, req, status, after: { message: scrub(String(e?.message || '')) } }); }
  catch { console.error('Không ghi được nhật ký lỗi'); }
}

// ---------------------------------------------------------------- the trail of each change
/** Records whose changes are kept field by field. `hidden`: kept as "changed" only, never their value. */
interface Entity { type: string; table: string; label: string; fields: string[]; hidden?: string[] }
const TASK: Entity = { type: 'task', table: 'tasks', label: 'title', fields: ['title', 'status', 'start_at', 'due_at', 'done_at', 'project_id', 'parent_id', 'campaign_id', 'priority_id'], hidden: ['description', 'result'] };
const CUSTOMER: Entity = { type: 'customer', table: 'customers', label: 'name', fields: ['name', 'contact', 'phone', 'email', 'folder', 'category_id', 'source_id', 'status', 'manager_id', 'archived_at'], hidden: ['notes'] };
const USER: Entity = { type: 'user', table: 'users', label: 'name', fields: ['name', 'email', 'role', 'disabled', 'team_role', 'dept_role', 'phone', 'manager_id'], hidden: ['pass'] };
const CARD: Entity = { type: 'card', table: 'board_cards', label: 'title', fields: ['title', 'list_id', 'start_at', 'due_at', 'done', 'archived', 'customer_id'], hidden: ['description', 'result'] };
const BOARD: Entity = { type: 'board', table: 'boards', label: 'name', fields: ['name', 'private', 'workspace_id', 'role_id'] };
const DEPARTMENT: Entity = { type: 'department', table: 'team_roles', label: 'name', fields: ['name', 'color', 'pages'] };
const POSITION: Entity = { type: 'position', table: 'dept_roles', label: 'name', fields: ['name', 'level', 'team_role_id'] };
const ONE: [RegExp, Entity][] = [
  [/^\/api\/tasks\/(tk_[^/]+)$/, TASK], [/^\/api\/customers\/(c_[^/]+)(?:\/record|\/folder)?$/, CUSTOMER], [/^\/api\/users\/([^/]+)$/, USER], [/^\/api\/cards\/([^/]+)$/, CARD],
  [/^\/api\/boards\/([^/]+)$/, BOARD], [/^\/api\/roles\/([^/]+)$/, DEPARTMENT], [/^\/api\/positions\/([^/]+)$/, POSITION],
];
/** Creations, whose new record's id comes back in the answer. */
const MADE: [RegExp, Entity][] = [[/^\/api\/tasks$/, TASK], [/^\/api\/customers$/, CUSTOMER], [/^\/api\/users$/, USER], [/^\/api\/lists\/[^/]+\/cards$/, CARD], [/^\/api\/boards$/, BOARD], [/^\/api\/roles$/, DEPARTMENT], [/^\/api\/roles\/[^/]+\/positions$/, POSITION]];

/** What a change is called in Lịch sử thao tác (the first that matches); others show their method and address. */
const LABELS: [string, RegExp, string][] = [
  ['POST', /^\/api\/auth\/logout$/, 'Đăng xuất'], ['PUT', /^\/api\/auth\/password$/, 'Đổi mật khẩu của mình'], ['PUT', /^\/api\/auth\/profile$/, 'Sửa hồ sơ của mình'],
  ['POST', /^\/api\/users$/, 'Thêm nhân viên'], ['PUT', /^\/api\/users\//, 'Sửa nhân viên'], ['DELETE', /^\/api\/users\//, 'Xoá nhân viên'],
  ['POST', /^\/api\/roles\/[^/]+\/positions$/, 'Thêm chức vụ'], ['PUT', /^\/api\/positions\//, 'Sửa chức vụ'], ['DELETE', /^\/api\/positions\//, 'Xoá chức vụ'],
  ['POST', /^\/api\/roles$/, 'Thêm phòng ban'], ['PUT', /^\/api\/roles\//, 'Sửa phòng ban'], ['DELETE', /^\/api\/roles\//, 'Xoá phòng ban'], ['PUT', /^\/api\/access$/, 'Đổi trang người chưa có phòng ban được mở'],
  ['POST', /^\/api\/tasks\/import$/, 'Nhập công việc từ file'], ['POST', /^\/api\/tasks$/, 'Tạo công việc'], ['PUT', /^\/api\/tasks\/[^/]+$/, 'Sửa công việc'], ['DELETE', /^\/api\/tasks\/[^/]+$/, 'Xoá công việc'],
  ['POST', /^\/api\/tasks\/[^/]+\/card$/, 'Liên kết công việc với thẻ'], ['DELETE', /^\/api\/tasks\/[^/]+\/card$/, 'Bỏ liên kết công việc với thẻ'],
  ['PUT', /^\/api\/customers\/[^/]+\/record$/, 'Sửa thông tin khách hàng'], ['PUT', /^\/api\/customers\/[^/]+\/folder$/, 'Liên kết thư mục Drive cho khách hàng'],
  ['DELETE', /^\/api\/customers\/[^/]+\/folder$/, 'Gỡ liên kết Drive của khách hàng'], ['POST', /^\/api\/customers\/import$/, 'Nhập khách hàng từ Excel'], ['POST', /^\/api\/customers$/, 'Thêm khách hàng'], ['PUT', /^\/api\/customers\/[^/]+$/, 'Sửa khách hàng'], ['DELETE', /^\/api\/customers\/[^/]+$/, 'Xoá khách hàng'],
  ['POST', /^\/api\/customers\/[^/]+\/videos$/, 'Tải video lên Drive'], ['PUT', /^\/api\/customers\/[^/]+\/members\//, 'Thêm người vào khách hàng'], ['DELETE', /^\/api\/customers\/[^/]+\/members\//, 'Bỏ người khỏi khách hàng'],
  ['POST', /^\/api\/boards$/, 'Tạo board'], ['PUT', /^\/api\/boards\/[^/]+$/, 'Sửa board'], ['DELETE', /^\/api\/boards\/[^/]+$/, 'Xoá board'], ['PUT', /^\/api\/boards\/[^/]+\/members\//, 'Thêm người vào board'],
  ['POST', /^\/api\/lists\/[^/]+\/cards$/, 'Tạo thẻ'], ['PUT', /^\/api\/cards\/[^/]+$/, 'Sửa thẻ'], ['DELETE', /^\/api\/cards\/[^/]+$/, 'Xoá thẻ'], ['POST', /^\/api\/cards\/[^/]+\/comments$/, 'Bình luận thẻ'],
  ['POST', /^\/api\/task-projects\/[^/]+\/campaigns$/, 'Thêm chiến dịch'], ['PUT', /^\/api\/task-projects\/[^/]+\/members\//, 'Thêm người vào dịch vụ'], ['DELETE', /^\/api\/task-projects\/[^/]+\/members\//, 'Bỏ người khỏi dịch vụ'],
  ['POST', /^\/api\/projects$/, 'Tạo dự án dựng'], ['DELETE', /^\/api\/projects\/[^/]+$/, 'Xoá dự án dựng'], ['POST', /^\/api\/projects\/[^/]+\/renders$/, 'Xuất video'],
  ['POST', /^\/api\/reports$/, 'Tạo báo cáo'], ['PUT', /^\/api\/reports\/[^/]+$/, 'Sửa báo cáo'], ['DELETE', /^\/api\/reports\/[^/]+$/, 'Xoá báo cáo'],
  ['*', /^\/api\/(settings|google|workspace$|notifications\/mail)/, 'Đổi cấu hình hệ thống'],
];
// Saves that happen on their own while people work (the editor's autosave, page preferences, reading notifications,
// upload sessions, browsing folders) would bury the changes people make. Quick notes are private: never logged.
const QUIET = [/^\/api\/quick-notes(\/|$)/, /^\/api\/auth\/(prefs|login|setup)$/, /^\/api\/notifications\/read$/, /^\/api\/projects\/[^/]+$/, /^\/api\/sheets\//,
  /^\/api\/customers\/[^/]+\/videos\/session/, /^\/api\/workspace\/browse$/, /^\/api\/sources\/scan$/];

async function snapshot(e: Entity, id: string) {
  const row = await get<any>(`SELECT * FROM ${e.table} WHERE id = ?`, id);
  return row ? Object.fromEntries([...e.fields, e.label, ...(e.hidden || [])].map((f) => [f, row[f] ?? null])) : null;
}
/** The fields that differ, each with its old and new value (a hidden one: only that it changed). */
function diff(e: Entity, a: any, b: any) {
  const before: any = {}, after: any = {};
  for (const f of e.fields) if (JSON.stringify(a?.[f] ?? null) !== JSON.stringify(b?.[f] ?? null)) { before[f] = a?.[f] ?? null; after[f] = b?.[f] ?? null; }
  for (const f of e.hidden || []) if ((a?.[f] ?? null) !== (b?.[f] ?? null)) { before[f] = a?.[f] ? '(ẩn)' : null; after[f] = b?.[f] ? '(đã đổi)' : null; }
  return Object.keys(after).length ? { before, after } : null;
}

/** Holds an answer until the trail is written: on Workers nothing may run once the answer has gone. */
function hold(res: Res) {
  const calls: [string, any[]][] = [], orig = { writeHead: res.writeHead, write: res.write, end: res.end };
  res.writeHead = ((...a: any[]) => { calls.push(['writeHead', a]); return res; }) as any;
  res.write = ((...a: any[]) => { calls.push(['write', a]); return true; }) as any;
  res.end = ((...a: any[]) => { calls.push(['end', a]); return res; }) as any;
  return {
    status: () => Number(calls.find(([m]) => m === 'writeHead')?.[1][0]) || res.statusCode,
    body: () => { const b = calls.find(([m]) => m === 'end')?.[1][0]; return typeof b === 'string' ? b : b instanceof Uint8Array ? Buffer.from(b).toString() : ''; },
    release: () => { Object.assign(res, orig); for (const [m, a] of calls) (res as any)[m](...a); },
  };
}

/** What a handler says about its change, when it knows better than the address (the admin module). */
export const trailAs = (req: Req, t: { action: string; entityType?: string; entityId?: string | null; entityLabel?: string | null }) => { (req as any).trail = t; };

/** Runs an API handler. A change by a signed-in person is logged before its answer leaves: what it was (and, for a
 *  record listed above, the fields it altered); a refused one (403) too. */
export async function withTrail(req: Req, res: Res, user: Who, handler: () => Promise<any>) {
  const at = pathOf(req); // as the handler sees it, so an id written encoded is still logged as that record
  if (!user || req.method === 'GET' || req.method === 'HEAD' || QUIET.some((r) => r.test(at))) return handler();
  const one = ONE.find(([r]) => r.test(at)), made = req.method === 'POST' ? MADE.find(([r]) => r.test(at)) : undefined;
  const entity = one && req.method !== 'POST' ? { e: one[1], id: at.match(one[0])![1] } : null;
  const before = entity ? await snapshot(entity.e, entity.id) : null;
  const label = LABELS.find(([m, r]) => (m === '*' || m === req.method) && r.test(req.path))?.[2] || `${req.method} ${req.path}`;
  const held = hold(res);
  try { await handler(); }
  catch (e: any) {
    held.release();
    if (e instanceof HttpError && e.status === 403) await audit({ kind: 'action', action: `Bị từ chối: ${(req as any).trail?.action || label}`, user, req, status: 403, entityType: entity?.e.type, entityId: entity?.id, entityLabel: before?.[entity!.e.label] }).catch(() => {});
    throw e;
  }
  try {
    const status = held.status(), t = (req as any).trail as Parameters<typeof trailAs>[1] | undefined;
    let target = entity;
    if (made && status < 300) { try { const id = JSON.parse(held.body())?.id; if (typeof id === 'string') target = { e: made[1], id }; } catch { /* not JSON */ } }
    const after = target && status < 300 ? await snapshot(target.e, target.id) : null;
    const name = (after || before)?.[target?.e.label || ''] ?? null;
    await audit({ kind: 'action', action: t?.action || label, user, req, status, entityType: t?.entityType || target?.e.type, entityId: t ? t.entityId : target?.id, entityLabel: t ? t.entityLabel : name });
    const changed = target && status < 300 ? diff(target.e, before, after) : null;
    if (target && changed) await audit({ kind: 'data', action: !before ? 'Tạo mới' : !after ? 'Xoá' : 'Cập nhật', user, req, status, entityType: target.e.type, entityId: target.id, entityLabel: name, ...changed });
  } catch { console.error('Không ghi được nhật ký thao tác'); }
  finally { held.release(); }
}

/** The history of one record (a task, a customer…): its 'data' entries, newest first. */
export const historyOf = (type: string, id: string, limit = 100) =>
  all<any>('SELECT id, action, user_id, user_name, old_data, new_data, created_at FROM audit_logs WHERE entity_type = ? AND entity_id = ? AND kind = ? ORDER BY created_at DESC LIMIT ?', type, id, 'data', limit);
