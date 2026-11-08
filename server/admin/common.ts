// Shared by the admin module's endpoints (/api/admin/*): the permission each needs and the scope it is held at, input
// checks, paging, CSV downloads, the change log, and the small lists that all work the same way (categories, sources,
// priorities…): a name, a colour, an order, on or off, and deleted only while nothing uses them.
import { all, get, run, uid, now } from '../db';
import { HttpError, json, readJson, type Req, type Res, type Router } from '../http';
import { currentUser, type User } from '../auth';
import { accessOf, scopeFor, scopeUsers, inSet, type Access } from '../rbac';
import { audit, trailAs } from '../audit';
import type { Perm, Scope } from '../../shared/permissions';

export interface Ctx { user: User; access: Access; scope: Scope; req: Req }
/** The signed-in account holding `perm`, and the scope it holds it at; 403 without it. */
export async function need(req: Req, perm: Perm): Promise<Ctx> {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Hãy đăng nhập');
  const access = await accessOf(user);
  return { user, access, scope: scopeFor(access, perm), req };
}
/** The accounts this permission's scope reaches (null: everyone). */
export const reach = (c: Ctx) => scopeUsers(c.user.id, c.scope);
export const may = (c: Ctx, perm: Perm) => c.access.perms.has(perm);
export { inSet };

// ---------------------------------------------------------------- input
export function text(v: unknown, max: number, label: string, required = true) {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `Hãy nhập ${label}`);
  if (s.length > max) throw new HttpError(400, `${label.charAt(0).toUpperCase() + label.slice(1)} tối đa ${max} ký tự`);
  return s;
}
export const color = (v: unknown, fallback = '#64748b') => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : fallback);
/** A non-negative amount, or null for none. */
export function amount(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s,]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new HttpError(400, `${label} phải là số không âm`);
  return n;
}
export const timeIn = (v: unknown, label: string): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 8.64e15) throw new HttpError(400, `${label} không hợp lệ`);
  return n;
};
export const oneOf = <T extends string>(v: unknown, list: readonly T[], label: string, fallback?: T): T => {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  if (!list.includes(v as T)) throw new HttpError(400, `${label} không hợp lệ`);
  return v as T;
};
export async function exists(table: string, id: unknown, label: string, extra = '') {
  if (id === null || id === undefined || id === '') return null;
  if (!(await get(`SELECT 1 FROM ${table} WHERE id = ?${extra}`, String(id)))) throw new HttpError(400, `Không tìm thấy ${label}`);
  return String(id);
}
/** A search box's words: each must be in the text, in any order, without marks or case ("sai gon garage" finds
 *  "Garage Sài Gòn"); digits also match with spaces and dashes left out ("0912000111" finds "0912 000 111"). */
export function matcher(q: unknown) {
  const words = fold(String(q ?? '')).split(/[\s,;:()"'“”|#[\]\-/\\]+/).filter(Boolean);
  return (...parts: (string | null | undefined)[]) => {
    if (!words.length) return true;
    const text = fold(parts.filter(Boolean).join(' ')), flat = text.replace(/[\s.\-_/]+/g, '');
    return words.every((w) => {
      const fw = w.replace(/[.\-_/]+/g, '');
      return text.includes(w) || (fw.length > 0 && flat.includes(fw));
    });
  };
}
/** Lowercase without Vietnamese marks, for searching. */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

// ---------------------------------------------------------------- lists
export function paging(req: Req) {
  const page = Math.max(1, Math.floor(Number(req.query.get('page')) || 1));
  const size = Math.min(200, Math.max(1, Math.floor(Number(req.query.get('size')) || 25)));
  return { page, size, offset: (page - 1) * size };
}
/** One page of rows already filtered, after sorting by `sort` (a key of `keys`) in `dir`. */
export function page<T>(req: Req, rows: T[], keys: Record<string, (r: T) => string | number | null>) {
  const sort = keys[String(req.query.get('sort'))] ? String(req.query.get('sort')) : Object.keys(keys)[0];
  const dir = req.query.get('dir') === 'desc' ? -1 : 1, key = keys[sort];
  const sorted = [...rows].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    return (typeof x === 'string' ? x.localeCompare(String(y), 'vi') : (x as number) - (y as number)) * dir;
  });
  const { page: p, size, offset } = paging(req);
  return { items: sorted.slice(offset, offset + size), total: rows.length, page: p, size, sort, dir: dir === 1 ? 'asc' : 'desc' };
}

/** A CSV file Excel opens in UTF-8. A cell starting like a formula is kept as text. */
export function sendCsv(res: Res, name: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'no-store' });
  res.end('﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n'));
}
export const csvDate = (t: number | null | undefined) => (t ? new Date(t + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) : '');

// ---------------------------------------------------------------- change log
/** Logs a record's change in Lịch sử thay đổi dữ liệu (only the fields that differ) and names the change for Lịch sử thao tác. */
export async function changed(c: Ctx, e: { action: string; type: string; id: string; label: string; before?: Record<string, any> | null; after?: Record<string, any> | null; kind?: 'data' | 'permission' }) {
  trailAs(c.req, { action: e.action, entityType: e.type, entityId: e.id, entityLabel: e.label });
  let before = e.before ?? null, after = e.after ?? null;
  if (before && after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before![k] ?? null) !== JSON.stringify(after![k] ?? null));
    if (!keys.length) { if (e.kind !== 'permission') return; }
    else { before = Object.fromEntries(keys.map((k) => [k, before![k] ?? null])); after = Object.fromEntries(keys.map((k) => [k, after![k] ?? null])); }
  }
  await audit({ kind: e.kind || 'data', action: e.action, user: c.user, req: c.req, entityType: e.type, entityId: e.id, entityLabel: e.label, before, after, status: 200 });
}

/** Logs something done that changes no record (a download) in Lịch sử thao tác: GET requests have no trail of their own. */
export const logAction = (c: Ctx, action: string, label = '', entityType?: string) =>
  audit({ kind: 'action', action, user: c.user, req: c.req, entityType, entityLabel: label || null, status: 200 });
/** Does a permission (at the scope it is held) reach this account? */
export async function reaches(c: Ctx, perm: Perm) {
  if (!c.access.perms.has(perm)) return () => false;
  const ids = await scopeUsers(c.user.id, c.access.perms.get(perm)!);
  return (id: string | null | undefined) => !ids || (!!id && ids.has(id));
}

// ---------------------------------------------------------------- small lists
export interface Dict {
  path: string; table: string; type: string; label: string;
  view: Perm; manage: Perm; strictOrder?: boolean;
  /** Where the list's items are used: deleting one is refused while any is. */
  usedIn: { table: string; column: string; where?: string }[];
}
const dictOut = (r: any, used: number) => ({ id: r.id, name: r.name, color: r.color, pos: r.pos, active: !!r.active, used, createdAt: r.created_at, updatedAt: r.updated_at });
async function usage(d: Dict) {
  const n = new Map<string, number>();
  for (const u of d.usedIn) for (const r of await all<any>(`SELECT ${u.column} id, COUNT(*) n FROM ${u.table} WHERE ${u.column} IS NOT NULL${u.where ? ` AND ${u.where}` : ''} GROUP BY ${u.column}`)) n.set(r.id, (n.get(r.id) || 0) + Number(r.n));
  return n;
}
export const dictName = async (table: string, id: string | null) => (id ? (await get<any>(`SELECT name FROM ${table} WHERE id = ?`, id))?.name || null : null);
export function registerDict(api: Router, d: Dict) {
  const base = `/api/admin/${d.path}`;
  const must = async (id: string) => { const r = await get<any>(`SELECT * FROM ${d.table} WHERE id = ?`, id); if (!r) throw new HttpError(404, `Không tìm thấy ${d.label}`); return r; };
  const unique = async (name: string, id = '') => { if (await get(`SELECT 1 FROM ${d.table} WHERE name = ? COLLATE NOCASE AND id <> ?`, name, id)) throw new HttpError(409, `Đã có ${d.label} “${name}”`); };
  api.get(base, async (req, res) => {
    await need(req, d.view);
    const used = await usage(d);
    json(res, 200, (await all<any>(`SELECT * FROM ${d.table} ORDER BY pos, name`)).map((r) => dictOut(r, used.get(r.id) || 0)));
  });
  api.post(base, async (req, res) => {
    const c = await need(req, d.manage), b = await readJson(req), name = text(b.name, 80, `tên ${d.label}`);
    await unique(name);
    const id = uid(d.type.slice(0, 3) + '_'), pos = Number((await get<any>(`SELECT MAX(pos) m FROM ${d.table}`))?.m || 0) + 1;
    await run(`INSERT INTO ${d.table}(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`, id, name, color(b.color), pos, now(), now());
    await changed(c, { action: `Thêm ${d.label}`, type: d.type, id, label: name, after: { name, color: color(b.color) } });
    json(res, 201, dictOut(await must(id), 0));
  });
  api.put(`${base}/:id`, async (req, res) => {
    const c = await need(req, d.manage), r = await must(req.params.id), b = await readJson(req);
    const name = b.name !== undefined ? text(b.name, 80, `tên ${d.label}`) : r.name;
    if (name !== r.name) await unique(name, r.id);
    const next = { name, color: b.color !== undefined ? color(b.color, r.color) : r.color, active: b.active !== undefined ? (b.active ? 1 : 0) : r.active };
    await run(`UPDATE ${d.table} SET name = ?, color = ?, active = ?, updated_at = ? WHERE id = ?`, next.name, next.color, next.active, now(), r.id);
    await changed(c, { action: `Sửa ${d.label}`, type: d.type, id: r.id, label: name, before: { name: r.name, color: r.color, active: r.active }, after: next });
    json(res, 200, dictOut(await must(r.id), (await usage(d)).get(r.id) || 0));
  });
  api.delete(`${base}/:id`, async (req, res) => {
    const c = await need(req, d.manage), r = await must(req.params.id), n = (await usage(d)).get(r.id) || 0;
    if (n) throw new HttpError(409, `${d.label.charAt(0).toUpperCase() + d.label.slice(1)} “${r.name}” đang được dùng ở ${n} nơi. Hãy tắt thay vì xoá.`);
    await run(`DELETE FROM ${d.table} WHERE id = ?`, r.id);
    await changed(c, { action: `Xoá ${d.label}`, type: d.type, id: r.id, label: r.name, before: { name: r.name, color: r.color } });
    json(res, 200, { ok: true });
  });
  // The whole order at once: the ids from first to last.
  api.post(`${base}/order`, async (req, res) => {
    const c = await need(req, d.manage), b = await readJson(req);
    if (!Array.isArray(b.ids) || b.ids.length > 500 || b.ids.some((x: unknown) => typeof x !== 'string')) throw new HttpError(400, 'Thứ tự không hợp lệ');
    if(d.strictOrder){const ids=(await all<any>(`SELECT id FROM ${d.table}`)).map(r=>r.id);if(b.ids.length!==ids.length||new Set(b.ids).size!==ids.length||b.ids.some((id:string)=>!ids.includes(id)))throw new HttpError(400,'Thứ tự phải chứa đầy đủ các trạng thái, không trùng lặp');}
    for (const [i, id] of (b.ids as string[]).entries()) await run(`UPDATE ${d.table} SET pos = ?, updated_at = ? WHERE id = ?`, i + 1, now(), id);
    trailAs(c.req, { action: `Sắp xếp ${d.label}`, entityType: d.type });
    json(res, 200, { ok: true });
  });
}
