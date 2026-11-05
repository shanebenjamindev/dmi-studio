import {all,get,run,now} from './db';
import {HttpError} from './http';
import {customerLevel,customerLevels,requireCustomer,type CustomerLevel} from './customer-access';
export async function projectLevels(userId:string){
 const customers=await customerLevels(userId),levels=new Map<string,CustomerLevel>();
 for(const p of await all<any>('SELECT p.*,m.role member_role FROM task_projects p LEFT JOIN task_project_members m ON m.project_id=p.id AND m.user_id=?',userId)){
  if(p.customer_id&&!customers.has(p.customer_id))continue;
  const level=p.created_by===userId?'admin':p.member_role;
  if(level)levels.set(p.id,level);
 }
 return levels;
}
export async function requireProject(userId:string,id:string,need:CustomerLevel='observer'){
 const p=await get<any>('SELECT * FROM task_projects WHERE id=?',id);
 if(!p)throw new HttpError(404,'Không tìm thấy dự án');
 const level=p.created_by===userId?'admin':(await get<any>('SELECT role FROM task_project_members WHERE project_id=? AND user_id=?',id,userId))?.role;
 if(!level)throw new HttpError(404,'Không tìm thấy dự án');
 if(p.customer_id)await requireCustomer(userId,p.customer_id,need==='observer'?'observer':'normal');
 if(need==='admin'&&level!=='admin'||need==='normal'&&level==='observer')throw new HttpError(403,'Bạn chưa được cấp quyền sửa dự án');
 return level as CustomerLevel;
}

const RANK:Record<CustomerLevel,number>={observer:1,normal:2,admin:3};
/** Whoever is put on a card or task, wherever, sees what it belongs to: a project and customer they lack (or have at a
 *  lower level) are opened to them at `level`; nothing is ever lowered. A project opened this way does not make them a
 *  follower of all its tasks. Managers change the level afterwards in the members dialogs. */
export async function grantAccess(userId:string,by:string,{projectId,customerId}:{projectId?:string|null;customerId?:string|null},level:'normal'|'observer'){
 const customers=new Set([customerId].filter(Boolean) as string[]);
 const project=projectId?await get<any>('SELECT id,created_by,customer_id FROM task_projects WHERE id=?',projectId):null;
 if(project?.customer_id)customers.add(project.customer_id);
 for(const id of customers){
  const has=await customerLevel(userId,id);
  if(!has||RANK[has]<RANK[level])await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',id,userId,level,by,now());
 }
 if(project&&project.created_by!==userId){
  const has=(await get<any>('SELECT role FROM task_project_members WHERE project_id=? AND user_id=?',project.id,userId))?.role as CustomerLevel|undefined;
  if(!has)await run('INSERT INTO task_project_members(project_id,user_id,role,follows) VALUES(?,?,?,0)',project.id,userId,level);
  else if(RANK[has]<RANK[level])await run('UPDATE task_project_members SET role=? WHERE project_id=? AND user_id=?',level,project.id,userId);
 }
}
