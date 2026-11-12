import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('review workflow: redo loop keeps every round, closed tasks stay closed until reopened, reminders once a day',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-task-flow-'));
 process.env.DATA_DIR=dir;process.env.DMS_RUNTIME='';process.env.CLOUD_STORAGE_ONLY='';
 const {run,get,all,db}=await import('../server/db.ts');
 const {applyFlow,flowDetail,statusBlocked,stageOf,remindTasks,settleStages}=await import('../server/task-flow.ts');
 const {setSetting}=await import('../server/db.ts');
 const {syncCardToTask}=await import('../server/tasklinks.ts');
 const task=()=>get("SELECT * FROM tasks WHERE id='tk_flow'");
 const account={id:'u_account',role:'member'},doer={id:'u_doer',role:'member'},admin={id:'u_admin',role:'admin'};
 const refused=async(p,code)=>{await assert.rejects(p,(e)=>e.status===code);};
 try{
  for(const [id,name,role] of [['u_account','Account','member'],['u_doer','Doer','member'],['u_admin','Boss','admin']])
   await run('INSERT INTO users(id,email,name,role,created_at,updated_at) VALUES(?,?,?,?,1,1)',id,`${id}@example.test`,name,role);
  await run("INSERT INTO task_people(id,name,user_id,created_at) VALUES('tp_account','Account','u_account',1),('tp_doer','Doer','u_doer',1)");
  await run("INSERT INTO tasks(id,title,status,created_by,result,stage,created_at,updated_at) VALUES('tk_flow','Landing page','Chưa thực hiện','tp_account','v1',  'account',1,1)");

  // Account: giving it out needs someone to do it.
  await refused(applyFlow(await task(),account,true,'start'),400);
  await run("INSERT INTO task_assignees(task_id,person_id) VALUES('tk_flow','tp_doer')");
  await applyFlow(await task(),account,true,'start');
  assert.equal((await task()).stage,'execution');assert.equal((await task()).status,'Đang thực hiện');

  // Execution → Review, with what was handed in kept.
  await applyFlow(await task(),doer,true,'submit',{note:'first try'});
  assert.equal((await task()).stage,'review');assert.ok((await task()).submitted_at);
  await refused(applyFlow(await task(),doer,true,'pass'),403);           // not the reviewer
  await refused(applyFlow(await task(),account,true,'redo',{}),400);     // a redo says what to fix
  await applyFlow(await task(),account,true,'redo',{feedback:'Fix the header'});
  let t=await task();assert.equal(t.stage,'execution');assert.equal(t.revision,1);

  // The second round: the first stays as it was handed in and graded.
  await run("UPDATE tasks SET result='v2' WHERE id='tk_flow'");
  await applyFlow(await task(),doer,true,'submit');
  await applyFlow(await task(),account,true,'pass');
  t=await task();assert.equal(t.stage,'completed');assert.equal(t.status,'Hoàn thành');assert.ok(t.done_at);
  const rounds=await all("SELECT round,result,outcome,feedback FROM task_reviews WHERE task_id='tk_flow' ORDER BY round");
  assert.deepEqual(rounds.map(r=>[r.round,r.result,r.outcome,r.feedback]),[[1,'v1','redo','Fix the header'],[2,'v2','pass',null]]);
  const shown=await flowDetail(t,doer,true,true);
  assert.equal(shown.rounds.length,2);assert.equal(shown.can.reopen,false);assert.equal(shown.reviewer.name,'Account');

  // Closed: no status by hand, no board move back, no new submission, until its reviewer reopens it.
  assert.ok(statusBlocked(t,'Đang thực hiện'));
  await refused(applyFlow(t,doer,true,'submit'),409);
  await refused(applyFlow(t,doer,true,'reopen'),403);
  await run("INSERT INTO boards(id,name,bg,pos,created_at,updated_at) VALUES('b_flow','Board','#0079bf',1,1,1)");
  await run("INSERT INTO board_lists(id,board_id,name,pos,created_at) VALUES('l_doing','b_flow','Đang thực hiện',1,1),('l_done','b_flow','Hoàn thành',2,1)");
  await run("INSERT INTO board_cards(id,board_id,list_id,title,pos,done,created_at,updated_at) VALUES('k_flow','b_flow','l_doing','Landing page',1,0,1,1)");
  await run("INSERT INTO task_board_links(task_id,card_id) VALUES('tk_flow','k_flow')");
  await syncCardToTask('k_flow',true,'u_doer');
  assert.equal((await task()).status,'Hoàn thành');assert.equal((await get("SELECT list_id FROM board_cards WHERE id='k_flow'")).list_id,'l_done');
  await applyFlow(await task(),account,true,'reopen',{reason:'Client asked for more'});
  assert.equal((await task()).stage,'execution');assert.equal((await task()).done_at,null);

  // Open: only a review finishes it; you do not grade your own submission.
  assert.ok(statusBlocked(await task(),'Hoàn thành'));assert.equal(statusBlocked(await task(),'Tạm dừng'),null);
  await applyFlow(await task(),account,true,'submit');
  await refused(applyFlow(await task(),account,true,'fail',{feedback:'x'}),403);
  await applyFlow(await task(),admin,true,'fail',{feedback:'Out of scope'});
  assert.equal((await task()).stage,'rejected');assert.equal((await task()).status,'Đã huỷ');

  // Tasks from before the workflow: stage read from their status, statuses stay free.
  assert.equal(stageOf({status:'Hoàn thành'},true),'completed');assert.equal(stageOf({status:'Chưa thực hiện'},false),'account');
  assert.equal(stageOf({status:'Đang đánh giá'},true),'review');assert.equal(statusBlocked({status:'Hoàn thành'},'Đang thực hiện'),null);

  // Reminders: overdue work to its people, waiting reviews to the reviewer, once a day, from 8:00 Vietnam time.
  const at=Date.UTC(2026,10,12,3);    // 10:00 in Vietnam
  await run("INSERT INTO tasks(id,title,status,created_by,stage,due_at,created_at,updated_at) VALUES('tk_late','Late one','Đang thực hiện','tp_account','execution',?,1,1)",at-3600e3);
  await run("INSERT INTO task_assignees(task_id,person_id) VALUES('tk_late','tp_doer')");
  await run("INSERT INTO tasks(id,title,status,created_by,stage,submitted_at,created_at,updated_at) VALUES('tk_wait','Waiting one','Đang đánh giá','tp_account','review',?,1,1)",at-30*3600e3);
  await run("INSERT INTO tasks(id,title,status,created_by,due_at,created_at,updated_at) VALUES('tk_old','Old done','Hoàn thành','tp_account',?,1,1)",at-3600e3);
  assert.equal((await remindTasks(Date.UTC(2026,10,11,23))).sent,0);  // 6:00 in Vietnam
  assert.equal((await remindTasks(at)).sent,2);
  assert.equal((await remindTasks(at+600e3)).sent,0);
  const told=await all("SELECT user_id,payload FROM notifications WHERE payload LIKE '%#tasks/tk_late/page%' OR payload LIKE '%#tasks/tk_wait/page%' ORDER BY user_id");
  assert.deepEqual(told.map(n=>n.user_id),['u_account','u_doer']);
  assert.equal((await remindTasks(at+864e5)).sent,2);

  // Existing data joins the workflow: done ones closed (locked), cancelled rejected, the rest by status and people.
  await run("INSERT INTO tasks(id,title,status,created_by,done_at,created_at,updated_at) VALUES('tk_x1','Done before','Hoàn thành','tp_account',5,1,1),('tk_x2','Cancelled','Đã huỷ','tp_account',NULL,1,1),('tk_x3','Reviewing','Đang đánh giá','tp_account',NULL,1,7),('tk_x4','Open','Chưa thực hiện','tp_account',NULL,1,1),('tk_x5','Delivered','Đã giao','tp_account',9,1,1)");
  await run("INSERT INTO task_assignees(task_id,person_id) VALUES('tk_x4','tp_doer')");
  assert.ok(await settleStages()>=5);assert.equal(await settleStages(),0);
  const stages=Object.fromEntries((await all("SELECT id,stage,submitted_at FROM tasks WHERE id LIKE 'tk_x%'")).map(r=>[r.id,r.stage]));
  assert.deepEqual(stages,{tk_x1:'completed',tk_x2:'rejected',tk_x3:'review',tk_x4:'execution',tk_x5:'completed'});
  assert.equal((await get("SELECT submitted_at FROM tasks WHERE id='tk_x3'")).submitted_at,7);
  assert.ok(statusBlocked(await get("SELECT * FROM tasks WHERE id='tk_x1'"),'Đang thực hiện'));

  // What Quản trị sets: a stage's name and status, and the reminders.
  await run("INSERT INTO task_statuses(id,name,color,pos,active,created_at,updated_at) VALUES('ts_wait','Chờ khách duyệt','#8b5cf6',9,1,1,1)");
  await setSetting('task_flow',{stages:{review:{name:'Khách duyệt',status:'Chờ khách duyệt'}},remindHour:11});
  await applyFlow(await get("SELECT * FROM tasks WHERE id='tk_x4'"),doer,true,'submit');
  assert.equal((await get("SELECT status FROM tasks WHERE id='tk_x4'")).status,'Chờ khách duyệt');
  assert.equal((await flowDetail(await get("SELECT * FROM tasks WHERE id='tk_x4'"),doer,true,true)).stages.find(s=>s.key==='review').name,'Khách duyệt');
  assert.equal(stageOf({status:'Chờ khách duyệt'},true,(await import('../shared/task-flow.ts')).flowConfig({stages:{review:{status:'Chờ khách duyệt'}}})),'review');
  assert.equal((await remindTasks(at+2*864e5)).sent,0);   // 10:00, before 11:00
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
