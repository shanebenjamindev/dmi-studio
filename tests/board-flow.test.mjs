import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('every board follows the review workflow: a column per step, no Quá hạn column, cards where their step is',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-board-flow-'));
 process.env.DATA_DIR=dir;process.env.DMS_RUNTIME='';process.env.CLOUD_STORAGE_ONLY='';
 const {run,get,all,db}=await import('../server/db.ts');
 const {columnStage}=await import('../server/flow-columns.ts');
 const {normalizeBoard,normalizeAllBoards}=await import('../server/board-flow.ts');
 const {syncCardToTask,assertCardFlow}=await import('../server/tasklinks.ts');
 const cols=async(b)=>(await all('SELECT name FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',b)).map(r=>r.name);
 const listOf=async(card)=>(await get('SELECT l.name FROM board_cards c JOIN board_lists l ON l.id=c.list_id WHERE c.id=?',card)).name;
 try{
  // What a column stands for, by meaning, whatever the board calls it.
  assert.deepEqual(['Cần làm','Cần dựng','Khách mới','Chuẩn bị','Đang làm','Đang dựng','Cần sửa','Tối ưu','Chờ duyệt','Xong','Done','Đã giao','Hoàn tất','Đã báo cáo','Đã huỷ','Overdue','Tạm dừng','Chờ brief'].map(columnStage),
   ['account','account','account','account','execution','execution','execution','execution','review','completed','completed','completed','completed','completed','rejected',null,null,null]);
  // The steps' own codes, the columns boards are made with.
  assert.deepEqual(['ACCOUNT','EXECUTION','REVIEW','COMPLETED','REJECTED'].map(columnStage),['account','execution','review','completed','rejected']);

  await run("INSERT INTO users(id,email,name,role,created_at,updated_at) VALUES('u_a','a@example.test','A','member',1,1)");
  await run("INSERT INTO task_people(id,name,user_id,created_at) VALUES('tp_a','A','u_a',1)");
  // The board of the screenshot: Cần làm, Đang làm, Done, Overdue.
  await run("INSERT INTO boards(id,name,bg,pos,created_at,updated_at) VALUES('b_one','Board','ocean',1,1,1),('b_media','Media','ocean',2,1,1)");
  await run("INSERT INTO board_lists(id,board_id,name,pos,created_at) VALUES('l_todo','b_one','Cần làm',1,1),('l_doing','b_one','Đang làm',2,1),('l_done','b_one','Done',3,1),('l_late','b_one','Overdue',4,1)");
  await run("INSERT INTO board_lists(id,board_id,name,pos,created_at) VALUES('m1','b_media','Cần dựng',1,1),('m2','b_media','Đang dựng',2,1),('m3','b_media','Chờ duyệt',3,1),('m4','b_media','Cần sửa',4,1),('m5','b_media','Đã giao',5,1)");
  // A task waiting for review sits in Đang làm; one marked "Overdue" sits in the Overdue column; a plain card too.
  await run("INSERT INTO tasks(id,title,status,stage,created_by,created_at,updated_at) VALUES('tk_rev','Review me','Đang đánh giá','review','tp_a',1,1),('tk_late','Late','Overdue','execution','tp_a',1,1),('tk_fix','Fix','Đang thực hiện','execution','tp_a',1,1)");
  await run("INSERT INTO board_cards(id,board_id,list_id,title,pos,done,created_at,updated_at) VALUES('k_rev','b_one','l_doing','Review me',1,0,1,1),('k_late','b_one','l_late','Late',1,0,1,1),('k_plain','b_one','l_late','Plain',2,0,1,1),('k_fix','b_media','m4','Fix',1,0,1,1)");
  await run("INSERT INTO task_board_links(task_id,card_id) VALUES('tk_rev','k_rev'),('tk_late','k_late'),('tk_fix','k_fix')");

  const r=await normalizeBoard('b_one');
  // A board as it was made: its columns take the codes.
  assert.deepEqual(await cols('b_one'),['ACCOUNT','EXECUTION','REVIEW','COMPLETED','REJECTED']);
  assert.deepEqual(r.added,['REVIEW','REJECTED']);assert.deepEqual(r.renamed,['Cần làm → ACCOUNT','Đang làm → EXECUTION','Done → COMPLETED']);assert.deepEqual(r.archived,['Overdue']);
  assert.equal((await get("SELECT archived FROM board_lists WHERE id='l_late'")).archived,1);   // kept, not deleted
  assert.equal(await listOf('k_rev'),'REVIEW');
  assert.equal(await listOf('k_late'),'EXECUTION');
  assert.equal(await listOf('k_plain'),'EXECUTION');
  assert.equal((await get("SELECT status FROM tasks WHERE id='tk_late'")).status,'Đang thực hiện');

  // A board of its own columns keeps them, gets only the step it lacks; a card in Cần sửa stays there.
  await normalizeBoard('b_media');
  assert.deepEqual(await cols('b_media'),['Cần dựng','Đang dựng','Chờ duyệt','Cần sửa','Đã giao','REJECTED']);
  assert.equal(await listOf('k_fix'),'Cần sửa');

  // An older review column made after Xong moves before it; a column of no step keeps to the one before it.
  await run("INSERT INTO boards(id,name,bg,pos,created_at,updated_at) VALUES('b_old','Old','ocean',3,1,1)");
  await run("INSERT INTO board_lists(id,board_id,name,pos,created_at) VALUES('o1','b_old','Khách mới',1,1),('o2','b_old','Chờ brief',2,1),('o3','b_old','Đang làm',3,1),('o4','b_old','Xong',4,1),('o5','b_old','Đang đánh giá',5,1)");
  const o=await normalizeBoard('b_old');
  assert.equal(o.reordered,true);
  assert.deepEqual(await cols('b_old'),['Khách mới','Chờ brief','Đang làm','Đang đánh giá','Xong','REJECTED']);

  // Done once: running it again changes nothing.
  // A task whose status says another step than its own (set by a drag before the workflow) takes its step's status,
  // and its card the column of its step.
  await run("INSERT INTO tasks(id,title,status,stage,created_by,created_at,updated_at) VALUES('tk_mix','Mixed','Đang đánh giá','execution','tp_a',1,1)");
  await run("INSERT INTO board_cards(id,board_id,list_id,title,pos,done,created_at,updated_at) VALUES('k_mix','b_one',(SELECT id FROM board_lists WHERE board_id='b_one' AND name='REVIEW'),'Mixed',5,0,1,1)");
  await run("INSERT INTO task_board_links(task_id,card_id) VALUES('tk_mix','k_mix')");
  await normalizeBoard('b_one');
  assert.equal((await get("SELECT status FROM tasks WHERE id='tk_mix'")).status,'Đang thực hiện');
  assert.equal(await listOf('k_mix'),'EXECUTION');

  const again=await normalizeBoard('b_one');
  assert.deepEqual([again.added,again.archived,again.renamed,again.colored,again.reordered,again.cardsMoved],[[],[],[],0,false,0]);
  // Each step's column wears its step's colour; a board's own columns keep theirs (none).
  assert.deepEqual((await all("SELECT color FROM board_lists WHERE board_id='b_one' AND archived=0 ORDER BY pos")).map(r=>r.color),['black','blue','purple','green','red']);
  assert.equal((await get("SELECT color FROM board_lists WHERE id='m2'")).color,null);
  assert.deepEqual(await normalizeAllBoards(),{boards:3,changed:0});
  assert.deepEqual(await normalizeAllBoards(),{boards:0,changed:0});                       // the flag: once

  // Dropping a card on a Quá hạn column no longer makes "Overdue" its task's status; the card goes back.
  await run("INSERT INTO board_lists(id,board_id,name,pos,created_at) VALUES('l_late2','b_one','Quá hạn',9,1)");
  await run("UPDATE board_cards SET list_id='l_late2' WHERE id='k_late'");
  await syncCardToTask('k_late',true,'u_a');
  assert.equal((await get("SELECT status FROM tasks WHERE id='tk_late'")).status,'Đang thực hiện');
  assert.equal(await listOf('k_late'),'EXECUTION');

  // The columns are the workflow: a drag to the next step's column makes that step's move; any other drag is refused.
  const ids=Object.fromEntries((await all("SELECT id,name FROM board_lists WHERE board_id='b_one' AND archived=0")).map(r=>[r.name,r.id]));
  await run("INSERT INTO tasks(id,title,status,stage,created_by,created_at,updated_at) VALUES('tk_d','Drag','Chưa thực hiện','account','tp_a',1,1)");
  await run("INSERT INTO task_assignees(task_id,person_id) VALUES('tk_d','tp_a')");
  await run("INSERT INTO board_cards(id,board_id,list_id,title,pos,done,created_at,updated_at) VALUES('k_d','b_one',?,'Drag',9,0,1,1)",ids.ACCOUNT);
  await run("INSERT INTO task_board_links(task_id,card_id) VALUES('tk_d','k_d')");
  const doer={id:'u_a',role:'member'},admin={id:'u_admin',role:'admin'};
  const drag=async(to,who,extra={})=>{await assertCardFlow('k_d',{listId:ids[to],...extra},who);await run('UPDATE board_cards SET list_id=? WHERE id=?',ids[to],'k_d');await syncCardToTask('k_d',true,who.id);};
  const tk=()=>get("SELECT stage,status,done_at FROM tasks WHERE id='tk_d'");
  const needs=(p)=>p.then(()=>null,(e)=>[e.status,e.need||null]);
  await drag('EXECUTION',doer);assert.equal((await tk()).stage,'execution');assert.equal((await tk()).status,'Đang thực hiện');
  await drag('ACCOUNT',doer);assert.equal((await tk()).stage,'account');                       // back, to give out again
  await drag('EXECUTION',doer);
  assert.deepEqual(await needs(assertCardFlow('k_d',{listId:ids.REJECTED},doer)),[409,null]);   // only a review fails it
  // Straight to COMPLETED: handed in, then passed if this account may grade it; its doer may not, so it waits in REVIEW.
  await drag('COMPLETED',doer);assert.equal((await tk()).stage,'review');assert.equal(await listOf('k_d'),'REVIEW');
  // REVIEW back: REDO, which says what to fix (asked for when missing).
  assert.deepEqual(await needs(assertCardFlow('k_d',{listId:ids.EXECUTION},admin)),[409,'feedback']);
  await drag('EXECUTION',admin,{feedback:'Sửa tiêu đề'});assert.equal((await tk()).stage,'execution');
  assert.equal((await get("SELECT revision FROM tasks WHERE id='tk_d'")).revision,1);
  await drag('REVIEW',doer);await drag('COMPLETED',admin);assert.equal((await tk()).stage,'completed');assert.ok((await tk()).done_at);
  assert.equal((await get("SELECT done FROM board_cards WHERE id='k_d'")).done,1);
  // Closed: dragged back, it is reopened (the reason asked for, which may be empty).
  assert.deepEqual(await needs(assertCardFlow('k_d',{listId:ids.EXECUTION},admin)),[409,'reason']);
  await drag('EXECUTION',admin,{reason:''});assert.equal((await tk()).stage,'execution');assert.equal(await listOf('k_d'),'EXECUTION');
 }finally{
  try{db?.close?.();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
