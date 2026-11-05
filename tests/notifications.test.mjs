import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('email notifications opt in, deduplicate, send only public task fields and cancel on opt out',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-notifications-'));
 process.env.DATA_DIR=dir;process.env.DMS_RUNTIME='';process.env.CLOUD_STORAGE_ONLY='';
 const {run,get,db,setSetting}=await import('../server/db.ts');
 const {notificationSnapshot,queueTaskNotifications,drainNotifications}=await import('../server/notifications.ts');
 const original=globalThis.fetch;const sent=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  sent.push(Buffer.from(JSON.parse(options.body).raw,'base64url').toString());return new Response('{}',{status:200});
 };
 try{
  await run("INSERT INTO users(id,email,name,role,created_at,updated_at) VALUES('u_fixture','fixture@example.test','Fixture','member',1,1)");
  await run("INSERT INTO task_people(id,name,user_id,created_at) VALUES('tp_fixture','Fixture','u_fixture',1)");
  await run("INSERT INTO tasks(id,title,status,description,result,created_at,updated_at) VALUES('tk_fixture','A public task','Chưa thực hiện','private description','private-result-secret',1,1)");
  await run("INSERT INTO task_assignees(task_id,person_id) VALUES('tk_fixture','tp_fixture')");
  await queueTaskNotifications('tk_fixture');assert.equal((await get('SELECT COUNT(*) n FROM mail_outbox')).n,0);
  await run("INSERT INTO notification_preferences(user_id,enabled,pending_email,updated_at) VALUES('u_fixture',1,'personal@example.test',1)");
  await queueTaskNotifications('tk_fixture');assert.equal((await get('SELECT COUNT(*) n FROM mail_outbox')).n,0);
  await run("UPDATE notification_preferences SET email=pending_email,pending_email=NULL,verified_at=1 WHERE user_id='u_fixture'");
  await setSetting('notification_site_url','https://studio.example.test');
  await queueTaskNotifications('tk_fixture');await queueTaskNotifications('tk_fixture');
  assert.equal((await get('SELECT COUNT(*) n FROM mail_outbox')).n,1);
  const payload=(await get('SELECT payload FROM mail_outbox')).payload;
  assert.ok(payload.includes('https://studio.example.test/#tasks/tk_fixture'));assert.equal(payload.includes('private'),false);
  assert.equal((await drainNotifications()).sent,0);assert.equal(sent.length,0);
  await setSetting('notification_mail',{email:'sender@example.test',name:'Fixture Sender',refresh:'fake-refresh',access:'fake-access',expiry:Date.now()+3600000});
  assert.equal((await drainNotifications()).sent,1);assert.equal(sent.length,1);
  assert.ok(sent[0].includes('To: personal@example.test'));assert.equal(sent[0].includes('fake-access'),false);
  const body=Buffer.from(sent[0].split('\r\n\r\n')[1],'base64').toString();assert.ok(body.includes('A public task'));assert.equal(body.includes('private'),false);
  const before=await notificationSnapshot('tk_fixture');
  await run("UPDATE tasks SET status='Hoàn thành',updated_at=2 WHERE id='tk_fixture'");
  await queueTaskNotifications('tk_fixture',before);assert.equal((await get("SELECT COUNT(*) n FROM mail_outbox WHERE state='pending'")).n,1);
  await run("UPDATE notification_preferences SET enabled=0 WHERE user_id='u_fixture'");
  await drainNotifications();assert.equal(sent.length,1);assert.equal((await get("SELECT COUNT(*) n FROM mail_outbox WHERE state='cancelled'")).n,1);
  await run("UPDATE notification_preferences SET enabled=1 WHERE user_id='u_fixture'");
  const previous=await notificationSnapshot('tk_fixture');
  await run("UPDATE tasks SET status='Đang thực hiện',updated_at=3 WHERE id='tk_fixture'");
  await queueTaskNotifications('tk_fixture',previous);
  await run("DELETE FROM task_assignees WHERE task_id='tk_fixture'");
  await drainNotifications();assert.equal(sent.length,1);
  assert.equal((await get("SELECT COUNT(*) n FROM mail_outbox WHERE state='cancelled'")).n,2);

 }finally{globalThis.fetch=original;db.close();await rm(dir,{recursive:true,force:true});}
});
