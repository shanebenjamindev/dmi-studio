import {all,get} from './db';
import {HttpError} from './http';
export type CustomerLevel='admin'|'normal'|'observer';
/** The department a user heads (their role there is at the 'admin' level), or null. */
export async function headedDepartment(userId:string):Promise<string|null>{
 return (await get<any>(`SELECT u.team_role FROM users u JOIN dept_roles d ON d.id=u.dept_role AND d.team_role_id=u.team_role WHERE u.id=? AND d.level='admin'`,userId))?.team_role||null;
}
/** Department heads manage the customers of the people in their department. */
async function headsOwner(userId:string,ownerId:string|null){
 const dept=ownerId&&await headedDepartment(userId);
 return !!dept&&!!await get('SELECT 1 FROM users WHERE id=? AND team_role=?',ownerId,dept);
}
/** A customer is deleted by its owner or the head of the owner's department; one nobody owns, by its managers. */
export async function canDeleteCustomer(userId:string,customer:{id:string;created_by:string|null}){
 if(customer.created_by)return customer.created_by===userId||await headsOwner(userId,customer.created_by);
 return await customerLevel(userId,customer.id)==='admin';
}
export async function customerLevels(userId:string){
 const map=new Map<string,CustomerLevel>(),dept=await headedDepartment(userId);
 for(const row of await all<any>('SELECT customer_id,role FROM customer_members WHERE user_id=?',userId))map.set(row.customer_id,row.role);
 if(dept)for(const row of await all<any>('SELECT c.id FROM customers c JOIN users o ON o.id=c.created_by WHERE o.team_role=?',dept))map.set(row.id,'admin');
 for(const row of await all<any>('SELECT id FROM customers WHERE created_by=?',userId))map.set(row.id,'admin');
 return map;
}
export async function customerLevel(userId:string,id:string):Promise<CustomerLevel|null>{
 const row=await get<any>('SELECT created_by FROM customers WHERE id=?',id);if(!row)return null;
 if(row.created_by===userId||await headsOwner(userId,row.created_by))return 'admin';
 return (await get<any>('SELECT role FROM customer_members WHERE customer_id=? AND user_id=?',id,userId))?.role||null;
}
export async function requireCustomer(userId:string,id:string,need:CustomerLevel='observer'){
 const level=await customerLevel(userId,id);if(!level)throw new HttpError(404,'Không tìm thấy khách hàng');
 if((need==='admin'&&level!=='admin')||(need==='normal'&&level==='observer'))throw new HttpError(403,'Bạn chưa được cấp quyền thao tác với khách hàng này');
 return level;
}
/** Takes the user's id three times: owner, member, head of the owner's department. */
export const customerAccessSql=(alias='c')=>`(${alias}.created_by=? OR EXISTS(SELECT 1 FROM customer_members cm WHERE cm.customer_id=${alias}.id AND cm.user_id=?) OR EXISTS(SELECT 1 FROM users head JOIN dept_roles d ON d.id=head.dept_role AND d.team_role_id=head.team_role JOIN users owner ON owner.team_role=head.team_role WHERE head.id=? AND d.level='admin' AND owner.id=${alias}.created_by))`;
export async function visibleCardIds(userId:string){
 const allowed=await customerLevels(userId);
 return new Set((await all<any>('SELECT c.id,c.customer_id,p.customer_id task_customer,p.created_by project_owner,t.project_id,(SELECT 1 FROM task_project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=?) project_member FROM board_cards c LEFT JOIN task_board_links l ON l.card_id=c.id LEFT JOIN tasks t ON t.id=l.task_id LEFT JOIN task_projects p ON p.id=t.project_id',userId)).filter(c=>(!c.project_id||c.project_owner===userId||c.project_member)&&(!c.customer_id||allowed.has(c.customer_id))&&(!c.task_customer||allowed.has(c.task_customer))).map(c=>c.id));
}
