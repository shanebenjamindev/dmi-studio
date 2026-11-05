import {projectLevels} from './project-access';
import {customerLevel,visibleCardIds} from './customer-access';
import {gmailEnableUrl} from '../shared/gmail-errors';
import {createHash,randomInt,timingSafeEqual} from 'node:crypto';
import {all,get,run,getSetting,setSetting,now,uid} from './db';
import {currentUser} from './auth';
import {Router,HttpError,json,readJson,publicOrigin,type Req} from './http';
import * as G from './google';

type Snapshot={status:string;due_at:number|null;users:string[];followers:string[]};
export async function notificationSnapshot(taskId:string):Promise<Snapshot>{
 const task=await get<any>('SELECT status,due_at FROM tasks WHERE id=?',taskId);
 return {status:task?.status||'',due_at:task?.due_at??null,users:(await all<any>('SELECT DISTINCT p.user_id FROM task_assignees a JOIN task_people p ON p.id=a.person_id WHERE a.task_id=? AND p.user_id IS NOT NULL',taskId)).map(r=>r.user_id),followers:(await all<any>('SELECT user_id FROM task_followers WHERE task_id=?',taskId)).map(r=>r.user_id)};
}
const TITLES:Record<string,string>={assigned:'Bạn được giao công việc',updated:'Công việc được cập nhật',followed:'Bạn được thêm theo dõi công việc',created:'Công việc mới bạn đang theo dõi',subtask:'Có công việc con mới bạn đang theo dõi',followed_updated:'Công việc bạn theo dõi được cập nhật'};
/** Only task name, status, deadline and an authenticated app link enter emails, never results or descriptions. */
export async function queueTaskNotifications(taskId:string,before?:Snapshot){
 const task=await get<any>('SELECT t.id,t.title,t.status,t.due_at,t.updated_at,t.project_id,t.parent_id,p.customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskId);
 if(!task)return;
 const after=await notificationSnapshot(taskId);
 const base=await getSetting('notification_site_url',process.env.PUBLIC_URL||'');
 const changed=!!before&&(before.status!==task.status||before.due_at!==task.due_at);
 // Assignees first: someone both assigned and following hears about it once, as an assignee.
 const recipients=new Map<string,string|null>();
 for(const userId of after.users)recipients.set(userId,!before?.users.includes(userId)?'assigned':changed?'updated':null);
 for(const userId of after.followers)if(!recipients.has(userId))recipients.set(userId,!before?.followers.includes(userId)?(before?'followed':task.parent_id?'subtask':'created'):changed?'followed_updated':null);
 for(const [userId,kind] of recipients){
  if(task.project_id&&!(await projectLevels(userId)).has(task.project_id))continue;
  if(!kind||task.customer_id&&!await customerLevel(userId,task.customer_id))continue;
  const id='mail_'+createHash('sha256').update(JSON.stringify([task.id,userId,kind,task.updated_at,task.status,task.due_at])).digest('hex').slice(0,32);
  const payload={taskId:task.id,title:TITLES[kind],task:task.title,status:task.status,due:task.due_at,url:base?`${base}/#tasks/${task.id}/page`:''};
  await run('INSERT OR IGNORE INTO notifications(id,user_id,task_id,payload,created_at) VALUES(?,?,?,?,?)',id,userId,task.id,JSON.stringify(payload),now());
  if(!await get('SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND email IS NOT NULL AND verified_at IS NOT NULL',userId))continue;
  await run('INSERT OR IGNORE INTO mail_outbox(id,user_id,payload,created_at) VALUES(?,?,?,?)',id,userId,JSON.stringify(payload),now());
 }
}
/** Tell people about something done that concerns them (a card, board, project or customer): in the app at once, by
 *  email when they have it on. Whoever did it is not told. As with tasks, only names and an app link go out. */
export async function notifyPeople(userIds:Iterable<string>,actorId:string|null,n:{title:string;body:string;link:string;cardId?:string;commentId?:string}){
 const base=await getSetting('notification_site_url',process.env.PUBLIC_URL||''),at=now();
 for(const userId of new Set(userIds)){
  if(!userId||userId===actorId||!await get('SELECT 1 FROM users WHERE id=? AND disabled=0',userId))continue;
  const id='mail_'+createHash('sha256').update(JSON.stringify([userId,n.title,n.link,n.body,at])).digest('hex').slice(0,32);
  const payload={title:n.title,task:n.body,link:n.link,cardId:n.cardId,commentId:n.commentId,url:base?`${base}/${n.link}`:''};
  await run('INSERT OR IGNORE INTO notifications(id,user_id,task_id,payload,created_at) VALUES(?,?,?,?,?)',id,userId,null,JSON.stringify(payload),at);
  if(!await get('SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND email IS NOT NULL AND verified_at IS NOT NULL',userId))continue;
  await run('INSERT OR IGNORE INTO mail_outbox(id,user_id,payload,created_at) VALUES(?,?,?,?)',id,userId,JSON.stringify(payload),at);
 }
}
/** What a notification is about, for the person's own inbox (never in mail): a task's status, due date and the start of
 *  its description; a card's list and due date with the comment it is about, or the start of its description. */
async function detailOf(taskId:string|null,p:any,userId:string,seesCard:(id:string)=>Promise<boolean>){
 const cut=(v:unknown)=>{const t=String(v||'').replace(/\s+/g,' ').trim();return t.length>280?t.slice(0,279)+'…':t;};
 if(taskId){const t=await get<any>('SELECT status,due_at,description FROM tasks WHERE id=?',taskId);return t?{status:t.status as string,dueAt:(t.due_at??null) as number|null,text:cut(t.description)}:null;}
 if(!p.cardId)return null;
 const c=await get<any>('SELECT c.description,c.due_at,c.done,c.board_id,l.name list FROM board_cards c JOIN board_lists l ON l.id=c.list_id WHERE c.id=?',p.cardId);
 if(!c||!await seesCard(p.cardId)||!await get('SELECT 1 FROM card_members WHERE card_id=? AND user_id=? UNION SELECT 1 FROM boards WHERE id=? AND created_by=? UNION SELECT 1 FROM board_members WHERE board_id=? AND user_id=?',p.cardId,userId,c.board_id,userId,c.board_id,userId))return null;
 const comment=p.commentId?await get<any>('SELECT text FROM card_comments WHERE id=?',p.commentId):null;
 return {status:(c.done?'Hoàn thành':c.list) as string,dueAt:(c.due_at??null) as number|null,text:cut(comment?comment.text:c.description)};
}
export async function drainNotifications(limit=10){
 if(!await getSetting('notification_mail',null))return {sent:0,failed:0};
 let sent=0,failed=0;
 const rows=await all<any>("SELECT id FROM mail_outbox WHERE state='pending' AND attempts<5 AND next_at<=? AND locked_until<? ORDER BY created_at LIMIT ?",now(),now(),limit);
 const deliver=async(candidate:any)=>{
  const row=await get<any>("UPDATE mail_outbox SET locked_until=?, attempts=attempts+1 WHERE id=? AND state='pending' AND attempts<5 AND locked_until<? RETURNING *",now()+120000,candidate.id,now());
  if(!row)return;
  const user=await get<any>('SELECT p.email FROM users u JOIN notification_preferences p ON p.user_id=u.id WHERE u.id=? AND u.disabled=0 AND p.enabled=1 AND p.email IS NOT NULL AND p.verified_at IS NOT NULL',row.user_id);
  if(!user){await run("UPDATE mail_outbox SET state='cancelled',locked_until=0 WHERE id=?",row.id);return;}
  try{
   const body=JSON.parse(row.payload);
   if(body.taskId&&!await get('SELECT 1 FROM tasks t JOIN task_assignees a ON a.task_id=t.id JOIN task_people p ON p.id=a.person_id WHERE t.id=? AND p.user_id=?',body.taskId,row.user_id)&&!await get('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?',body.taskId,row.user_id)){await run("UPDATE mail_outbox SET state='cancelled',locked_until=0 WHERE id=?",row.id);return;}
   if(body.taskId){const task=await get<any>('SELECT t.project_id,p.customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',body.taskId);if(task?.project_id&&!(await projectLevels(row.user_id)).has(task.project_id)||task?.customer_id&&!await customerLevel(row.user_id,task.customer_id)){await run("UPDATE mail_outbox SET state='cancelled',locked_until=0 WHERE id=?",row.id);return;}}
   if(body.cardId&&!await get('SELECT 1 FROM board_cards WHERE id=?',body.cardId)){await run("UPDATE mail_outbox SET state='cancelled',locked_until=0 WHERE id=?",row.id);return;}
   const due=body.due?new Date(body.due).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'Chưa có thời hạn';
   const text=body.link?`${body.title}\n\n${body.task}\n\n${body.url}\n\nBạn có thể tắt thông báo email trong Hồ sơ của tôi.`:body.task?`${body.title}\n\n${body.task}\nTrạng thái: ${body.status}\nThời hạn: ${due}\n\n${body.url}\n\nBạn có thể tắt thông báo email trong Hồ sơ của tôi.`:'Bạn đã kết nối thông báo email với DM Workspace.\n\nĐây là email kiểm tra do bạn yêu cầu.';
   await G.sendNotificationMail(user.email,`DM Workspace · ${body.title}`,text);
   await run("UPDATE mail_outbox SET state='sent',sent_at=?,locked_until=0,error=NULL WHERE id=?",now(),row.id);sent++;
  }catch(e:any){
   await run("UPDATE mail_outbox SET state=?,next_at=?,locked_until=0,error=? WHERE id=?",row.attempts>=5?'failed':'pending',now()+Math.min(3600000,15000*2**(row.attempts-1)),String(e.message||'Không gửi được email').slice(0,400),row.id);failed++;
  }
 };
 // A few at a time, so one change that tells many people does not make the last of them wait (Gmail allows short bursts).
 for(let i=0;i<rows.length;i+=3)await Promise.all(rows.slice(i,i+3).map(deliver));
 return {sent,failed};
}
async function admin(req:Req){const user=await currentUser(req);if(user?.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên cấu hình tài khoản gửi mail');return user;}
export function registerNotifications(api:Router){
 api.get('/api/notifications',async(req,res)=>{
  const user=(await currentUser(req))!;
  const pref=await get<any>('SELECT * FROM notification_preferences WHERE user_id=?',user.id);
  const sender=await getSetting<G.GAccount|null>('notification_mail',null),config=await G.oauthConfig();
  const recent=(await all<any>('SELECT id,payload,state,created_at,sent_at,error FROM mail_outbox WHERE user_id=? AND json_extract(payload,\'$.test\') IS NULL ORDER BY created_at DESC LIMIT 5',user.id)).map(row=>({id:row.id,title:JSON.parse(row.payload).title,state:row.state,createdAt:row.created_at,sentAt:row.sent_at,error:row.error||null}));
  const issue=await getSetting('notification_mail_issue',null);
  json(res,200,{enabled:!!pref?.enabled,loginEmail:user.email,email:pref?.email||null,verified:!!pref?.verified_at,pendingEmail:pref?.pending_email||null,codeSent:!!pref?.verification_hash,sender:user.role==='admin'?sender?.email||null:null,mailReady:!!sender,googleConfigured:!!(config.clientId&&config.clientSecret),...(user.role==='admin'?{gmailSetupUrl:gmailEnableUrl(config.clientId.match(/^(\d+)-/)?.[1]||''),mailIssue:issue}:{}),recent});
 });
 api.put('/api/notifications',async(req,res)=>{
  const user=(await currentUser(req))!,body=await readJson(req);
  if(typeof body.enabled!=='boolean')throw new HttpError(400,'Hãy chọn bật hoặc tắt nhận email');
  if(body.enabled&&!await get('SELECT 1 FROM notification_preferences WHERE user_id=? AND email IS NOT NULL AND verified_at IS NOT NULL',user.id))throw new HttpError(400,'Hãy xác minh email cá nhân trước khi bật nhận thư');
  await run('INSERT INTO notification_preferences(user_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at',user.id,body.enabled?1:0,now());
  if(!body.enabled)await run("UPDATE mail_outbox SET state='cancelled' WHERE user_id=? AND state='pending'",user.id);
  json(res,200,{ok:true});
 });
 api.get('/api/notifications/mail/connect',async(req,res)=>{
  const user=await admin(req);await setSetting('notification_site_url',publicOrigin(req));
  const url=await G.authUrl(`${publicOrigin(req)}/api/google/callback`,'mail',user.id);
  res.writeHead(302,{location:url});res.end();
 });
 api.delete('/api/notifications/mail',async(req,res)=>{await admin(req);await setSetting('notification_mail',null);await setSetting('notification_mail_issue',null);json(res,200,{ok:true});});
 api.post('/api/notifications/email/request',async(req,res)=>{
  const user=(await currentUser(req))!,body=await readJson(req),email=String(body.email||'').trim().toLowerCase();
  if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Email cá nhân không hợp lệ');
  // Without a sending account the address is only kept; the code can be asked for once an admin connects Gmail.
  if(!await getSetting('notification_mail',null)){
   await run('INSERT INTO notification_preferences(user_id,enabled,updated_at,pending_email) VALUES(?,0,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_email=excluded.pending_email,verification_hash=NULL,updated_at=excluded.updated_at',user.id,now(),email);
   return json(res,200,{sent:false});
  }
  const old=await get<any>('SELECT verification_sent_at FROM notification_preferences WHERE user_id=?',user.id);
  if(old?.verification_sent_at>now()-60000)throw new HttpError(429,'Đợi một phút trước khi yêu cầu mã mới');
  const code=String(randomInt(100000,1000000)),hash=createHash('sha256').update(user.id+':'+code).digest('hex');
  await run('INSERT INTO notification_preferences(user_id,enabled,updated_at,pending_email,verification_hash,verification_expires,verification_attempts,verification_sent_at) VALUES(?,0,?,?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET pending_email=excluded.pending_email,verification_hash=excluded.verification_hash,verification_expires=excluded.verification_expires,verification_attempts=0,verification_sent_at=excluded.verification_sent_at',user.id,now(),email,hash,now()+600000,now());
  try{await G.sendNotificationMail(email,'DM Workspace · Xác minh email cá nhân',`Mã xác minh email của bạn: ${code}\n\nMã có hiệu lực 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`);}catch(e){await run('UPDATE notification_preferences SET verification_hash=NULL WHERE user_id=?',user.id);throw e;}
  json(res,200,{sent:true});
 });
 api.post('/api/notifications/email/verify',async(req,res)=>{
  const user=(await currentUser(req))!,body=await readJson(req);
  const pref=await get<any>('UPDATE notification_preferences SET verification_attempts=verification_attempts+1 WHERE user_id=? AND verification_hash IS NOT NULL AND verification_expires>=? AND verification_attempts<5 RETURNING *',user.id,now());
  if(!pref)throw new HttpError(400,'Mã xác minh hết hạn; hãy yêu cầu mã mới');
  const hash=createHash('sha256').update(user.id+':'+String(body.code||'').trim()).digest('hex');
  if(!timingSafeEqual(Buffer.from(hash),Buffer.from(pref.verification_hash)))throw new HttpError(400,'Mã xác minh không đúng');
  await run('UPDATE notification_preferences SET email=pending_email,verified_at=?,enabled=1,pending_email=NULL,verification_hash=NULL,verification_expires=NULL,updated_at=? WHERE user_id=? AND verification_hash=? AND pending_email=?',now(),now(),user.id,pref.verification_hash,pref.pending_email);
  json(res,200,{verified:true});
 });
 api.delete('/api/notifications/email',async(req,res)=>{
  const user=(await currentUser(req))!;await run('UPDATE notification_preferences SET enabled=0,email=NULL,verified_at=NULL,pending_email=NULL,verification_hash=NULL WHERE user_id=?',user.id);
  await run("UPDATE mail_outbox SET state='cancelled' WHERE user_id=? AND state='pending'",user.id);json(res,200,{ok:true});
 });
 api.post('/api/notifications/test',async(req,res)=>{
  const user=(await currentUser(req))!,pref=await get<any>('SELECT email FROM notification_preferences WHERE user_id=? AND enabled=1 AND verified_at IS NOT NULL',user.id);
  if(!pref?.email)throw new HttpError(400,'Hãy xác minh email cá nhân và bật nhận thư trước');
  if(await get('SELECT 1 FROM mail_outbox WHERE user_id=? AND created_at>? AND json_extract(payload,\'$.test\')=1',user.id,now()-60000))throw new HttpError(429,'Đợi một phút trước khi gửi thử lại');
  const id=uid('mail_');await run('INSERT INTO mail_outbox(id,user_id,payload,created_at) VALUES(?,?,?,?)',id,user.id,JSON.stringify({title:'Kiểm tra kết nối email',test:1}),now());
  try{await G.sendNotificationMail(pref.email,'DM Workspace · Kiểm tra kết nối','Email cá nhân của bạn đã được liên kết với DM Workspace.');await run("UPDATE mail_outbox SET state='sent',sent_at=?,attempts=1 WHERE id=?",now(),id);json(res,200,{sent:true});}
  catch(e:any){await run("UPDATE mail_outbox SET state='failed',attempts=1,error=? WHERE id=?",e.message,id);throw e;}
 });
 // Asked every few seconds by each open page: only when something new came is the whole inbox read again.
 api.get('/api/notifications/latest',async(req,res)=>{const user=(await currentUser(req))!;json(res,200,{latest:Number((await get<any>('SELECT MAX(created_at) n FROM notifications WHERE user_id=?',user.id))?.n)||0});});
 api.get('/api/notifications/inbox',async(req,res)=>{
  const user=(await currentUser(req))!;const rows=await all<any>('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id);
  const items:{id:string;taskId:string|null;link:string|null;title:string;body:string;createdAt:number;read:boolean;detail:Awaited<ReturnType<typeof detailOf>>}[]=[];
  let projects:Map<string,string>|null=null,cards:Set<string>|null=null;
  const seesCard=async(id:string)=>(cards??=await visibleCardIds(user.id)).has(id);
  for(const row of rows){
   if(row.task_id){const task=await get<any>('SELECT t.project_id,p.customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',row.task_id);if(!task||task.project_id&&!(projects??=await projectLevels(user.id)).has(task.project_id)||task.customer_id&&!await customerLevel(user.id,task.customer_id))continue;const own=await get('SELECT 1 FROM task_assignees a JOIN task_people p ON p.id=a.person_id WHERE a.task_id=? AND p.user_id=?',row.task_id,user.id)||await get('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?',row.task_id,user.id);if(!own)continue;}
   const p=JSON.parse(row.payload);if(p.cardId&&!await get('SELECT 1 FROM board_cards WHERE id=?',p.cardId))continue;
   // The newest ones show what they are about, read now, so never more than the person may still see.
   items.push({id:row.id,taskId:row.task_id,link:p.link||null,title:p.title,body:p.task||'',createdAt:row.created_at,read:!!row.read_at,detail:items.length<30?await detailOf(row.task_id,p,user.id,seesCard):null});
  }
  json(res,200,{items,unread:items.filter(item=>!item.read).length});
 });

 api.post('/api/notifications/read',async(req,res)=>{const user=(await currentUser(req))!,body=await readJson(req);if(body.id)await run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',now(),String(body.id),user.id);else await run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),user.id);json(res,200,{ok:true});});
}
