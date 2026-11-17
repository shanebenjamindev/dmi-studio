import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('Khách → Nhãn hàng → Dịch vụ → Công việc: one brand_service per brand × catalog service, found again, kept to who may work on the customer',async()=>{
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
  await run("INSERT INTO service_catalog(id,name,created_at,updated_at) VALUES('sv_ads','Paid Ads',1,1),('sv_web','Website',1,1),('sv_gone','Old',1,1)");
  await run("UPDATE service_catalog SET deleted_at=2 WHERE id='sv_gone'");

  // Made on first use on default brand, named after the catalog service, carrying it, and for the customer.
  const ads=await projectForService(owner,'c_one','sv_ads');
  assert.equal(ads.created,true);assert.equal(ads.name,'Paid Ads');
  const row=await get('SELECT bs.brand_id, bs.catalog_service_id, br.customer_id FROM brand_services bs JOIN brands br ON br.id=bs.brand_id WHERE bs.id=?',ads.id);
  assert.equal(row.customer_id,'c_one');
  assert.equal(row.catalog_service_id,'sv_ads');

  // Found again (no second brand_service on the same brand), and another service is another brand_service.
  const again=await projectForService(owner,'c_one','sv_ads');
  assert.equal(again.created,false);assert.equal(again.id,ads.id);
  const web=await projectForService(owner,'c_one','sv_web');
  assert.notEqual(web.id,ads.id);
  assert.equal((await get("SELECT COUNT(*) n FROM brand_services bs JOIN brands br ON br.id=bs.brand_id WHERE br.customer_id='c_one'")).n,2);

  // An older brand_service on a brand for a catalog service is the one used.
  await run("INSERT INTO brand_services(id,brand_id,catalog_service_id,name,created_at,updated_at) VALUES('tj_old',?,'sv_web','Website 2025',0,0)", row.brand_id);
  assert.equal((await projectForService(owner,'c_one','sv_web')).id,'tj_old');

  // A second brand of the same customer can run its own sv_ads instance cleanly.
  await run("INSERT INTO brands(id,customer_id,name,pos,created_by,created_at,updated_at) VALUES('br_second','c_one','Garage Two',1,'u_owner',1,1)");
  const ads2=await projectForService(owner,'c_one','sv_ads',{brandId:'br_second'});
  assert.equal(ads2.created,true);assert.notEqual(ads2.id,ads.id);assert.equal(ads2.brandId,'br_second');

  // Refused: a missing customer, a service out of the catalogue, someone who cannot work on the customer.
  // An omitted serviceId resolves to the general brand_service ('sv_general') so tasks under a client/brand need no service.
  const gen=await projectForService(owner,'c_one','');
  assert.ok(gen.id);
  await assert.rejects(projectForService(owner,'','sv_ads'),(e)=>e.status===400);
  await assert.rejects(projectForService(owner,'c_one','sv_gone'),(e)=>e.status===404);
  await assert.rejects(projectForService(stranger,'c_one','sv_ads'),(e)=>e.status===403||e.status===404);

  // The request guard does not take `for-service` for a brand_service id.
  const {guard}=await import('../server/auth.ts');
  const crypto=await import('node:crypto');
  const token='tok-service-axis';
  await run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)',crypto.createHash('sha256').update(token).digest('hex'),'u_owner',1,Date.now()+864e5);
  const req=(url)=>({method:'POST',url,path:url,headers:{cookie:`dms_sid=${token}`,host:'localhost'},socket:{remoteAddress:'127.0.0.1'}});
  assert.equal((await guard(req('/api/brand-services/for-service'))).id,'u_owner');
  assert.equal((await guard(req('/api/task-projects/for-service'))).id,'u_owner');
  await assert.rejects(guard(req('/api/brand-services/tj_missing/members')),(e)=>e.status===404||e.status===403);
 }finally{
  try{db?.close?.();}catch{}
  await rm(dir,{recursive:true,force:true});
 }
});
