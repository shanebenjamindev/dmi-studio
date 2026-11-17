import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');

async function start(dataDir) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_URL: '',
      TURSO_DATABASE_URL: '',
      TURSO_AUTH_TOKEN: '',
      TURNSTILE_SITE_KEY: '',
      TURNSTILE_SECRET_KEY: '',
      DMS_RUNTIME: '',
      CLOUD_STORAGE_ONLY: '',
      SETUP_CODE: 'test-setup-only',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Startup timed out: ' + output)); }, 10000);
      const onData = () => { if (output.includes('Database:')) { cleanup(); resolve(); } };
      const onExit = () => { cleanup(); reject(new Error('Server failed: ' + output)); };
      function cleanup() { clearTimeout(timeout); child.stdout.off('data', onData); child.off('exit', onExit); }
      child.stdout.on('data', onData);
      child.once('exit', onExit);
      onData();
    });
  } catch (e) {
    child.kill();
    throw e;
  }
  const call = async (method, url, body, cookie) => {
    const res = await fetch(origin + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  return { call, close: async () => { child.kill(); await once(child, 'exit').catch(() => {}); } };
}

test('brands CRUD, multi-brand same catalog service, and single-brand duplicate guard', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-brands-crud-'));
  let server;
  try {
    server = await start(dir);
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'brands@example.test', password: 'test-password' });
    assert.equal(admin.status, 201);
    const ac = admin.cookie;

    const cust = (await server.call('POST', '/api/customers', { name: 'Alpha Auto', databaseOnly: true }, ac)).data;
    const defBrands = (await server.call('GET', `/api/customers/${cust.id}/brands`, undefined, ac)).data;
    assert.equal(defBrands.length, 1);
    const defBrand = defBrands[0];
    assert.equal(defBrand.name, 'Alpha Auto');

    // Cannot delete the only remaining active brand of a customer.
    assert.equal((await server.call('DELETE', `/api/brands/${defBrand.id}`, undefined, ac)).status, 409);

    // Create a second brand under the same customer.
    const brand2Res = await server.call('POST', `/api/customers/${cust.id}/brands`, { name: 'Alpha Coating Pro', notes: 'Line 2', driveFolder: { account: 'u@test', id: 'f_123', label: 'Drive > Alpha' } }, ac);
    assert.equal(brand2Res.status, 201, JSON.stringify(brand2Res.data));
    const brand2 = brand2Res.data;
    assert.equal(brand2.driveFolder.id, 'f_123');
    assert.equal(brand2.driveInherited, false);

    // Duplicate brand name under the same customer is rejected.
    assert.equal((await server.call('POST', `/api/customers/${cust.id}/brands`, { name: 'alpha coating pro' }, ac)).status, 409);

    // Rename brand2 and check GET /api/brands and GET /api/brands/:id.
    assert.equal((await server.call('PUT', `/api/brands/${brand2.id}`, { name: 'Alpha Wrap' }, ac)).status, 200);
    const allBrands = (await server.call('GET', `/api/brands?customerId=${cust.id}`, undefined, ac)).data;
    assert.equal(allBrands.length, 2);
    assert.equal((await server.call('GET', `/api/brands/${brand2.id}`, undefined, ac)).data.name, 'Alpha Wrap');

    // Same catalog service can run once per brand, across 2 brands of the same customer!
    const ads = (await server.call('POST', '/api/admin/services', { name: 'Meta Ads' }, ac)).data;
    const seo = (await server.call('POST', '/api/admin/services', { name: 'SEO' }, ac)).data;

    const bs1 = await server.call('POST', '/api/brand-services', { brandId: defBrand.id, catalogServiceId: ads.id }, ac);
    assert.equal(bs1.status, 201, JSON.stringify(bs1.data));
    const bs2 = await server.call('POST', '/api/brand-services', { brandId: brand2.id, catalogServiceId: ads.id }, ac);
    assert.equal(bs2.status, 201, JSON.stringify(bs2.data));
    assert.notEqual(bs1.data.id, bs2.data.id);

    // Duplicate catalog service on the SAME brand is rejected with 409.
    assert.equal((await server.call('POST', '/api/brand-services', { brandId: brand2.id, catalogServiceId: ads.id }, ac)).status, 409);

    // Moving bs1 (Meta Ads) onto brand2 (which already has Meta Ads) is refused with 409.
    assert.equal((await server.call('PUT', `/api/brand-services/${bs1.data.id}`, { brandId: brand2.id }, ac)).status, 409);

    // Deleting brand2 while it owns bs2 is refused with 409.
    assert.equal((await server.call('DELETE', `/api/brands/${brand2.id}`, undefined, ac)).status, 409);

    // Move bs1 from defBrand to seo so defBrand is empty, or delete brand2's bs2 then delete brand2.
    assert.equal((await server.call('DELETE', `/api/brand-services/${bs2.data.id}`, undefined, ac)).status, 200);
    assert.equal((await server.call('DELETE', `/api/brands/${brand2.id}`, undefined, ac)).status, 200);
    assert.equal((await server.call('GET', `/api/brands/${brand2.id}`, undefined, ac)).status, 404);

    // Create a brand3 with SEO service to verify derived customer needs & board names.
    const brand3 = (await server.call('POST', `/api/customers/${cust.id}/brands`, { name: 'Alpha Ceramic' }, ac)).data;
    const bs3 = (await server.call('POST', '/api/brand-services/for-service', { brandId: brand3.id, catalogServiceId: seo.id }, ac)).data;
    const custRecord = (await server.call('GET', `/api/customers/${cust.id}/record`, undefined, ac)).data;
    assert.deepEqual(custRecord.needs.map((n) => n.name).sort(), ['Meta Ads', 'SEO']);
    const workspaces = (await server.call('GET', `/api/customers/${cust.id}/workspaces`, undefined, ac)).data;
    const boards = workspaces.workspaces.flatMap((w) => w.boards);
    assert.ok(boards.some((b) => b.brandServiceId === bs3.id && b.name === 'Alpha Ceramic · SEO'));
  } finally {
    if (server) await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('tasks/admin filtering by brand hierarchy, deprecated routes, and customer deletion keeps services detached', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dmi-brands-filter-'));
  let server;
  try {
    server = await start(dir);
    const admin = await server.call('POST', '/api/auth/setup', { code: 'test-setup-only', name: 'Boss', email: 'filter@example.test', password: 'test-password' });
    const ac = admin.cookie;

    const cA = (await server.call('POST', '/api/customers', { name: 'Client A', databaseOnly: true }, ac)).data;
    const cB = (await server.call('POST', '/api/customers', { name: 'Client B', databaseOnly: true }, ac)).data;
    const bA1 = (await server.call('GET', `/api/customers/${cA.id}/brands`, undefined, ac)).data[0];
    const bA2 = (await server.call('POST', `/api/customers/${cA.id}/brands`, { name: 'Brand A2' }, ac)).data;
    const bB1 = (await server.call('GET', `/api/customers/${cB.id}/brands`, undefined, ac)).data[0];

    const ads = (await server.call('POST', '/api/admin/services', { name: 'Ads' }, ac)).data;
    const web = (await server.call('POST', '/api/admin/services', { name: 'Web' }, ac)).data;

    const bsA1Ads = (await server.call('POST', '/api/brand-services', { brandId: bA1.id, catalogServiceId: ads.id }, ac)).data;
    const bsA2Ads = (await server.call('POST', '/api/brand-services', { brandId: bA2.id, catalogServiceId: ads.id }, ac)).data;
    const bsB1Web = (await server.call('POST', '/api/brand-services', { brandId: bB1.id, catalogServiceId: web.id }, ac)).data;

    const t1 = (await server.call('POST', '/api/tasks', { title: 'Task A1 Ads', brandServiceId: bsA1Ads.id, labels: ['Launch'] }, ac)).data;
    const t2 = (await server.call('POST', '/api/tasks', { title: 'Task A2 Ads', brandServiceId: bsA2Ads.id }, ac)).data;
    const t3 = (await server.call('POST', '/api/tasks', { title: 'Task B1 Web', brandServiceId: bsB1Web.id }, ac)).data;

    // /api/tasks filters
    assert.deepEqual((await server.call('GET', `/api/tasks?scope=all&customer=${cA.id}`, undefined, ac)).data.tasks.map((t) => t.id).sort(), [t1.id, t2.id].sort());
    assert.deepEqual((await server.call('GET', `/api/tasks?scope=all&brand=${bA2.id}`, undefined, ac)).data.tasks.map((t) => t.id), [t2.id]);
    assert.deepEqual((await server.call('GET', `/api/tasks?scope=all&service=${ads.id}`, undefined, ac)).data.tasks.map((t) => t.id).sort(), [t1.id, t2.id].sort());
    assert.deepEqual((await server.call('GET', `/api/tasks?scope=all&brandService=${bsB1Web.id}`, undefined, ac)).data.tasks.map((t) => t.id), [t3.id]);

    // /api/admin/tasks filters
    assert.equal((await server.call('GET', `/api/admin/tasks?brand=${bA1.id}`, undefined, ac)).data.items.length, 1);
    assert.equal((await server.call('GET', `/api/admin/tasks?customer=${cA.id}`, undefined, ac)).data.items.length, 2);
    assert.equal((await server.call('GET', `/api/admin/tasks?service=${ads.id}`, undefined, ac)).data.items.length, 2);

    // Deprecated /api/task-projects routes set Deprecation header while working; campaigns return 200 [] / 410.
    const depFor = await server.call('POST', '/api/task-projects/for-service', { customerId: cB.id, serviceId: ads.id }, ac);
    assert.equal(depFor.status, 201);
    assert.equal(depFor.headers.get('deprecation'), 'true');
    const depCampGet = await server.call('GET', `/api/task-projects/${bsA1Ads.id}/campaigns`, undefined, ac);
    assert.equal(depCampGet.status, 200);
    assert.equal(depCampGet.headers.get('deprecation'), 'true');
    assert.deepEqual(depCampGet.data, []);
    const depCampPost = await server.call('POST', `/api/task-projects/${bsA1Ads.id}/campaigns`, { name: 'Legacy' }, ac);
    assert.equal(depCampPost.status, 410);
    assert.equal(depCampPost.headers.get('deprecation'), 'true');

    // Deleting Client A detaches its brand_services without cascade-deleting tasks under them.
    assert.equal((await server.call('DELETE', `/api/customers/${cA.id}`, undefined, ac)).status, 200);
    const survivedTask = await server.call('GET', `/api/tasks/${t1.id}`, undefined, ac);
    assert.equal(survivedTask.status, 200);
    assert.equal(survivedTask.data.brandService.id, bsA1Ads.id);
    assert.equal(survivedTask.data.brand, null);
  } finally {
    if (server) await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

