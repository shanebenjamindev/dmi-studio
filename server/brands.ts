// Nhãn hàng (Brands): Khách hàng -> Nhãn hàng -> Dịch vụ của nhãn hàng -> Công việc.
import { all, get, run, now, uid } from './db';
import { HttpError, json, readJson, type Req, type Router } from './http';
import { currentUser } from './auth';
import { customerLevels, requireCustomer } from './customer-access';
import { brandServiceLevels } from './project-access';
import { boardDisplayName, brandCatalogServices } from './project-services';
import * as G from './google';
import { brandServiceStage } from '../shared/projects';
export interface DriveFolderRef {
  kind?: 'gdrive';
  account: string;
  id: string;
  label?: string;
}

export function parseDriveFolder(raw: string | null | undefined): DriveFolderRef | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string' && typeof parsed.account === 'string') {
      return { kind: 'gdrive', account: parsed.account, id: parsed.id, label: parsed.label || parsed.id };
    }
  } catch {
    // Legacy or malformed drive_folder values are treated as unset.
  }
  return null;
}

async function normalizeDriveFolder(body: any, userId: string): Promise<string | null | undefined> {
  if (body.driveLink !== undefined) {
    const raw = String(body.driveLink || '').trim();
    if (!raw) return null;
    const { driveId, locate } = await import('./drive-links');
    const id = driveId(raw);
    if (!id) throw new HttpError(400, 'Link Google Drive không hợp lệ');
    const found = await locate(id, userId);
    if (found.file.mimeType !== 'application/vnd.google-apps.folder') {
      throw new HttpError(400, 'Link này là một file, không phải thư mục Google Drive');
    }
    return JSON.stringify({ account: found.account, id: found.file.id, label: found.file.name || found.file.id });
  }
  if (body.driveFolder === undefined) return undefined;
  if (body.driveFolder === null || body.driveFolder === '') return null;
  let parsed: DriveFolderRef | null = null;
  if (typeof body.driveFolder === 'string') {
    parsed = parseDriveFolder(body.driveFolder);
    if (!parsed) throw new HttpError(400, 'Thông tin thư mục Google Drive không hợp lệ');
  } else if (typeof body.driveFolder === 'object' && typeof body.driveFolder.id === 'string' && typeof body.driveFolder.account === 'string') {
    parsed = {
      kind: 'gdrive',
      account: String(body.driveFolder.account).trim(),
      id: String(body.driveFolder.id).trim(),
      label: String(body.driveFolder.label || body.driveFolder.id).trim(),
    };
  }
  if (!parsed) throw new HttpError(400, 'Thông tin thư mục Google Drive không hợp lệ');
  if (!(await G.hasUserAccount(userId, parsed.account)) && (await G.anyUserHasAccount(parsed.account))) {
    throw new HttpError(403, 'Bạn chỉ dùng được Google Drive từ Gmail bạn đã liên kết');
  }
  return JSON.stringify(parsed);
}

/** Return the customer's first active brand, creating a default one matching customer name if none exists. */
export async function ensureDefaultBrand(customerId: string, creatorId?: string | null) {
  const existing = await get<any>(
    'SELECT * FROM brands WHERE customer_id = ? AND deleted_at IS NULL ORDER BY pos, created_at, id LIMIT 1',
    customerId
  );
  if (existing) return existing;
  const c = await get<any>('SELECT id, name, gloc, created_by, created_at FROM customers WHERE id = ?', customerId);
  if (!c) throw new HttpError(404, 'Không tìm thấy khách hàng');
  const id = `br_default_${c.id}`;
  const at = now();
  await run(
    "INSERT OR IGNORE INTO brands(id, customer_id, name, logo, notes, pos, drive_folder, created_by, created_at, updated_at, deleted_at) VALUES(?,?,?,NULL,'',0,?,?,?,?,NULL)",
    id,
    c.id,
    c.name,
    c.gloc || null,
    creatorId || c.created_by || null,
    c.created_at || at,
    at
  );
  return get<any>('SELECT * FROM brands WHERE id = ?', id);
}

/** Sync board names that still match plain service titles when brand layout/names change under a customer. */
async function syncCustomerBrandBoardNames(customerId: string) {
  const services = await all<any>(
    `SELECT bs.id, bs.name, s.name cat_name
     FROM brand_services bs
     JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     JOIN service_catalog s ON s.id = bs.catalog_service_id
     WHERE br.customer_id = ?`,
    customerId
  );
  for (const s of services) {
    const b = await get<any>('SELECT id, name FROM boards WHERE brand_service_id = ?', s.id);
    if (!b) continue;
    const nextName = await boardDisplayName(s.id, s.cat_name || s.name);
    if (b.name === s.name || b.name === s.cat_name || b.name.endsWith(` · ${s.cat_name || s.name}`)) {
      if (b.name !== nextName) await run('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?', nextName, now(), b.id);
    }
  }
}

async function brandListOut(rows: any[], visibleBs: Map<string, any>) {
  if (!rows.length) return [];
  const brandIds = rows.map((r) => r.id as string);
  const svcsByBrand = await brandCatalogServices(brandIds);
  const bsRows = (
    await all<any>(
      `SELECT bs.id, bs.brand_id, bs.catalog_service_id, bs.name, bs.hold, bs.created_at, bs.updated_at,
         s.name catalog_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.brand_service_id = bs.id AND t.stub = 0) tasks,
         (SELECT COUNT(*) FROM tasks t WHERE t.brand_service_id = bs.id AND t.stub = 0 AND t.done_at IS NOT NULL) completed
       FROM brand_services bs
       LEFT JOIN service_catalog s ON s.id = bs.catalog_service_id
       WHERE bs.brand_id IN (SELECT value FROM json_each(?))
       ORDER BY bs.name COLLATE NOCASE`,
      JSON.stringify(brandIds)
    )
  ).filter((bs) => visibleBs.has(bs.id));

  const bsMap = new Map<string, any[]>();
  for (const bs of bsRows) {
    const list = bsMap.get(bs.brand_id) || [];
    list.push({
      id: bs.id,
      name: bs.catalog_name || bs.name,
      catalogServiceId: bs.catalog_service_id,
      hold: bs.hold || null,
      tasks: Number(bs.tasks || 0),
      completed: Number(bs.completed || 0),
      level: visibleBs.get(bs.id) || 'observer',
      stage: brandServiceStage({ tasks: Number(bs.tasks || 0), started: Number(bs.completed || 0), done: Number(bs.completed || 0) }, bs.hold),
    });
    bsMap.set(bs.brand_id, list);
  }

  return rows.map((r) => {
    const brandServices = bsMap.get(r.id) || [];
    const ownDrive = parseDriveFolder(r.drive_folder);
    const parentDrive = parseDriveFolder(r.customer_gloc);
    return {
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name || '',
      name: r.name,
      logo: r.logo || null,
      notes: r.notes || '',
      pos: Number(r.pos || 0),
      driveFolder: ownDrive,
      effectiveDriveFolder: ownDrive || parentDrive,
      driveInherited: !ownDrive && !!parentDrive,
      catalogServices: svcsByBrand.get(r.id) || [],
      brandServices,
      servicesCount: brandServices.length,
      tasksCount: brandServices.reduce((n, x) => n + x.tasks, 0),
      completedCount: brandServices.reduce((n, x) => n + x.completed, 0),
      createdBy: r.created_by || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });
}

export function registerBrands(api: Router) {
  const me = async (req: Req) => (await currentUser(req))!;

  api.get('/api/brands', async (req, res) => {
    const user = await me(req);
    const allowedCustomers = await customerLevels(user.id);
    const visibleBs = await brandServiceLevels(user.id, allowedCustomers);
    const customerFilter = String(req.query.get('customerId') || req.query.get('customer') || '').trim();
    const q = String(req.query.get('q') || '').trim().toLocaleLowerCase('vi');
    const rows = (
      await all<any>(
        `SELECT b.*, c.name customer_name, c.gloc customer_gloc
         FROM brands b
         JOIN customers c ON c.id = b.customer_id AND c.archived_at IS NULL
         WHERE b.deleted_at IS NULL
         ${customerFilter ? 'AND b.customer_id = ?' : ''}
         ORDER BY c.name COLLATE NOCASE, b.pos, b.name COLLATE NOCASE`,
        ...(customerFilter ? [customerFilter] : [])
      )
    ).filter(
      (b) => allowedCustomers.has(b.customer_id) && (!q || b.name.toLocaleLowerCase('vi').includes(q) || b.customer_name.toLocaleLowerCase('vi').includes(q))
    );
    json(res, 200, await brandListOut(rows, visibleBs));
  });

  api.get('/api/customers/:id/brands', async (req, res) => {
    const user = await me(req);
    await requireCustomer(user.id, req.params.id, 'observer');
    const visibleBs = await brandServiceLevels(user.id);
    const rows = await all<any>(
      `SELECT b.*, c.name customer_name, c.gloc customer_gloc
       FROM brands b
       JOIN customers c ON c.id = b.customer_id
       WHERE b.customer_id = ? AND b.deleted_at IS NULL
       ORDER BY b.pos, b.created_at, b.name COLLATE NOCASE`,
      req.params.id
    );
    json(res, 200, await brandListOut(rows, visibleBs));
  });

  api.post('/api/customers/:id/brands', async (req, res) => {
    const user = await me(req);
    await requireCustomer(user.id, req.params.id, 'admin');
    const c = await get<any>('SELECT id, name FROM customers WHERE id = ? AND archived_at IS NULL', req.params.id);
    if (!c) throw new HttpError(404, 'Không tìm thấy khách hàng');
    const body = await readJson(req);
    const name = String(body.name || '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120) throw new HttpError(400, 'Tên nhãn hàng cần từ 1 đến 120 ký tự');
    const dup = await get<any>('SELECT 1 FROM brands WHERE customer_id = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?)', c.id, name);
    if (dup) throw new HttpError(409, `Khách hàng đã có nhãn hàng “${name}”`);
    const driveFolder = await normalizeDriveFolder(body, user.id);
    const maxPos = Number((await get<any>('SELECT MAX(pos) m FROM brands WHERE customer_id = ? AND deleted_at IS NULL', c.id))?.m ?? -1);
    const pos = body.pos !== undefined && Number.isFinite(Number(body.pos)) ? Number(body.pos) : maxPos + 1;
    const notes = body.notes !== undefined ? String(body.notes || '').slice(0, 5000) : '';
    const logo = body.logo ? String(body.logo).slice(0, 50000) : null;
    const id = uid('br_'), t = now();
    await run(
      'INSERT INTO brands(id, customer_id, name, logo, notes, pos, drive_folder, created_by, created_at, updated_at, deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)',
      id,
      c.id,
      name,
      logo,
      notes,
      pos,
      driveFolder ?? null,
      user.id,
      t,
      t
    );
    await syncCustomerBrandBoardNames(c.id);
    const visibleBs = await brandServiceLevels(user.id);
    const created = await get<any>('SELECT b.*, c.name customer_name, c.gloc customer_gloc FROM brands b JOIN customers c ON c.id = b.customer_id WHERE b.id = ?', id);
    json(res, 201, (await brandListOut([created], visibleBs))[0]);
  });

  api.get('/api/brands/:id', async (req, res) => {
    const user = await me(req);
    const b = await get<any>(
      'SELECT b.*, c.name customer_name, c.gloc customer_gloc FROM brands b JOIN customers c ON c.id = b.customer_id WHERE b.id = ? AND b.deleted_at IS NULL',
      req.params.id
    );
    if (!b) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
    await requireCustomer(user.id, b.customer_id, 'observer');
    const visibleBs = await brandServiceLevels(user.id);
    json(res, 200, (await brandListOut([b], visibleBs))[0]);
  });

  api.put('/api/brands/:id', async (req, res) => {
    const user = await me(req);
    const b = await get<any>('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!b) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
    await requireCustomer(user.id, b.customer_id, 'admin');
    const body = await readJson(req);
    let nextName = b.name as string;
    if (body.name !== undefined) {
      nextName = String(body.name || '').replace(/\s+/g, ' ').trim();
      if (!nextName || nextName.length > 120) throw new HttpError(400, 'Tên nhãn hàng cần từ 1 đến 120 ký tự');
      const dup = await get<any>('SELECT 1 FROM brands WHERE customer_id = ? AND id <> ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?)', b.customer_id, b.id, nextName);
      if (dup) throw new HttpError(409, `Khách hàng đã có nhãn hàng “${nextName}”`);
    }
    const driveFolder = await normalizeDriveFolder(body, user.id);
    const nextLogo = body.logo === undefined ? b.logo : body.logo ? String(body.logo).slice(0, 50000) : null;
    const nextNotes = body.notes === undefined ? b.notes : String(body.notes || '').slice(0, 5000);
    const nextPos = body.pos !== undefined && Number.isFinite(Number(body.pos)) ? Number(body.pos) : b.pos;
    const nextDrive = driveFolder === undefined ? b.drive_folder : driveFolder;
    await run(
      'UPDATE brands SET name = ?, logo = ?, notes = ?, pos = ?, drive_folder = ?, updated_at = ? WHERE id = ?',
      nextName,
      nextLogo,
      nextNotes,
      nextPos,
      nextDrive,
      now(),
      b.id
    );
    if (nextName !== b.name) await syncCustomerBrandBoardNames(b.customer_id);
    const updated = await get<any>('SELECT b.*, c.name customer_name, c.gloc customer_gloc FROM brands b JOIN customers c ON c.id = b.customer_id WHERE b.id = ?', b.id);
    const visibleBs = await brandServiceLevels(user.id);
    json(res, 200, (await brandListOut([updated], visibleBs))[0]);
  });

  api.delete('/api/brands/:id', async (req, res) => {
    const user = await me(req);
    const b = await get<any>('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL', req.params.id);
    if (!b) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
    await requireCustomer(user.id, b.customer_id, 'admin');
    const siblingCount = Number((await get<any>('SELECT COUNT(*) n FROM brands WHERE customer_id = ? AND deleted_at IS NULL AND id <> ?', b.customer_id, b.id))?.n || 0);
    if (siblingCount === 0) throw new HttpError(409, 'Khách hàng phải có ít nhất một nhãn hàng');
    const moveTo = String(req.query.get('moveToBrandId') || '').trim();
    const attached = await all<any>('SELECT id, catalog_service_id, name FROM brand_services WHERE brand_id = ?', b.id);
    if (attached.length > 0) {
      if (!moveTo) {
        throw new HttpError(409, `Nhãn hàng đang có ${attached.length} dịch vụ. Hãy chuyển hoặc xoá các dịch vụ trước khi xoá nhãn hàng`);
      }
      const target = await get<any>('SELECT * FROM brands WHERE id = ? AND customer_id = ? AND deleted_at IS NULL', moveTo, b.customer_id);
      if (!target || target.id === b.id) throw new HttpError(400, 'Nhãn hàng đích không hợp lệ');
      for (const s of attached) {
        const conflict = await get<any>('SELECT id FROM brand_services WHERE brand_id = ? AND catalog_service_id = ?', target.id, s.catalog_service_id);
        if (conflict) throw new HttpError(409, `Nhãn hàng đích đã có dịch vụ “${s.name}”`);
      }
      await run('UPDATE brand_services SET brand_id = ?, updated_at = ? WHERE brand_id = ?', target.id, now(), b.id);
      await syncCustomerBrandBoardNames(b.customer_id);
    }
    const ts = now();
    await run('UPDATE brands SET deleted_at = ?, updated_at = ? WHERE id = ?', ts, ts, b.id);
    json(res, 200, { ok: true });
  });
}
