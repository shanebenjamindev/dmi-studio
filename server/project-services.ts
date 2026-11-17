// Danh mục dịch vụ & Dịch vụ của nhãn hàng: Khách hàng -> Nhãn hàng -> Dịch vụ của nhãn hàng -> Công việc.
// Each brand_service references one service_catalog entry via catalog_service_id, and a customer's service
// list is aggregated dynamically across its brands' brand_services (no separate customer_needs table).
import { createHash } from 'node:crypto';
import { all, get, run, now } from './db';
import { HttpError } from './http';

type Ref = { id: string; name: string };
const byKey = (rows: any[], key: string) => {
  const out = new Map<string, Ref[]>();
  for (const r of rows) out.set(r[key], [...(out.get(r[key]) || []), { id: r.id, name: r.name }]);
  return out;
};
const among = (col: string, ids?: string[]) => (ids ? ` AND ${col} IN (SELECT value FROM json_each(?))` : '');

/** Each brand service's catalog entry (`Map<brandServiceId, [{ id, name }]>`). */
export async function brandServiceCatalogMap(ids?: string[]) {
  return byKey(
    await all<any>(
      `SELECT bs.id brand_service_id, s.id, s.name
       FROM brand_services bs
       JOIN service_catalog s ON s.id = bs.catalog_service_id AND s.deleted_at IS NULL
       WHERE 1=1${among('bs.id', ids)}
       ORDER BY s.name COLLATE NOCASE`,
      ...(ids ? [JSON.stringify(ids)] : [])
    ),
    'brand_service_id'
  );
}

/** @deprecated Dùng brandServiceCatalogMap. */
export const projectServices = brandServiceCatalogMap;

/** Each customer's services aggregated dynamically from its brands' brand_services. */
export async function customerServices(ids?: string[]) {
  return byKey(
    await all<any>(
      `SELECT DISTINCT br.customer_id, s.id, s.name
       FROM brand_services bs
       JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
       JOIN service_catalog s ON s.id = bs.catalog_service_id AND s.deleted_at IS NULL
       WHERE 1=1${among('br.customer_id', ids)}
       ORDER BY s.name COLLATE NOCASE`,
      ...(ids ? [JSON.stringify(ids)] : [])
    ),
    'customer_id'
  );
}

/** Each brand's active catalog services (`Map<brandId, Ref[]>`). */
export async function brandCatalogServices(ids?: string[]) {
  return byKey(
    await all<any>(
      `SELECT DISTINCT bs.brand_id, s.id, s.name
       FROM brand_services bs
       JOIN service_catalog s ON s.id = bs.catalog_service_id AND s.deleted_at IS NULL
       WHERE bs.brand_id IS NOT NULL${among('bs.brand_id', ids)}
       ORDER BY s.name COLLATE NOCASE`,
      ...(ids ? [JSON.stringify(ids)] : [])
    ),
    'brand_id'
  );
}

/** Services asked for by id: at most 50, each in service_catalog. */
export async function serviceIds(v: unknown) {
  if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách dịch vụ không hợp lệ');
  const ids = [...new Set(v as string[])];
  for (const id of ids) if (!(await get('SELECT 1 FROM service_catalog WHERE id = ? AND deleted_at IS NULL', id))) throw new HttpError(400, 'Không tìm thấy dịch vụ trong danh mục');
  return ids;
}

/** Exactly 0 or 1 catalog service id. */
export async function oneService(v: unknown, refused: string) {
  const ids = await serviceIds(v);
  if (ids.length > 1) throw new HttpError(400, refused);
  return ids;
}

/** Compute default display name for a brand_service's board: "Nhãn hàng · Dịch vụ" when customer has >=2 brands or distinct brand name, else "Dịch vụ". */
export async function boardDisplayName(brandServiceId: string, svcName?: string): Promise<string> {
  const row = await get<any>(
    `SELECT bs.name bs_name, bs.catalog_service_id, s.name cat_name, br.id brand_id, br.name brand_name, br.customer_id, c.name customer_name,
       (SELECT COUNT(*) FROM brands bx WHERE bx.customer_id = br.customer_id AND bx.deleted_at IS NULL) brand_count
     FROM brand_services bs
     LEFT JOIN service_catalog s ON s.id = bs.catalog_service_id
     LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     LEFT JOIN customers c ON c.id = br.customer_id
     WHERE bs.id = ?`,
    brandServiceId
  );
  const serviceName =
    svcName ||
    (row?.catalog_service_id && row.catalog_service_id !== 'sv_general' ? row.cat_name || row.bs_name : row?.bs_name || row?.cat_name) ||
    'Dịch vụ';
  if (!row?.brand_id) return serviceName;
  const distinctBrand = Number(row.brand_count || 0) > 1 || (row.brand_name && row.customer_name && row.brand_name !== row.customer_name);
  return distinctBrand ? `${row.brand_name} · ${serviceName}` : serviceName;
}

/** Ensure fallback catalog entry `'sv_general'` exists when creating a brand_service without a catalog selection. */
export async function ensureFallbackCatalogService(creatorId?: string | null): Promise<string> {
  const existing = await get<any>("SELECT id FROM service_catalog WHERE id = 'sv_general'");
  if (existing) {
    await run("UPDATE service_catalog SET deleted_at = NULL WHERE id = 'sv_general' AND deleted_at IS NOT NULL");
    return 'sv_general';
  }
  const at = now();
  await run(
    "INSERT OR IGNORE INTO service_catalog(id, name, status, created_by, created_at, updated_at) VALUES('sv_general', 'Dịch vụ chung', 'active', ?, ?, ?)",
    creatorId || null,
    at,
    at
  );
  return 'sv_general';
}

/** Updates a brand_service's catalog_service_id, keeps its name/cards/board synced. */
export async function saveBrandServiceCatalog(brandServiceId: string, ids: string[], by: string) {
  if (!ids.length) return;
  await run('UPDATE brand_services SET catalog_service_id = ?, updated_at = ? WHERE id = ?', ids[0], now(), brandServiceId);
  await nameAfterService(brandServiceId);
  const board = await get<any>('SELECT id FROM boards WHERE brand_service_id = ?', brandServiceId);
  if (board) await saveBoardServices(board.id, ids, by);
}

/** @deprecated Dùng saveBrandServiceCatalog. */
export const saveProjectServices = saveBrandServiceCatalog;

/** Sync a brand_service's name, its board's name (when uncustomized), and its service card title from its catalog entry. */
export async function nameAfterService(brandServiceId: string) {
  const bs = await get<any>(
    `SELECT bs.name, bs.brand_id, bs.catalog_service_id, s.name cat_name
     FROM brand_services bs
     JOIN service_catalog s ON s.id = bs.catalog_service_id
     WHERE bs.id = ?`,
    brandServiceId
  );
  if (!bs?.cat_name || bs.catalog_service_id === 'sv_general') return;
  const targetBoardName = await boardDisplayName(brandServiceId, bs.cat_name);
  if (bs.name !== bs.cat_name) {
    await run('UPDATE brand_services SET name = ?, updated_at = ? WHERE id = ?', bs.cat_name, now(), brandServiceId);
    await run("UPDATE board_cards SET title = ? WHERE card_kind IN ('service', 'project') AND brand_service_id = ?", bs.cat_name, brandServiceId);
    await run('UPDATE boards SET name = ? WHERE brand_service_id = ? AND name = ?', targetBoardName, brandServiceId, bs.name);
    await run('UPDATE boards SET name = ? WHERE id = ?', targetBoardName, `b_proj_${createHash('sha256').update(brandServiceId).digest('hex').slice(0, 16)}`);
  } else {
    // Also update board name if brand count/name changed while still matching default service name.
    await run('UPDATE boards SET name = ? WHERE brand_service_id = ? AND name = ?', targetBoardName, brandServiceId, bs.cat_name);
  }
}

/** Keep brand_services names aligned with service_catalog periodically. */
export async function projectsAsServices() {
  let changed = 0;
  for (const r of await all<any>(
    "SELECT bs.id FROM brand_services bs JOIN service_catalog s ON s.id = bs.catalog_service_id WHERE s.id <> 'sv_general' AND bs.name <> s.name"
  )) {
    await nameAfterService(r.id);
    changed++;
  }
  return changed;
}

/** Each task's services (explicitly tagged via task_services). */
export async function taskServices(ids?: string[]) {
  return byKey(
    await all<any>(
      `SELECT ts.task_id, s.id, s.name FROM task_services ts JOIN service_catalog s ON s.id = ts.service_id AND s.deleted_at IS NULL
       WHERE 1=1${among('ts.task_id', ids)} ORDER BY s.name COLLATE NOCASE`,
      ...(ids ? [JSON.stringify(ids)] : [])
    ),
    'task_id'
  );
}

/** Makes these the task's services. */
export async function saveTaskServices(taskId: string, ids: string[], by: string) {
  await run('DELETE FROM task_services WHERE task_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', taskId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO task_services(task_id, service_id, added_by, created_at) VALUES(?,?,?,?)', taskId, id, by, now());
}

/** Each board's services, its type. */
export async function boardServices(ids?: string[]) {
  return byKey(
    await all<any>(
      `SELECT bs.board_id, s.id, s.name FROM board_services bs JOIN service_catalog s ON s.id = bs.service_id AND s.deleted_at IS NULL
       WHERE 1=1${among('bs.board_id', ids)} ORDER BY s.name COLLATE NOCASE`,
      ...(ids ? [JSON.stringify(ids)] : [])
    ),
    'board_id'
  );
}

/** Makes these the board's services. */
export async function saveBoardServices(boardId: string, ids: string[], by: string) {
  await run('DELETE FROM board_services WHERE board_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', boardId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO board_services(board_id, service_id, added_by, created_at) VALUES(?,?,?,?)', boardId, id, by, now());
}

/** @deprecated customer_needs was removed; customer services are aggregated dynamically from brand_services. */
export async function settleCustomerServices(_customerIds: string[]) {
  return 0;
}
