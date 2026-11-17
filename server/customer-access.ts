import { all, get } from './db';
import { HttpError } from './http';

export type CustomerLevel = 'admin' | 'normal' | 'observer';

/** The department a user heads (their role there is at the 'admin' level), or null. */
export async function headedDepartment(userId: string): Promise<string | null> {
  return (await get<any>(
    `SELECT u.team_role FROM users u JOIN dept_roles d ON d.id=u.dept_role AND d.team_role_id=u.team_role WHERE u.id=? AND d.level='admin'`,
    userId
  ))?.team_role || null;
}

/** Department heads manage the customers of the people in their department. */
async function headsOwner(userId: string, ownerId: string | null) {
  const dept = ownerId && await headedDepartment(userId);
  return !!dept && !!await get('SELECT 1 FROM users WHERE id=? AND team_role=?', ownerId, dept);
}

/** A customer is deleted by its owner, the head of the owner's department, or a company admin; one nobody owns, by its managers. */
export async function canDeleteCustomer(userId: string, customer: { id: string; created_by: string | null; manager_id?: string | null }) {
  if ((await get<any>('SELECT role FROM users WHERE id=?', userId))?.role === 'admin') return true;
  const owner = customer.created_by || customer.manager_id || null;
  if (owner) return owner === userId || await headsOwner(userId, owner);
  return await customerLevel(userId, customer.id) === 'admin';
}

export async function customerLevels(userId: string) {
  // All at once (each is a round trip to D1), then applied in this order: membership, head of the owner's department,
  // owner or manager, and only then what working on its brands' services and cards opens.
  const [members, headed, owned, viaBrandServices, viaCards] = await Promise.all([
    all<any>('SELECT customer_id,role FROM customer_members WHERE user_id=?', userId),
    all<any>(
      `SELECT c.id FROM customers c JOIN users o ON (o.id=c.created_by OR o.id=c.manager_id) WHERE o.team_role=(SELECT u.team_role FROM users u JOIN dept_roles d ON d.id=u.dept_role AND d.team_role_id=u.team_role WHERE u.id=? AND d.level='admin')`,
      userId
    ),
    all<any>('SELECT id FROM customers WHERE created_by=? OR manager_id=?', userId, userId),
    all<any>(
      `
     SELECT DISTINCT br.customer_id
     FROM brand_services bs
     JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     WHERE (
       bs.id IN (SELECT t.brand_service_id FROM tasks t JOIN task_assignees a ON a.task_id=t.id JOIN task_people tp ON tp.id=a.person_id WHERE tp.user_id=? AND t.brand_service_id IS NOT NULL)
       OR bs.id IN (SELECT t.brand_service_id FROM tasks t JOIN task_followers f ON f.task_id=t.id WHERE f.user_id=? AND t.brand_service_id IS NOT NULL)
       OR bs.id IN (SELECT bm.brand_service_id FROM brand_service_members bm WHERE bm.user_id=?)
       OR bs.id IN (SELECT bc.brand_service_id FROM board_cards bc JOIN card_members cm ON cm.card_id=bc.id WHERE cm.user_id=? AND bc.brand_service_id IS NOT NULL)
     )
    `,
      userId,
      userId,
      userId,
      userId
    ),
    all<any>(
      `
     SELECT DISTINCT bc.customer_id FROM board_cards bc
     JOIN card_members cm ON cm.card_id=bc.id
     WHERE cm.user_id=? AND bc.customer_id IS NOT NULL
    `,
      userId
    ),
  ]);
  const map = new Map<string, CustomerLevel>();
  for (const row of members) map.set(row.customer_id, row.role);
  for (const row of [...headed, ...owned]) map.set(row.id, 'admin');
  for (const row of [...viaBrandServices, ...viaCards]) if (!map.has(row.customer_id)) map.set(row.customer_id, 'normal');
  return map;
}

export async function customerLevel(userId: string, id: string): Promise<CustomerLevel | null> {
  const row = await get<any>('SELECT created_by,manager_id FROM customers WHERE id=?', id);
  if (!row) return null;
  if (row.created_by === userId || row.manager_id === userId || await headsOwner(userId, row.created_by) || await headsOwner(userId, row.manager_id)) return 'admin';
  const direct = (await get<any>('SELECT role FROM customer_members WHERE customer_id=? AND user_id=?', id, userId))?.role;
  if (direct) return direct;
  const linked = await get(
    `
   SELECT 1 FROM brand_services bs
   JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
   WHERE br.customer_id=? AND (
     bs.id IN (SELECT t.brand_service_id FROM tasks t JOIN task_assignees a ON a.task_id=t.id JOIN task_people tp ON tp.id=a.person_id WHERE tp.user_id=? AND t.brand_service_id IS NOT NULL)
     OR bs.id IN (SELECT t.brand_service_id FROM tasks t JOIN task_followers f ON f.task_id=t.id WHERE f.user_id=? AND t.brand_service_id IS NOT NULL)
     OR bs.id IN (SELECT bm.brand_service_id FROM brand_service_members bm WHERE bm.user_id=?)
     OR bs.id IN (SELECT bc.brand_service_id FROM board_cards bc JOIN card_members cm ON cm.card_id=bc.id WHERE cm.user_id=? AND bc.brand_service_id IS NOT NULL)
   )
   UNION
   SELECT 1 FROM board_cards bc JOIN card_members cm ON cm.card_id=bc.id WHERE bc.customer_id=? AND cm.user_id=?
   LIMIT 1
 `,
    id,
    userId,
    userId,
    userId,
    userId,
    id,
    userId
  );
  return linked ? 'normal' : null;
}

export async function requireCustomer(userId: string, id: string, need: CustomerLevel = 'observer') {
  const level = await customerLevel(userId, id);
  if (!level) throw new HttpError(404, 'Không tìm thấy khách hàng');
  if ((need === 'admin' && level !== 'admin') || (need === 'normal' && level === 'observer')) {
    throw new HttpError(403, 'Bạn chưa được cấp quyền thao tác với khách hàng này');
  }
  return level;
}

/** Takes the user's id three times: owner/manager, member, head of the owner's/manager's department. */
export const customerAccessSql = (alias = 'c') =>
  `(EXISTS(SELECT 1 FROM users me WHERE me.id=? AND (me.id=${alias}.created_by OR me.id=${alias}.manager_id)) OR EXISTS(SELECT 1 FROM customer_members cm WHERE cm.customer_id=${alias}.id AND cm.user_id=?) OR EXISTS(SELECT 1 FROM users head JOIN dept_roles d ON d.id=head.dept_role AND d.team_role_id=head.team_role JOIN users owner ON owner.team_role=head.team_role WHERE head.id=? AND d.level='admin' AND (owner.id=${alias}.created_by OR owner.id=${alias}.manager_id)))`;

export async function visibleCardIds(userId: string) {
  const allowed = await customerLevels(userId);
  return new Set(
    (
      await all<any>(
        `SELECT c.id, c.customer_id, br.customer_id task_customer, bs.created_by service_owner, t.brand_service_id,
          (SELECT 1 FROM brand_service_members bm WHERE bm.brand_service_id=t.brand_service_id AND bm.user_id=?) service_member
         FROM board_cards c
         LEFT JOIN task_board_links l ON l.card_id=c.id
         LEFT JOIN tasks t ON t.id=l.task_id
         LEFT JOIN brand_services bs ON bs.id=t.brand_service_id
         LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL`,
        userId
      )
    )
      .filter(
        (c) =>
          (!c.brand_service_id || c.service_owner === userId || c.service_member) &&
          (!c.customer_id || allowed.has(c.customer_id)) &&
          (!c.task_customer || allowed.has(c.task_customer))
      )
      .map((c) => c.id)
  );
}
