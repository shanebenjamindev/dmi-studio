import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('Khách → Dịch vụ → Công việc: one project per customer × service, found again, kept to who may work on the customer',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dmi-service-axis-'));
 process.env.DATA_DIR=dir;process.env.DMS_RUNTIME='';process.env.CLOUD_STORAGE_ONLY='';
 const {run,get,all,db,setSetting}=await import('../server/db.ts');
 const {projectForService}=await import('../server/tasks.ts');
 const owner={id:'u_owner',team_role:null},stranger={id:'u_stranger',team_role:null};
 try{
  await setSetting('task_workspace_auto',false);
  for(const [id,name] of [['u_owner','Owner'],['u_stranger','Stranger']])
   await run('INSERT INTO users(id,email,name,role,created_at,updated_at) VALUES(?,?,?,?,1,1)',id,`${id}@example.test`,name,'member');
  await run("INSERT INTO customers(id,name,folder,created_by,created_at,updated_at) VALUES('c_one','Garage One','','u_owner',1,1)");
  await run("INSERT INTO services(id,name,created_at,updated_at) VALUES('sv_ads','Paid Ads',1,1),('sv_web','Website',1,1),('sv_gone','Old',1,1)");
  await run("UPDATE services SET deleted_at=2 WHERE id='sv_gone'");

  // Made on first use, named after the service, carrying it, and for the customer.
  const ads=await projectForService(owner,'c_one','sv_ads');
  assert.equal(ads.created,true);assert.equal(ads.name,'Paid Ads');
  const row=await get('SELECT customer_id FROM task_projects WHERE id=?',ads.id);assert.equal(row.customer_id,'c_one');
  assert.deepEqual((await all('SELECT service_id FROM project_services WHERE project_id=?',ads.id)).map(r=>r.service_id),['sv_ads']);

  // Found again (no second project), and another service is another project.
  const again=await projectForService(owner,'c_one','sv_ads');
  assert.equal(again.created,false);assert.equal(again.id,ads.id);
  const web=await projectForService(owner,'c_one','sv_web');
  assert.notEqual(web.id,ads.id);
  assert.equal((await get("SELECT COUNT(*) n FROM task_projects WHERE customer_id='c_one'")).n,2);

  // An older project the customer already had for a service is the one used.
  await run("INSERT INTO task_projects(id,name,customer_id,created_at) VALUES('tj_old','Website 2025','c_one',0)");
  await run("INSERT INTO project_services(project_id,service_id,created_at) VALUES('tj_old','sv_web',0)");
  assert.equal((await projectForService(owner,'c_one','sv_web')).id,'tj_old');

  // Refused: a missing pair, a service out of the catalogue, someone who cannot work on the customer.
  await assert.rejects(projectForService(owner,'c_one',''),(e)=>e.status===400);
  await assert.rejects(projectForService(owner,'c_one','sv_gone'),(e)=>e.status===404);
  await assert.rejects(projectForService(stranger,'c_one','sv_ads'),(e)=>e.status===403||e.status===404);

  // The request guard does not take `for-service` for a project id (it once answered "Không tìm thấy dự án").
  const {guard}=await import('../server/auth.ts');
  const crypto=await import('node:crypto');
  const token='tok-service-axis';
  await run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)',crypto.createHash('sha256').update(token).digest('hex'),'u_owner',1,Date.now()+864e5);
  const req=(url)=>({method:'POST',url,path:url,headers:{cookie:`dms_sid=${token}`,host:'localhost'},socket:{remoteAddress:'127.0.0.1'}});
  assert.equal((await guard(req('/api/task-projects/for-service'))).id,'u_owner');
  await assert.rejects(guard(req('/api/task-projects/tj_missing/campaigns')),(e)=>e.status===404||e.status===403);
 }finally{
  try{db?.close?.();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
