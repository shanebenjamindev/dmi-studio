// Every board follows the review workflow (shared/task-flow.ts): it has a column for each step — its own, whatever they
// are called (flow-columns.ts), plus one of the usual name for a step it lacks, placed in the workflow's order — and no
// Quá hạn column (being late is the due date's): its cards go to the column of their step and it is archived, kept.
// The tasks on it then take the status of their step where theirs was a late flag, and their cards the right column.
// A board as it was made (columns of the old Vietnamese names only) has them renamed to the steps' codes, and a step's
// column with no colour takes the step's.
import { all, get, run, now, uid, getSetting, setSetting } from './db';
import { normName, statusKey } from './taskimport';
import { FLOW_COLUMN, FLOW_LIST_COLOR, FLOW_ORDER, OLD_COLUMN, codeStage, columnStage, isOverdueColumn } from './flow-columns';
import { flowSettings, stageOf, statusFor } from './task-flow';
import { syncTaskToCard } from './tasklinks';
import { isFlowStage, type FlowStage } from '../shared/task-flow';

type List = { id: string; name: string; pos: number; color?: string | null; added?: boolean };

/** One board made to follow the workflow; what it changed. */
export async function normalizeBoard(boardId: string) {
  const out = { added: [] as string[], archived: [] as string[], renamed: [] as string[], colored: 0, reordered: false, cardsMoved: 0, tasksRestatused: 0 };
  const lists: List[] = await all<any>('SELECT id,name,pos,color FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos', boardId);
  // Its columns of a step all of the old names, one for each step at most: they take the codes (Cần làm → ACCOUNT).
  const stepped = lists.filter((l) => columnStage(l.name) && !codeStage(l.name));
  const old = (l: List) => OLD_COLUMN[columnStage(l.name)!].includes(normName(l.name));
  if (stepped.length && stepped.every(old) && new Set(stepped.map((l) => columnStage(l.name))).size === stepped.length)
    for (const l of stepped) {
      const code = FLOW_COLUMN[columnStage(l.name)!];
      if (lists.some((x) => x.name === code)) continue;
      await run('UPDATE board_lists SET name=? WHERE id=?', code, l.id);
      out.renamed.push(`${l.name} → ${code}`);
      l.name = code;
    }
  const late = lists.filter((l) => isOverdueColumn(l.name));
  const kept = lists.filter((l) => !isOverdueColumn(l.name));

  // A column named after its step (ACCOUNT…) with no colour of its own takes its step's.
  for (const l of lists) {
    const step = codeStage(l.name);
    if (step && !l.color) { await run('UPDATE board_lists SET color=? WHERE id=?', FLOW_LIST_COLOR[step], l.id); l.color = FLOW_LIST_COLOR[step]; out.colored++; }
  }
  // A column for every step, a missing one right after the last column of an earlier step.
  for (const stage of FLOW_ORDER) {
    if (kept.some((l) => columnStage(l.name) === stage)) continue;
    const i = FLOW_ORDER.indexOf(stage);
    let at = -1;
    kept.forEach((l, k) => { const s = columnStage(l.name); if (s && FLOW_ORDER.indexOf(s) < i) at = k; });
    const list: List = { id: uid('l_'), name: FLOW_COLUMN[stage], pos: 0, added: true };
    kept.splice(at + 1, 0, list);
    out.added.push(list.name);
  }
  // Open steps before the closing ones (an older Đang đánh giá made after Xong comes before it). Among open steps the
  // board's order stays (Cần sửa after Chờ duyệt is its redo loop), and a column of no step keeps to the one before it.
  const closing = (s: FlowStage) => (s === 'completed' ? 1 : s === 'rejected' ? 2 : 0);
  let step = -1;
  const rank = kept.map((l) => { const s = columnStage(l.name); if (s) step = closing(s); return step; });
  const order = kept.map((l, k) => ({ l, r: rank[k], k })).sort((a, b) => a.r - b.r || a.k - b.k).map((x) => x.l);
  const reordered = order.some((l, k) => l !== kept[k]);
  kept.splice(0, kept.length, ...order);
  if (out.added.length || reordered) {
    const t = now();
    for (const [k, l] of kept.entries()) {
      if (l.added) await run('INSERT INTO board_lists(id,board_id,name,pos,created_at,color) VALUES(?,?,?,?,?,?)', l.id, boardId, l.name, k + 1, t, FLOW_LIST_COLOR[codeStage(l.name)!]);
      else if (l.pos !== k + 1) await run('UPDATE board_lists SET pos=? WHERE id=?', k + 1, l.id);
    }
  }
  if (reordered) out.reordered = true;
  const columnOf = (stage: FlowStage) => kept.find((l) => columnStage(l.name) === stage)!;

  // A Quá hạn column empties into the column of each card's step (no task: done or still being worked on), then goes.
  for (const l of late) {
    for (const c of await all<any>('SELECT c.id, c.done, t.stage FROM board_cards c LEFT JOIN task_board_links k ON k.card_id=c.id LEFT JOIN tasks t ON t.id=k.task_id WHERE c.list_id=?', l.id)) {
      const stage: FlowStage = isFlowStage(c.stage) ? c.stage : c.done ? 'completed' : 'execution';
      const to = columnOf(stage);
      const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?', to.id))?.n || 0) + 1;
      await run('UPDATE board_cards SET list_id=?, pos=? WHERE id=?', to.id, pos, c.id);
      out.cardsMoved++;
    }
    await run('UPDATE board_lists SET archived=1 WHERE id=?', l.id);
    out.archived.push(l.name);
  }

  // Its tasks: a late flag for a status becomes the status of the step; every card then sits in its step's column.
  const cfg = await flowSettings();
  for (const t of await all<any>('SELECT t.* FROM tasks t JOIN task_board_links k ON k.task_id=t.id JOIN board_cards c ON c.id=k.card_id WHERE c.board_id=?', boardId)) {
    // A task in the workflow takes its step's status where its own says something else (late, or another step's).
    if (isFlowStage(t.stage) && (statusKey(t.status) === 'overdue' || ![true, false].some((given) => stageOf({ status: t.status, done_at: t.done_at }, given, cfg) === t.stage))) {
      await run('UPDATE tasks SET status=?, updated_at=? WHERE id=?', await statusFor(t.stage, t, t.done_at, cfg), now(), t.id);
      out.tasksRestatused++;
    }
    const before = (await get<any>('SELECT list_id FROM board_cards c JOIN task_board_links k ON k.card_id=c.id WHERE k.task_id=?', t.id))?.list_id;
    await syncTaskToCard(t.id);
    const after = (await get<any>('SELECT list_id FROM board_cards c JOIN task_board_links k ON k.card_id=c.id WHERE k.task_id=?', t.id))?.list_id;
    if (before !== after) out.cardsMoved++;
  }
  if (out.added.length || out.archived.length || out.renamed.length || out.colored || out.reordered || out.cardsMoved) await run('UPDATE boards SET updated_at=? WHERE id=?', now(), boardId);
  return out;
}

/** Every board (`force`: again, though it was done once already); how many boards changed. */
export async function normalizeAllBoards(force = false) {
  const KEY = 'board_flow_columns_v4';
  if (!force && await getSetting(KEY, false)) return { boards: 0, changed: 0 };
  let changed = 0;
  const boards = await all<any>('SELECT id FROM boards');
  for (const b of boards) {
    const r = await normalizeBoard(b.id);
    if (r.added.length || r.archived.length || r.renamed.length || r.colored || r.reordered || r.cardsMoved || r.tasksRestatused) changed++;
  }
  await setSetting(KEY, now());
  return { boards: boards.length, changed };
}
