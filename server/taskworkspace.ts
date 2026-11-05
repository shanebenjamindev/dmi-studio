import {projectLevels} from './project-access';
// Real cards in the appropriate department boards. No task results or credentials are copied.
import { createHash } from 'node:crypto';
import { all, get, getSetting, setSetting, run, now } from './db';
import { USER_SQL,deptLevel } from './auth';
import { taskBoardCategory, type TaskBoardCategory } from '../shared/task-routing';
import { boardLevelForUser } from './boards';
import { syncTaskToCard } from './tasklinks';

const CATEGORIES: [TaskBoardCategory, string, string][] = [['media','Media Execute','ocean'],['content','Content / Script','sunset'],['ads','Ads / Performance','grape'],['website','Website','forest'],['account','Account / Sale','sky'],['general','Việc chung','slate']];
const listId = (board: string, status: string) => `l_task_${createHash('sha256').update(`${board}|${status}`).digest('hex').slice(0,24)}`;
export async function routeTaskToWorkspace(taskId: string, userId: string, options:{includeParents?:boolean} = {}) {
  const task = await get<any>('SELECT t.*,p.name project FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskId);
  if (!task || (task.stub&&!options.includeParents)) return false;
  if(task.project_id&&!(await projectLevels(userId)).has(task.project_id))return false;
  const user=await get<any>(`${USER_SQL} WHERE u.id=? AND u.disabled=0`,userId);
  if(!user)return false;
  const linked=await get<any>('SELECT c.* FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?',taskId);
  if(linked){
    const board=await get<any>('SELECT * FROM boards WHERE id=?',linked.board_id);
    const level=board?await boardLevelForUser(user,board):null;
    if(level&&level!=='observer')await syncTaskToCard(taskId);
    return false;
  }
  if(!await getSetting('task_workspace_auto',false))return false;
  if(user.role!=='admin'&&deptLevel(user)==='observer')return false;
  const category = taskBoardCategory(task.title,task.project || '');
  const [_, name, bg] = CATEGORIES.find((c)=>c[0]===category)!;
  const mapping = await getSetting<Record<string,string>>('task_workspace_boards',{});
  const key=`${userId}:${category}`;
  let board=mapping[key]?await get<any>('SELECT * FROM boards WHERE id=?',mapping[key]):null;
  if(board){const level=await boardLevelForUser(user,board);if(!level||level==='observer')board=null;}
  board ||= await get<any>('SELECT * FROM boards WHERE name=? AND created_by=? AND workspace_id IS NULL ORDER BY created_at LIMIT 1',name,userId);
  if(!board){
    const id=`b_tasks_${category}_${createHash('sha256').update(userId).digest('hex').slice(0,12)}`,time=now();
    await run('INSERT OR IGNORE INTO boards(id,name,bg,created_by,pos,created_at,updated_at,private) VALUES(?,?,?,?,?,?,?,1)',id,name,bg,userId,100,time,time);
    board=await get<any>('SELECT * FROM boards WHERE id=?',id);
  }
  mapping[key]=board.id;await setSetting('task_workspace_boards',mapping);
  const status=task.status || 'Chưa thực hiện';
  // Reuse matching columns, so the task belongs to the board's existing workflow.
  const names=task.done_at ? [status,'Đã giao','Đã xong','Hoàn tất','Xong','Đã báo cáo'] : /đánh giá|duyệt/i.test(status) ? [status,'Chờ duyệt'] : [status];
  const lists=await all<any>('SELECT * FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',board.id);
  let list=names.map((n)=>lists.find((l)=>l.name===n)).find(Boolean);
  if (!list) {
    const id=listId(board.id,status);
    await run('INSERT OR IGNORE INTO board_lists(id,board_id,name,pos,created_at) VALUES(?,?,?,?,?)',id,board.id,status,(lists.at(-1)?.pos||0)+1,now());
    list=await get<any>('SELECT * FROM board_lists WHERE id=?',id);
  }
  const cardId=`k_task_${taskId}`,time=now();
  const pos=(await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',list.id))?.n || 0;
  await run('INSERT OR IGNORE INTO board_cards(id,board_id,list_id,title,pos,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',cardId,board.id,list.id,task.title,pos+1,userId,time,time);
  const result=await run('INSERT OR IGNORE INTO task_board_links(task_id,card_id) VALUES(?,?)',taskId,cardId);
  if (!result.changes) { await run('DELETE FROM board_cards WHERE id=? AND id NOT IN (SELECT card_id FROM task_board_links)',cardId); return false; }
  await syncTaskToCard(taskId);
  return true;
}

export async function syncAllTasksToWorkspace(userId:string){
  await setSetting('task_workspace_auto',true);
  const allowed=await projectLevels(userId);
  const tasks=(await all<any>('SELECT id,project_id FROM tasks ORDER BY created_at,id')).filter(t=>!t.project_id||allowed.has(t.project_id));
  let created=0;
  for(const task of tasks)if(await routeTaskToWorkspace(task.id,userId,{includeParents:true}))created++;
  const linked=Number((await get<any>(`SELECT COUNT(*) n FROM task_board_links WHERE task_id IN (${tasks.length?tasks.map(()=>'?').join(','):"''"})`,...tasks.map(t=>t.id)))?.n||0);
  return {total:tasks.length,created,linked,remaining:tasks.length-linked};
}
