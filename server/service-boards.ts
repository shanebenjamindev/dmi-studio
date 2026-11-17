// Khách hàng → Nhãn hàng → Dịch vụ của nhãn hàng → Board → Công việc.
// Each customer has workspaces; every service board in them belongs to one brand_service (tj_..., boards.brand_service_id),
// and each brand × catalog_service has at most one board.
import { createHash } from 'node:crypto';
import { all, get, getSetting, setSetting, run, uid, now } from './db';
import { HttpError } from './http';
import { FLOW_COLUMNS, listColor } from './flow-columns';
import { boardDisplayName, saveBoardServices } from './project-services';
import { syncBoardGrants, syncBoardPeople } from './board-people';

/** A board made for its owner's tasks of no service: outside customers and services. */
export const personalBoard = (boardId: string) => boardId.startsWith('b_tasks_');
const hash = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
const listId = (board: string, status: string) => `l_task_${hash(`${board}|${status}`, 24)}`;

/** The catalog service of a brand_service (`tj_...`). */
export const serviceOf = async (brandServiceId: string) =>
  (
    await get<{ id: string; name: string }>(
      'SELECT s.id, s.name FROM brand_services bs JOIN service_catalog s ON s.id = bs.catalog_service_id WHERE bs.id = ? LIMIT 1',
      brandServiceId
    )
  ) || null;

/** Find a brand_service by (brand_id, catalog_service_id). */
export const brandServiceFor = async (brandId: string, catalogServiceId: string) =>
  (
    await get<any>(
      'SELECT * FROM brand_services WHERE brand_id = ? AND catalog_service_id = ? ORDER BY created_at, id LIMIT 1',
      brandId,
      catalogServiceId
    )
  ) || null;

/** Resolve a customer's brand_service for a catalog service (searching across its active brands, oldest first). */
export const projectOf = async (customerId: string, catalogServiceId: string, brandId?: string | null) => {
  if (brandId) return brandServiceFor(brandId, catalogServiceId);
  return (
    (await get<any>(
      `SELECT bs.*, br.customer_id
       FROM brand_services bs
       JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
       WHERE br.customer_id = ? AND bs.catalog_service_id = ?
       ORDER BY br.pos, bs.created_at, bs.id LIMIT 1`,
      customerId,
      catalogServiceId
    )) || null
  );
};

/** The board linked to a brand_service, if any. */
export const boardOfProject = async (brandServiceId: string) =>
  (await get<any>('SELECT * FROM boards WHERE brand_service_id = ?', brandServiceId)) || null;

/** Convenience lookup for brand + customer info of a brand_service. */
async function brandServiceContext(brandServiceId: string) {
  return get<any>(
    `SELECT bs.*, br.customer_id, br.name brand_name, s.name cat_name
     FROM brand_services bs
     LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
     LEFT JOIN service_catalog s ON s.id = bs.catalog_service_id
     WHERE bs.id = ?`,
    brandServiceId
  );
}

/** The workspace a customer's new service board goes to: the customer's first, else one made for it. */
export async function customerWorkspace(customerId: string) {
  const w = await get<any>('SELECT * FROM workspaces WHERE customer_id = ? ORDER BY created_at, id LIMIT 1', customerId);
  if (w) return w;
  const k = await get<any>('SELECT id, name, created_by, manager_id FROM customers WHERE id = ?', customerId);
  if (!k) throw new HttpError(404, 'Không tìm thấy khách hàng');
  const owner = k.manager_id || k.created_by || (await get<any>("SELECT id FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at, id LIMIT 1"))?.id || (await get<any>('SELECT id FROM users WHERE disabled = 0 ORDER BY created_at, id LIMIT 1'))?.id;
  if (!owner) return null;
  const id = `w_cust_${hash(k.id, 16)}`, t = now();
  await run("INSERT OR IGNORE INTO workspaces(id, name, about, owner_id, visibility, created_at, updated_at, customer_id) VALUES(?,?,?,?,'private',?,?,?)", id, k.name, '', owner, t, t, k.id);
  return get<any>('SELECT * FROM workspaces WHERE id = ?', id);
}

/** Make the board belong to the brand_service: its customer and catalog service follow. */
export async function linkBoard(boardId: string, brandServiceId: string, by: string | null) {
  const bs = await brandServiceContext(brandServiceId);
  await run('UPDATE boards SET brand_service_id = ?, customer_id = ?, updated_at = ? WHERE id = ?', brandServiceId, bs?.customer_id || null, now(), boardId);
  await saveBoardServices(boardId, bs?.catalog_service_id ? [bs.catalog_service_id] : [], by || bs?.created_by || '');
}

/** The board of a brand's service: its own, or created in the customer's workspace with workflow columns. */
export async function serviceBoard(brandServiceId: string) {
  const found = await boardOfProject(brandServiceId);
  if (found) return found;
  const bs = await brandServiceContext(brandServiceId);
  if (!bs?.customer_id) return null;
  const ws = await customerWorkspace(bs.customer_id);
  if (!ws) return null;
  const title = await boardDisplayName(bs.id);
  const id = `b_svc_${hash(bs.id, 16)}`, t = now();
  const pos = ((await get<any>('SELECT MAX(pos) n FROM boards'))?.n || 0) + 1;
  const made = await run(
    'INSERT OR IGNORE INTO boards(id, name, bg, created_by, pos, created_at, updated_at, private, customer_id, workspace_id, brand_service_id, start_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)',
    id,
    title,
    'ocean',
    bs.created_by || ws.owner_id,
    pos,
    t,
    t,
    bs.customer_id,
    ws.id,
    bs.id,
    t
  );
  if (made.changes) {
    for (const [i, l] of FLOW_COLUMNS.entries()) {
      await run('INSERT OR IGNORE INTO board_lists(id, board_id, name, pos, created_at, color) VALUES(?,?,?,?,?,?)', listId(id, l), id, l, i + 1, t, listColor(l));
    }
  }
  await linkBoard(id, bs.id, bs.created_by);
  await syncBoardPeople(id);
  await syncBoardGrants(id);
  return get<any>('SELECT * FROM boards WHERE id = ?', id);
}

/** Prevent duplicating a catalog service inside the same brand. Different brands of the same customer are allowed. */
export async function checkServiceFree(brandServiceId: string, catalogServiceId: string, targetBrandId?: string | null) {
  const bs = await get<any>('SELECT * FROM brand_services WHERE id = ?', brandServiceId);
  const brandId = targetBrandId !== undefined ? targetBrandId : bs?.brand_id;
  if (!brandId) return;
  const other = await brandServiceFor(brandId, catalogServiceId);
  if (other && other.id !== brandServiceId) {
    const b = await boardOfProject(other.id);
    const svc = await get<any>('SELECT name FROM service_catalog WHERE id = ?', catalogServiceId);
    throw new HttpError(409, `Nhãn hàng này đã có dịch vụ ${svc?.name || ''}${b ? ` (board “${b.name}”)` : ''}: mỗi dịch vụ của một nhãn hàng chỉ có một board`);
  }
}

export async function projectServiceChanged(brandServiceId: string, oldName: string | null, by: string) {
  const b = await boardOfProject(brandServiceId), svc = await serviceOf(brandServiceId);
  if (!b || !svc) return;
  await saveBoardServices(b.id, [svc.id], by);
  const targetName = await boardDisplayName(brandServiceId, svc.name);
  if (oldName && (b.name === oldName || b.name.endsWith(` · ${oldName}`))) await run('UPDATE boards SET name = ? WHERE id = ?', targetName, b.id);
  const bs = await get<any>('SELECT name FROM brand_services WHERE id = ?', brandServiceId);
  if (oldName && bs?.name === oldName) await run('UPDATE brand_services SET name = ? WHERE id = ?', svc.name, brandServiceId);
}

/** A brand_service's customer/brand changed: move its board to the new customer's workspace. */
export async function moveProjectBoard(brandServiceId: string) {
  const bs = await brandServiceContext(brandServiceId), b = await boardOfProject(brandServiceId);
  if (!bs || !b || !bs.customer_id) return;
  const ws = b.workspace_id ? await get<any>('SELECT customer_id FROM workspaces WHERE id = ?', b.workspace_id) : null;
  const target = ws?.customer_id === bs.customer_id ? b.workspace_id : (await customerWorkspace(bs.customer_id)).id;
  await run('UPDATE boards SET customer_id = ?, workspace_id = ?, updated_at = ? WHERE id = ?', bs.customer_id, target, now(), b.id);
  await syncBoardPeople(b.id);
  await syncBoardGrants(b.id);
  if (b.workspace_id && b.workspace_id !== target) await syncWorkspacePeople(b.workspace_id);
}

export const WS_AUTO = 'brand_service';

export async function syncWorkspacePeople(workspaceId: string) {
  const w = await get<any>('SELECT id, owner_id FROM workspaces WHERE id = ?', workspaceId);
  if (!w) return;
  const want = new Set(
    (
      await all<any>(
        "SELECT DISTINCT m.user_id FROM board_members m JOIN boards b ON b.id = m.board_id WHERE b.workspace_id = ? AND m.added_by IN ('project', 'brand_service')",
        w.id
      )
    ).map((r) => r.user_id as string)
  );
  for (const r of await all<any>('SELECT DISTINCT created_by user_id FROM boards WHERE workspace_id = ? AND created_by IS NOT NULL', w.id)) want.add(r.user_id);
  want.delete(w.owner_id);
  const have = new Map((await all<any>('SELECT user_id, added_by FROM workspace_members WHERE workspace_id = ?', w.id)).map((r) => [r.user_id as string, r.added_by as string | null]));
  for (const user of want) if (!have.has(user)) await run("INSERT INTO workspace_members(workspace_id, user_id, role, added_by, created_at) VALUES(?,?,'observer',?,?)", w.id, user, WS_AUTO, now());
  for (const [user, by] of have) if ((by === WS_AUTO || by === 'project') && !want.has(user)) await run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', w.id, user);
}

/** Gather cards of a brand_service onto its dedicated board. */
export async function gatherProjectCards(brandServiceId: string) {
  const b = await boardOfProject(brandServiceId);
  if (!b) return 0;
  const bs = await brandServiceContext(brandServiceId);
  const cards = await all<any>(
    `SELECT c.*, t.status, t.stage, t.done_at task_done
     FROM task_board_links l JOIN board_cards c ON c.id = l.card_id JOIN tasks t ON t.id = l.task_id
     WHERE t.brand_service_id = ? AND c.board_id <> ?`,
    brandServiceId,
    b.id
  );
  if (!cards.length) return 0;
  const lists = await all<any>('SELECT * FROM board_lists WHERE board_id = ? AND archived = 0 ORDER BY pos', b.id);
  const { columnFor } = await import('./tasklinks'), { columnStage } = await import('./flow-columns');
  const from = new Set<string>();
  for (const c of cards) {
    const list = columnFor(lists, c.status || '') || lists.find((l) => c.stage && columnStage(l.name) === c.stage) || lists[0];
    if (!list) continue;
    const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id = ?', list.id))?.n || 0) + 1;
    await run('UPDATE board_cards SET board_id = ?, list_id = ?, pos = ?, service_card_id = NULL, customer_id = ?, updated_at = ? WHERE id = ?', b.id, list.id, pos, bs?.customer_id || null, now(), c.id);
    await run('DELETE FROM card_labels WHERE card_id = ?', c.id);
    await run('UPDATE board_activity SET board_id = ? WHERE card_id = ?', b.id, c.id);
    from.add(c.board_id);
  }
  for (const id of from) { await syncBoardPeople(id); await syncBoardGrants(id); }
  await syncBoardPeople(b.id); await syncBoardGrants(b.id);
  return cards.length;
}

/** Normalize existing boards so customer workspaces hold one board per brand service. */
export async function migrateServiceBoards() {
  if (await getSetting('service_boards_v1', false)) return;
  for (const w of await all<any>('SELECT id FROM workspaces WHERE customer_id IS NULL')) {
    const ks = await all<any>('SELECT DISTINCT customer_id FROM boards WHERE workspace_id = ?', w.id);
    if (ks.length === 1 && ks[0].customer_id) await run('UPDATE workspaces SET customer_id = ? WHERE id = ?', ks[0].customer_id, w.id);
  }
  const touched = new Set<string>();
  for (const b of await all<any>("SELECT b.*, w.customer_id ws_customer FROM boards b LEFT JOIN workspaces w ON w.id = b.workspace_id WHERE b.brand_service_id IS NULL AND b.id NOT LIKE 'b_tasks_%' ORDER BY b.created_at")) {
    const svcs = await all<any>('SELECT bs.service_id FROM board_services bs JOIN service_catalog s ON s.id = bs.service_id AND s.deleted_at IS NULL WHERE bs.board_id = ?', b.id);
    const customer = b.ws_customer || b.customer_id;
    if (svcs.length !== 1 || !customer || (b.ws_customer && b.customer_id && b.ws_customer !== b.customer_id)) continue;
    let p = await projectOf(customer, svcs[0].service_id);
    if (!p) {
      let brand = await get<any>('SELECT id FROM brands WHERE customer_id = ? AND deleted_at IS NULL ORDER BY pos, created_at, id LIMIT 1', customer);
      if (!brand) {
        const cust = await get<any>('SELECT id, name, gloc, created_by, created_at FROM customers WHERE id = ?', customer);
        const bid = `br_default_${customer}`;
        await run("INSERT OR IGNORE INTO brands(id, customer_id, name, logo, notes, pos, drive_folder, created_by, created_at, updated_at, deleted_at) VALUES(?,?,?,NULL,'',0,?,?,?,?,NULL)", bid, customer, cust?.name || 'Mặc định', cust?.gloc || null, cust?.created_by || b.created_by, cust?.created_at || now(), now());
        brand = { id: bid };
      }
      const svc = await get<any>('SELECT name FROM service_catalog WHERE id = ?', svcs[0].service_id), id = uid('tj_'), t = now();
      await run('INSERT INTO brand_services(id, brand_id, catalog_service_id, name, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, brand.id, svcs[0].service_id, svc.name, b.created_by, t, t);
      p = { id };
    }
    if (await boardOfProject(p.id)) continue;
    await linkBoard(b.id, p.id, b.created_by);
    touched.add(b.id);
  }
  for (const p of await all<any>('SELECT id FROM brand_services WHERE brand_id IS NOT NULL ORDER BY created_at')) {
    if (!await serviceOf(p.id)) continue;
    const b = await serviceBoard(p.id);
    if (!b) continue;
    touched.add(b.id);
    await gatherProjectCards(p.id);
    await run("UPDATE board_cards SET archived = 1, updated_at = ? WHERE card_kind IN ('service', 'project') AND brand_service_id = ? AND archived = 0", now(), p.id);
  }
  for (const id of touched) { await syncBoardPeople(id); await syncBoardGrants(id); }
  for (const w of await all<any>('SELECT id FROM workspaces')) await syncWorkspacePeople(w.id);
  await setSetting('service_boards_v1', true);
}
