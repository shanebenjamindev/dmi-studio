import {projectLevels} from './project-access';
// Tasks on Workspace: a task of a project is a card under the project's card, on the board of the project's customer
// (one made for each customer) or, with no customer, on the project's own board (unclassified); a task of no project is
// a card on its maker's own board of its kind. No task results or credentials are copied.
import { createHash } from 'node:crypto';
import { all, get, getSetting, setSetting, run, now } from './db';
import { USER_SQL,deptLevel } from './auth';
import { taskBoardCategory, type TaskBoardCategory } from '../shared/task-routing';
import { boardLevelForUser } from './boards';
import { columnFor, syncTaskToCard } from './tasklinks';
import { statusKey } from './taskimport';
import { FLOW_COLUMNS, columnStage, listColor } from './flow-columns';
import { isFlowStage } from '../shared/task-flow';
import { customerBoardId, syncBoardGrants, syncBoardPeople, syncProjectBoards } from './board-people';
import { boardOfProject, gatherProjectCards, moveProjectBoard, serviceBoard } from './service-boards';

const CATEGORIES: [TaskBoardCategory, string, string][] = [['media','Media Execute','ocean'],['content','Content / Script','sunset'],['ads','Ads / Performance','grape'],['website','Website','forest'],['account','Account / Sale','sky'],['general','Việc chung','slate']];
/** The board of a project of no customer: its own, named after it (unclassified boards). */
export const projectBoardId = (projectId: string) => `b_proj_${createHash('sha256').update(projectId).digest('hex').slice(0, 16)}`;
/** A renamed project's own board takes the new name (when it has one). */
export async function renameProjectBoard(projectId: string, name: string, old?: string) {
  await run('UPDATE boards SET name=? WHERE id=?', name, projectBoardId(projectId));
  // Its service board (server/service-boards.ts) while it still has the project's old name; one its people renamed keeps theirs.
  if (old) await run('UPDATE boards SET name=? WHERE project_id=? AND name=?', name, projectId, old);
}
const HOME_LISTS = FLOW_COLUMNS;
async function makeBoard(id: string, name: string, owner: string | null, customerId: string | null) {
  owner ||= (await get<any>("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1"))?.id || null;
  const t = now();
  const made = await run('INSERT OR IGNORE INTO boards(id,name,bg,created_by,pos,created_at,updated_at,private,customer_id) VALUES(?,?,?,?,?,?,?,1,?)', id, name, 'ocean', owner, 90, t, t, customerId);
  if (made.changes) for (const [i, l] of HOME_LISTS.entries()) await run('INSERT INTO board_lists(id,board_id,name,pos,created_at,color) VALUES(?,?,?,?,?,?)', listId(id, l), id, l, i + 1, t, listColor(l));
  return get<any>('SELECT * FROM boards WHERE id=?', id);
}
/** The customer's own board, made the first time, named after it and kept by whoever keeps the customer: the projects
 *  of the customer made outside a board go there. */
export async function customerBoard(customerId: string) {
  const k = await get<any>('SELECT id,name,created_by,manager_id FROM customers WHERE id=?', customerId);
  return k ? makeBoard(customerBoardId(k.id), k.name, k.created_by || k.manager_id, k.id) : null;
}
/** Where a project lives on Workspace: its board, the customer's service (server/service-boards.ts), made the first time
 *  in the customer's workspace. A project of no customer has none. */
export async function projectHome(projectId: string) {
  const board = await serviceBoard(projectId);
  return board ? { board, card: null as any } : null;
}
async function firstList(boardId: string) {
  const list = await get<any>('SELECT * FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos LIMIT 1', boardId);
  if (list) return list;
  const id = listId(boardId, 'Dịch vụ');
  await run('INSERT OR IGNORE INTO board_lists(id,board_id,name,pos,created_at) VALUES(?,?,?,?,?)', id, boardId, 'Dịch vụ', 1, now());
  await run('UPDATE board_lists SET archived=0 WHERE id=?', id);
  return get<any>('SELECT * FROM board_lists WHERE id=?', id);
}
/** A board made for projects (a customer's or a project's own), not one someone made. */
const madeForProjects = (boardId: string) => /^b_(cust|proj)_/.test(boardId);
/** A project's customer changed: its cards and its tasks' cards are for the new one, and its board goes to the new
 *  customer's workspace (server/service-boards.ts). */
export async function projectCustomerChanged(projectId: string) {
  const p = await get<any>('SELECT * FROM task_projects WHERE id=?', projectId);
  if (!p) return;
  await run('UPDATE board_cards SET customer_id=?, updated_at=? WHERE work_project_id=? OR id IN (SELECT l.card_id FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE t.project_id=?)', p.customer_id || null, now(), p.id, p.id);
  if (await boardOfProject(p.id)) await moveProjectBoard(p.id);
  else if (p.customer_id) { await serviceBoard(p.id); await gatherProjectCards(p.id); }
  await syncProjectBoards(p.id);
}
/** People of the project's boards (it changed who is in it). */
export const syncProjectBoardMembers = (projectId: string) => syncProjectBoards(projectId);
/** The column of `board` for a task's status (an existing one of that meaning, else one made for it). */
async function listFor(board: any, task: any) {
  const status=task.status || 'Chưa thực hiện';
  // Reuse matching columns, so the task belongs to the board's existing workflow.
  const lists=await all<any>('SELECT * FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',board.id);
  // A column of its name or meaning (see columnFor); a done task in a board's own last step (Đã giao, Đã báo cáo); one
  // waiting for review in Chờ duyệt; one not started in the board's first column. Only then a column of its own.
  const named=(...n:string[])=>n.map((x)=>lists.find((l)=>l.name===x)).find(Boolean);
  const found=columnFor(lists,status)||(isFlowStage(task.stage)?lists.find((l)=>columnStage(l.name)===task.stage):undefined)||(task.done_at?named('Đã giao','Đã báo cáo'):/đánh giá|duyệt/i.test(status)?named('Chờ duyệt'):statusKey(status)==='todo'?lists[0]:undefined);
  if (found) return found;
  const id=listId(board.id,status);
  await run('INSERT OR IGNORE INTO board_lists(id,board_id,name,pos,created_at,color) VALUES(?,?,?,?,?,?)',id,board.id,status,(lists.at(-1)?.pos||0)+1,now(),listColor(status));
  return get<any>('SELECT * FROM board_lists WHERE id=?',id);
}
/** The card made for a task of a project goes on the project's board (see projectHome): one made before (on its maker's
 *  own board) or of a task moved to another project goes there, keeping its comments, checklists and people. */
export async function placeTaskCard(taskId: string) {
  // Whichever card it is linked to: the tasks of a customer's service are on that service's board.
  const card=await get<any>('SELECT c.* FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?',taskId);
  const task=await get<any>('SELECT t.*,p.customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskId);
  if(!card||!task?.project_id)return;
  const home=await projectHome(task.project_id);
  if(!home)return;
  if(card.board_id!==home.board.id){
    const targetList = await listFor(home.board, task);
    const pos=(await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',targetList.id))?.n||0;
    const from=card.board_id;
    await run('UPDATE board_cards SET board_id=?,list_id=?,pos=?,project_card_id=NULL,customer_id=?,updated_at=? WHERE id=?',home.board.id,targetList.id,pos+1,task.customer_id||null,now(),card.id);
    await run('DELETE FROM card_labels WHERE card_id=?',card.id); // labels are the old board's
    await run('UPDATE board_activity SET board_id=? WHERE card_id=?',home.board.id,card.id);
    await run('UPDATE boards SET updated_at=? WHERE id IN (?,?)', now(), home.board.id, from);
    await syncBoardPeople(from); await syncBoardGrants(from);
  }
  await shareTaskCard(taskId);
}
const listId = (board: string, status: string) => `l_task_${createHash('sha256').update(`${board}|${status}`).digest('hex').slice(0,24)}`;
export async function routeTaskToWorkspace(taskId: string, userId: string, options:{includeParents?:boolean} = {}) {
  const task = await get<any>('SELECT t.*,p.name project,p.customer_id project_customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskId);
  if (!task || (task.stub&&!options.includeParents)) return false;
  if(task.project_id&&!(await projectLevels(userId)).has(task.project_id))return false;
  const user=await get<any>(`${USER_SQL} WHERE u.id=? AND u.disabled=0`,userId);
  if(!user)return false;
  const linked=await get<any>('SELECT c.* FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?',taskId);
  if(linked){
    const board=await get<any>('SELECT * FROM boards WHERE id=?',linked.board_id);
    const level=board?await boardLevelForUser(user,board):null;
    if(level==='normal'||level==='admin')await syncTaskToCard(taskId);
    await placeTaskCard(taskId);
    return false;
  }
  // A new task shows on Workspace by itself (an admin can still turn this off with the setting).
  if(!await getSetting('task_workspace_auto',true))return false;
  if(user.role!=='admin'&&deptLevel(user)==='observer')return false;

  let board: any = null, parentCardId: string | null = null;
  const customerId = task.project_customer_id || null;

  if (task.project_id) {
    const home = await projectHome(task.project_id);
    if (home) board = home.board;
  } else if (customerId) {
    const custCard = await get<any>("SELECT id, board_id FROM board_cards WHERE card_kind='customer' AND customer_id=? AND archived=0 ORDER BY created_at LIMIT 1", customerId);
    if (custCard) {
      board = await get<any>('SELECT * FROM boards WHERE id=?', custCard.board_id);
      parentCardId = custCard.id;
    }
  }

  if (!board) board = await ownBoard(task, user, userId);
  const list = await listFor(board, task);
  const cardId = `k_task_${taskId}`, time = now();
  const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?', list.id))?.n || 0) + 1;
  await run("INSERT OR IGNORE INTO board_cards(id,board_id,list_id,title,pos,created_by,created_at,updated_at,card_kind,project_card_id,customer_id) VALUES(?,?,?,?,?,?,?,?,'task',?,?)",
    cardId, board.id, list.id, task.title, pos, userId, time, time, parentCardId, customerId);
  const result = await run('INSERT OR IGNORE INTO task_board_links(task_id,card_id) VALUES(?,?)', taskId, cardId);
  if (!result.changes) { await run('DELETE FROM board_cards WHERE id=? AND id NOT IN (SELECT card_id FROM task_board_links)', cardId); return false; }
  await run('UPDATE boards SET updated_at=? WHERE id=?', time, board.id);
  await syncTaskToCard(taskId);
  await shareTaskCard(taskId);
  return true;
}
/** The board of a task's kind (Media Execute, Việc chung…) among the boards made for its maker's own tasks. */
async function ownBoard(task:any,user:any,userId:string){
  const category = taskBoardCategory(task.title,task.project || '');
  const [_, name, bg] = CATEGORIES.find((c)=>c[0]===category)!;
  const mapping = await getSetting<Record<string,string>>('task_workspace_boards',{});
  const key=`${userId}:${category}`;
  // Only a board made here for this person's tasks: never a department's or the company's (no columns added to those).
  let board=mapping[key]?.startsWith('b_tasks_')?await get<any>('SELECT * FROM boards WHERE id=?',mapping[key]):null;
  if(board){const level=await boardLevelForUser(user,board);if(level!=='normal'&&level!=='admin')board=null;}
  board ||= await get<any>("SELECT * FROM boards WHERE id LIKE 'b_tasks_%' AND name=? AND created_by=? AND workspace_id IS NULL ORDER BY created_at LIMIT 1",name,userId);
  if(!board){
    const id=`b_tasks_${category}_${createHash('sha256').update(userId).digest('hex').slice(0,12)}`,time=now();
    await run('INSERT OR IGNORE INTO boards(id,name,bg,created_by,pos,created_at,updated_at,private) VALUES(?,?,?,?,?,?,?,1)',id,name,bg,userId,100,time,time);
    board=await get<any>('SELECT * FROM boards WHERE id=?',id);
  }
  mapping[key]=board.id;await setSetting('task_workspace_boards',mapping);
  return board;
}

/** The accounts a task is given to. */
export const assigneeUsers=async(taskId:string)=>(await all<any>('SELECT DISTINCT p.user_id FROM task_assignees a JOIN task_people p ON p.id=a.person_id JOIN users u ON u.id=p.user_id WHERE a.task_id=? AND u.disabled=0',taskId)).map(r=>r.user_id as string);
/** The people a task is given to are on the card made for it, and come off it when it is given to someone else
 *  (`before`: who it was given to). On the board of its project they join the board (they see only their projects'
 *  cards there); a task of no project sits on its maker's own board, which holds their other work, so there they are
 *  on the card only. A task linked by hand to a card elsewhere leaves that card's people as they are. */
export async function shareTaskCard(taskId:string,before:string[]=[]){
  const card=await get<any>('SELECT c.id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=? AND c.id=?',taskId,`k_task_${taskId}`);
  if(!card)return;
  const now_=await assigneeUsers(taskId);
  for(const id of before.filter(x=>!now_.includes(x)))await run('DELETE FROM card_members WHERE card_id=? AND user_id=?',card.id,id);
  for(const id of now_)await run('INSERT OR IGNORE INTO card_members(card_id,user_id) VALUES(?,?)',card.id,id);
  const project=(await get<any>('SELECT project_id FROM tasks WHERE id=?',taskId))?.project_id;
  if(project)await syncProjectBoards(project);
}

export async function syncAllTasksToWorkspace(userId:string){
  await setSetting('task_workspace_auto',true);
  const allowed=await projectLevels(userId);
  const tasks=(await all<any>('SELECT id,project_id FROM tasks ORDER BY created_at,id')).filter(t=>!t.project_id||allowed.has(t.project_id));
  let created=0;
  for(const task of tasks)if(await routeTaskToWorkspace(task.id,userId,{includeParents:true}))created++;
  // One bound list (D1 takes at most 100 parameters in a statement).
  const linked=Number((await get<any>('SELECT COUNT(*) n FROM task_board_links WHERE task_id IN (SELECT value FROM json_each(?))',JSON.stringify(tasks.map(t=>t.id))))?.n||0);
  return {total:tasks.length,created,linked,remaining:tasks.length-linked};
}
