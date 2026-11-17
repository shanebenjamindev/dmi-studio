// Who is on a board besides its owner, and what being on it opens across brand_services & customers.
import { createHash } from 'node:crypto';
import { all, get, run, now } from './db';

export const AUTO = 'brand_service';
type BoardLevel = 'viewer' | 'observer' | 'normal' | 'admin';
const RANK: Record<string, number> = { viewer: 1, observer: 2, normal: 3, admin: 4 };

/** The board every customer has, for its services/items made outside a dedicated service board. */
export const customerBoardId = (customerId: string) => `b_cust_${createHash('sha256').update(customerId).digest('hex').slice(0, 16)}`;

/** The brand_services on a board: of its service cards and of the tasks on its cards. */
async function boardBrandServices(boardId: string) {
  return all<any>(
    `SELECT bs.id, br.customer_id, bs.created_by
     FROM brand_services bs
     LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     WHERE bs.id IN (
       SELECT brand_service_id FROM boards WHERE id = ? AND brand_service_id IS NOT NULL
       UNION SELECT brand_service_id FROM board_cards WHERE board_id = ? AND card_kind IN ('service','project') AND archived = 0 AND brand_service_id IS NOT NULL
       UNION SELECT t.brand_service_id FROM board_cards c JOIN task_board_links l ON l.card_id = c.id JOIN tasks t ON t.id = l.task_id WHERE c.board_id = ? AND t.brand_service_id IS NOT NULL
     )`,
    boardId,
    boardId,
    boardId
  );
}

/** People of the brand_services whose cards are on the board join it automatically. */
export async function syncBoardPeople(boardId: string) {
  const b = await get<any>('SELECT id, created_by, customer_id, brand_service_id, workspace_id FROM boards WHERE id = ?', boardId);
  if (!b) return;
  const serviceIds = JSON.stringify([
    ...new Set(
      [
        b.brand_service_id,
        ...(await all<any>("SELECT DISTINCT brand_service_id id FROM board_cards WHERE board_id = ? AND card_kind IN ('service','project') AND archived = 0 AND brand_service_id IS NOT NULL", b.id)).map((r) => r.id),
      ].filter(Boolean)
    ),
  ]);
  const want = new Map<string, BoardLevel>();
  const put = (user: string | null, level: BoardLevel) => { if (user && (RANK[want.get(user) || ''] || 0) < RANK[level]) want.set(user, level); };
  for (const m of await all<any>('SELECT user_id, role FROM brand_service_members WHERE via_board IS NULL AND brand_service_id IN (SELECT value FROM json_each(?))', serviceIds)) {
    put(m.user_id, m.role === 'observer' ? 'observer' : 'normal');
  }
  for (const p of await all<any>('SELECT created_by FROM brand_services WHERE id IN (SELECT value FROM json_each(?))', serviceIds)) put(p.created_by, 'normal');
  for (const r of await all<any>('SELECT DISTINCT tp.user_id FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people tp ON tp.id = a.person_id WHERE t.brand_service_id IN (SELECT value FROM json_each(?))', serviceIds)) {
    put(r.user_id, 'normal');
  }
  if (b.customer_id && b.id === customerBoardId(b.customer_id)) put((await get<any>('SELECT manager_id FROM customers WHERE id = ?', b.customer_id))?.manager_id || null, 'admin');
  const active = new Set((await all<any>('SELECT id FROM users WHERE disabled = 0 AND id IN (SELECT value FROM json_each(?))', JSON.stringify([...want.keys()]))).map((r) => r.id));
  want.delete(b.created_by);
  const have = new Map((await all<any>('SELECT user_id, role, added_by FROM board_members WHERE board_id = ?', b.id)).map((r) => [r.user_id, r]));
  for (const [user, level] of want) {
    if (!active.has(user)) continue;
    const row = have.get(user);
    if (!row) await run('INSERT INTO board_members(board_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?)', b.id, user, level, AUTO, now());
    else if ((row.added_by === AUTO || row.added_by === 'project') && row.role !== level) await run('UPDATE board_members SET role = ?, added_by = ? WHERE board_id = ? AND user_id = ?', level, AUTO, b.id, user);
  }
  for (const [user, row] of have) {
    if ((row.added_by === AUTO || row.added_by === 'project') && (!want.has(user) || !active.has(user))) {
      await run('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', b.id, user);
      await run('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM board_cards WHERE board_id = ?)', user, b.id);
    }
  }
  if (b.workspace_id) await (await import('./service-boards')).syncWorkspacePeople(b.workspace_id);
}

async function open(table: 'customer_members' | 'brand_service_members', key: string, id: string, user: string, level: 'normal' | 'observer', boardId: string, by: string | null) {
  const row = await get<any>(`SELECT role, via_board FROM ${table} WHERE ${key} = ? AND user_id = ?`, id, user);
  if (!row) {
    if (table === 'customer_members') await run('INSERT INTO customer_members(customer_id, user_id, role, added_by, created_at, via_board) VALUES(?,?,?,?,?,?)', id, user, level, by, now(), boardId);
    else await run('INSERT INTO brand_service_members(brand_service_id, user_id, role, follows, via_board) VALUES(?,?,?,0,?)', id, user, level, boardId);
  } else if (row.via_board === boardId) {
    if (row.role !== level) await run(`UPDATE ${table} SET role = ? WHERE ${key} = ? AND user_id = ?`, level, id, user);
  } else if (RANK[row.role] < RANK[level]) {
    await run(`UPDATE ${table} SET role = ?, via_board = CASE WHEN via_board IS NULL THEN NULL ELSE ? END WHERE ${key} = ? AND user_id = ?`, level, boardId, id, user);
  }
}

const SHARED = "COALESCE(m.added_by, '') NOT IN ('project', 'brand_service')";

const otherServiceBoard = async (brandServiceId: string, user: string, boardId: string) =>
  (
    await get<any>(
      `SELECT m.board_id FROM board_members m WHERE m.user_id = ? AND m.board_id <> ? AND ${SHARED} AND (
        EXISTS (SELECT 1 FROM board_cards c WHERE c.board_id = m.board_id AND c.card_kind IN ('service','project') AND c.brand_service_id = ?)
        OR EXISTS (SELECT 1 FROM board_cards c JOIN task_board_links l ON l.card_id = c.id JOIN tasks t ON t.id = l.task_id WHERE c.board_id = m.board_id AND t.brand_service_id = ?)) LIMIT 1`,
      user,
      boardId,
      brandServiceId,
      brandServiceId
    )
  )?.board_id || null;

const otherCustomerBoard = async (customer: string, user: string, boardId: string) =>
  (
    await get<any>(
      `SELECT m.board_id FROM board_members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? AND m.board_id <> ? AND ${SHARED} AND (
        b.customer_id = ? OR EXISTS (SELECT 1 FROM board_cards c JOIN brand_services bs ON bs.id = c.brand_service_id JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE c.board_id = m.board_id AND br.customer_id = ?)) LIMIT 1`,
      user,
      boardId,
      customer,
      customer
    )
  )?.board_id || null;

/** Open customer & brand_services to everyone a board is shared with; revoke when unshared. */
export async function syncBoardGrants(boardId: string) {
  const b = await get<any>('SELECT id, customer_id, created_by FROM boards WHERE id = ?', boardId);
  const services = b ? await boardBrandServices(b.id) : [];
  const shared = b ? await all<any>(`SELECT m.user_id, m.role, m.added_by FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND u.disabled = 0 AND ${SHARED}`, b.id) : [];
  const customers = new Set<string>([b?.customer_id, ...services.map((p) => p.customer_id)].filter(Boolean));
  const want = new Map<string, 'normal' | 'observer'>(shared.map((m) => [m.user_id, RANK[m.role] >= RANK.normal ? 'normal' : 'observer']));
  const owners = new Map((await all<any>('SELECT id, created_by, manager_id FROM customers WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...customers]))).map((k) => [k.id, [k.created_by, k.manager_id]]));
  for (const m of shared) {
    const level = want.get(m.user_id)!;
    for (const c of customers) if (!owners.get(c)?.includes(m.user_id)) await open('customer_members', 'customer_id', c, m.user_id, level, boardId, m.added_by);
    for (const p of services) if (p.created_by !== m.user_id) await open('brand_service_members', 'brand_service_id', p.id, m.user_id, level, boardId, m.added_by);
  }
  const ids = new Set(services.map((p) => p.id));
  for (const r of await all<any>('SELECT brand_service_id id, user_id FROM brand_service_members WHERE via_board = ?', boardId)) {
    if (want.has(r.user_id) && ids.has(r.id)) continue;
    const other = await otherServiceBoard(r.id, r.user_id, boardId);
    const works = await get('SELECT 1 FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people tp ON tp.id = a.person_id WHERE t.brand_service_id = ? AND tp.user_id = ? LIMIT 1', r.id, r.user_id);
    if (other || works) await run('UPDATE brand_service_members SET via_board = ? WHERE brand_service_id = ? AND user_id = ?', other, r.id, r.user_id);
    else await run('DELETE FROM brand_service_members WHERE brand_service_id = ? AND user_id = ?', r.id, r.user_id);
  }
  for (const r of await all<any>('SELECT customer_id id, user_id FROM customer_members WHERE via_board = ?', boardId)) {
    if (want.has(r.user_id) && customers.has(r.id)) continue;
    const other = await otherCustomerBoard(r.id, r.user_id, boardId);
    const inSvc = await get(
      'SELECT 1 FROM brand_service_members bm JOIN brand_services bs ON bs.id = bm.brand_service_id JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bm.user_id = ? AND br.customer_id = ? LIMIT 1',
      r.user_id,
      r.id
    );
    if (other || inSvc) await run('UPDATE customer_members SET via_board = ? WHERE customer_id = ? AND user_id = ?', other, r.id, r.user_id);
    else await run('DELETE FROM customer_members WHERE customer_id = ? AND user_id = ?', r.id, r.user_id);
  }
}

/** Sync all boards holding a brand_service. */
export async function syncProjectBoards(brandServiceId: string) {
  for (const r of await all<any>(
    "SELECT id board_id FROM boards WHERE brand_service_id = ? UNION SELECT board_id FROM board_cards WHERE card_kind IN ('service','project') AND archived = 0 AND brand_service_id = ?",
    brandServiceId,
    brandServiceId
  )) {
    await syncBoardPeople(r.board_id);
    await syncBoardGrants(r.board_id);
  }
}
