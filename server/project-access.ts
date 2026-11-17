import { all, get, run, now } from './db';
import { HttpError } from './http';
import { customerLevel, customerLevels, requireCustomer, type CustomerLevel } from './customer-access';

/** Visibility and role levels across brand_services (`tj_...`). */
export async function brandServiceLevels(userId: string, customers?: Map<string, CustomerLevel>) {
  customers ||= await customerLevels(userId);
  const levels = new Map<string, CustomerLevel>();
  // The brand services they work in (given or following a task, or on a card), in one look.
  const worked = new Set(
    (
      await all<any>(
        `
    SELECT t.brand_service_id id FROM tasks t JOIN task_assignees a ON a.task_id=t.id JOIN task_people tp ON tp.id=a.person_id WHERE tp.user_id=? AND t.brand_service_id IS NOT NULL
    UNION SELECT t.brand_service_id FROM tasks t JOIN task_followers f ON f.task_id=t.id WHERE f.user_id=? AND t.brand_service_id IS NOT NULL
    UNION SELECT c.brand_service_id FROM board_cards c JOIN card_members cm ON cm.card_id=c.id WHERE cm.user_id=? AND c.brand_service_id IS NOT NULL
  `,
        userId,
        userId,
        userId
      )
    ).map((r) => r.id as string)
  );
  for (const bs of await all<any>(
    `SELECT bs.*, br.customer_id, m.role member_role
     FROM brand_services bs
     LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     LEFT JOIN brand_service_members m ON m.brand_service_id = bs.id AND m.user_id = ?`,
    userId
  )) {
    if (bs.customer_id && !customers.has(bs.customer_id)) continue;
    const level = bs.created_by === userId ? 'admin' : bs.member_role || (worked.has(bs.id) ? 'normal' : null);
    if (level) levels.set(bs.id, level);
  }
  return levels;
}

export async function requireBrandService(userId: string, id: string, need: CustomerLevel = 'observer') {
  const bs = await get<any>(
    `SELECT bs.*, br.customer_id
     FROM brand_services bs
     LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     WHERE bs.id = ?`,
    id
  );
  if (!bs) throw new HttpError(404, 'Không tìm thấy dịch vụ');
  let level =
    bs.created_by === userId
      ? 'admin'
      : (await get<any>('SELECT role FROM brand_service_members WHERE brand_service_id=? AND user_id=?', id, userId))?.role;
  if (!level) {
    const isTaskMember = await get(
      `
      SELECT 1 FROM tasks t WHERE t.brand_service_id=? AND (
        EXISTS(SELECT 1 FROM task_assignees a JOIN task_people tp ON tp.id=a.person_id WHERE a.task_id=t.id AND tp.user_id=?)
        OR EXISTS(SELECT 1 FROM task_followers f WHERE f.task_id=t.id AND f.user_id=?)
      )
      UNION
      SELECT 1 FROM board_cards c JOIN card_members cm ON cm.card_id=c.id WHERE c.brand_service_id=? AND cm.user_id=?
      LIMIT 1
    `,
      id,
      userId,
      userId,
      id,
      userId
    );
    if (isTaskMember) level = 'normal';
  }
  if (!level) throw new HttpError(404, 'Không tìm thấy dịch vụ');
  if (bs.customer_id) await requireCustomer(userId, bs.customer_id, need === 'observer' ? 'observer' : 'normal');
  if ((need === 'admin' && level !== 'admin') || (need === 'normal' && level === 'observer')) {
    throw new HttpError(403, 'Bạn chưa được cấp quyền sửa dịch vụ');
  }
  return level as CustomerLevel;
}

const RANK: Record<CustomerLevel, number> = { observer: 1, normal: 2, admin: 3 };

/** Whoever is put on a card or task sees what it belongs to: its brand service and customer open to them at `level`. */
export async function grantAccess(
  userId: string,
  by: string,
  opts: { brandServiceId?: string | null; projectId?: string | null; customerId?: string | null },
  level: 'normal' | 'observer'
) {
  const bsId = opts.brandServiceId ?? opts.projectId ?? null;
  const customers = new Set([opts.customerId].filter(Boolean) as string[]);
  const bs = bsId
    ? await get<any>(
        'SELECT bs.id, bs.created_by, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id = ?',
        bsId
      )
    : null;
  if (bs?.customer_id) customers.add(bs.customer_id);
  for (const id of customers) {
    const has = await customerLevel(userId, id);
    if (!has || RANK[has] < RANK[level]) {
      await run(
        'INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',
        id,
        userId,
        level,
        by,
        now()
      );
    }
  }
  if (bs && bs.created_by !== userId) {
    const has = (await get<any>('SELECT role FROM brand_service_members WHERE brand_service_id=? AND user_id=?', bs.id, userId))?.role as CustomerLevel | undefined;
    if (!has) await run('INSERT INTO brand_service_members(brand_service_id,user_id,role,follows) VALUES(?,?,?,0)', bs.id, userId, level);
    else if (RANK[has] < RANK[level]) await run('UPDATE brand_service_members SET role=? WHERE brand_service_id=? AND user_id=?', level, bs.id, userId);
  }
}

/** @deprecated Dùng brandServiceLevels. */
export const projectLevels = brandServiceLevels;
/** @deprecated Dùng requireBrandService. */
export const requireProject = requireBrandService;
