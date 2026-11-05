import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Exercise the real Workers runtime and Cloudflare D1 binding in an isolated test database.
// No production secrets or databases are used by these tests.
const bundle = '.wrangler/test-bundle/worker.js';
function externalTransport() {
  const used = new Set();
  return async request => {
    const url = new URL(request.url);
    if (url.hostname === 'challenges.cloudflare.com') {
      const token = new URLSearchParams(await request.text()).get('response');
      if (token === 'unavailable') return new Response('', { status: 503 });
      const success = !['invalid', 'expired', ''].includes(token) && !(token === 'single-use' && used.has(token));
      used.add(token);
      return Response.json({ success, hostname: token === 'wrong-host' ? 'other.example.test' : 'studio.example.test', action: token === 'fixture-setup-token' ? 'setup' : token === 'wrong-action' ? 'other' : 'login' });
    }
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-access', refresh_token:'fixture-refresh', expires_in: 3600 });
    if(url.hostname==='gmail.googleapis.com')return Response.json({id:'fixture-message'});
    if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ email: 'admin@example.test', email_verified: true });
    throw new Error('Unexpected outbound request: database must use D1 binding');
  };
}
function workerOptions(name, transport, extra = {}, withDB = true) {
  return {
    name, modules: true, scriptPath: bundle,
    compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'],
    bindings: { DMS_RUNTIME: 'cloudflare', CLOUD_STORAGE_ONLY: '1', SETUP_CODE: 'fixture-setup', TURNSTILE_SITE_KEY: 'fixture-site-key', TURNSTILE_SECRET_KEY: 'fixture-secret-key', ...extra },
    ...(withDB ? { d1Databases: { DB: 'fixture-db' } } : {}),
    outboundService: transport,
    serviceBindings: { ASSETS: () => new Response('<html>DM Workspace</html>', { headers: { 'content-type': 'text/html' } }) },
  };
}
async function call(mf, method, pathname, body, cookie, headers = {}) {
  if (method === 'POST' && ['/api/auth/setup', '/api/auth/login'].includes(pathname)) {
    body = { turnstileToken: pathname.endsWith('setup') ? 'fixture-setup-token' : 'fixture-valid-token', ...body };
  }
  const res = await mf.dispatchFetch('https://studio.example.test' + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers, data: res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text() };
}

test('Workers: accounts, cookies, cross-isolate Google state, permissions and origin checks', { skip: !existsSync(bundle) }, async () => {
  const transport = externalTransport();
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [workerOptions('a', transport), workerOptions('b', transport)] }));
  const wa = await mf.getWorker('a'), wb = await mf.getWorker('b');
  const a = { dispatchFetch: (...args) => wa.fetch(...args) }, b = { dispatchFetch: (...args) => wb.fetch(...args) };
  const db = await mf.getD1Database('DB', 'a');
  try {
    assert.equal((await call(a, 'GET', '/')).status, 200);
    const config = await call(a, 'GET', '/api/auth/config');
    assert.deepEqual(config.data.turnstile, { siteKey: 'fixture-site-key', required: true });
    assert.equal(JSON.stringify(config.data).includes('fixture-secret-key'), false);
    for (const [token, status] of [['', 400], ['invalid', 403], ['expired', 403], ['wrong-host', 403], ['wrong-action', 403], ['unavailable', 503]]) {
      const denied = await call(a, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: token });
      assert.equal(denied.status, status, token);
      assert.equal(denied.cookie, undefined);
    }
    const setup = await call(a, 'POST', '/api/auth/setup', { code: 'fixture-setup', email: 'admin@example.test', password: 'test-password' });
    assert.equal(setup.status, 201, JSON.stringify(setup.data));
    assert.ok(setup.headers.get('set-cookie').includes('Secure'));
    assert.equal((await call(b, 'GET', '/api/auth/me', undefined, setup.cookie)).data.user.email, 'admin@example.test');
    const login = await call(b, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password' });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const first = await call(a, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: 'single-use' });
    assert.equal(first.status, 200);
    const replayToken = await call(b, 'POST', '/api/auth/login', { email: 'admin@example.test', password: 'test-password', turnstileToken: 'single-use' });
    assert.equal(replayToken.status, 403);
    assert.equal(replayToken.cookie, undefined);
    assert.equal((await call(a, 'GET', '/api/users')).status, 401);
    assert.equal((await call(a, 'POST', '/api/auth/logout', {}, login.cookie, { origin: 'https://other.test' })).status, 403);
    assert.equal((await call(a, 'POST', '/api/customers', { name: 'No temporary files' }, login.cookie)).status, 400);
    assert.equal((await call(a, 'PUT', '/api/google/config', { clientId: 'fixture-client', clientSecret: 'fixture-secret' }, login.cookie)).status, 200);
    const redirect = await call(a, 'GET', '/api/auth/google');
    assert.equal(redirect.status, 302);
    const googleUrl = new URL(redirect.headers.get('location'));
    assert.equal(googleUrl.searchParams.get('redirect_uri'), 'https://studio.example.test/api/google/callback');
    const state = googleUrl.searchParams.get('state');
    const callback = await call(b, 'GET', `/api/google/callback?state=${state}&code=fixture-code`);
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), '/');
    assert.ok(callback.cookie);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM oauth_states').first()).n, 0);
    const replay = await call(a, 'GET', `/api/google/callback?state=${state}&code=fixture-code`);
    assert.equal(replay.cookie, undefined);
    const mailConnect=await call(a,'GET','/api/notifications/mail/connect',undefined,setup.cookie);
    assert.equal(mailConnect.status,302);
    const mailUrl=new URL(mailConnect.headers.get('location'));
    assert.ok(mailUrl.searchParams.get('scope').includes('gmail.send'));
    assert.equal(mailUrl.searchParams.get('scope').includes('/drive'),false);
    const mailState=mailUrl.searchParams.get('state');
    const mailCallback=await call(b,'GET',`/api/google/callback?state=${mailState}&code=fixture-mail`);
    assert.equal(mailCallback.status,302);assert.ok(mailCallback.headers.get('location').includes('mail='));
    const notificationStatus=await call(a,'GET','/api/notifications',undefined,setup.cookie);
    assert.equal(notificationStatus.data.sender,'admin@example.test');
    assert.equal(JSON.stringify(notificationStatus.data).includes('fixture-refresh'),false);
    assert.equal((await call(a,'GET','/api/google/status',undefined,setup.cookie)).data.accounts.length,0);
    assert.equal((await call(a,'PUT','/api/notifications',{enabled:true},setup.cookie)).status,400);
    await db.prepare('INSERT INTO notification_preferences(user_id,enabled,email,verified_at,updated_at) VALUES(?,1,?,1,1) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=1,enabled=1').bind(setup.data.user.id,'personal@example.test').run();
    assert.equal((await call(a,'PUT','/api/notifications',{enabled:true},setup.cookie)).status,200);

    const client=await call(a,'POST','/api/customers',{name:'Project ACL client',databaseOnly:true},setup.cookie);
    assert.equal(client.status,201,JSON.stringify(client.data));
    const project=await call(a,'POST',`/api/customers/${client.data.id}/projects`,{name:'D1 private project'},setup.cookie);
    assert.equal(project.status,201,JSON.stringify(project.data));
    assert.equal((await call(b,'GET',`/api/task-projects/${project.data.id}/members`,undefined,setup.cookie)).data.ownerId,setup.data.user.id);

    // Task CRUD and card synchronisation also run against the real D1 binding.
    const task = await call(a, 'POST', '/api/tasks', { title: 'D1 task', description: 'Shared working text', result: 'private', assigneeUserIds: [setup.data.user.id] }, setup.cookie);
    assert.equal(task.status, 201, JSON.stringify(task.data));
    const taskId = task.data.id;
    const staff = await call(a, 'POST', '/api/task-people', { userId: setup.data.user.id }, setup.cookie);
    assert.equal(staff.status, 201);
    assert.equal((await call(b, 'GET', `/api/tasks/${taskId}`, undefined, setup.cookie)).data.assignees[0].userId, setup.data.user.id);
    const boardItems = await call(a, 'GET', '/api/boards', undefined, setup.cookie);
    const board = await call(a, 'GET', `/api/boards/${boardItems.data[0].id}`, undefined, setup.cookie);
    const linked = await call(a, 'POST', `/api/tasks/${taskId}/card`, { listId: board.data.lists[0].id }, setup.cookie);
    assert.equal(linked.status, 201, JSON.stringify(linked.data));
    assert.equal((await call(b, 'PUT', `/api/cards/${linked.data.cardId}`, { done: true }, setup.cookie)).status, 200);
    assert.equal((await call(a, 'GET', `/api/tasks/${taskId}`, undefined, setup.cookie)).data.status, 'Hoàn thành');
    assert.equal((await call(b, 'PUT', `/api/tasks/${taskId}`, { title: 'Updated in D1' }, setup.cookie)).status, 200);
    const card = await call(a, 'GET', `/api/cards/${linked.data.cardId}`, undefined, setup.cookie);
    assert.equal(card.data.title, 'Updated in D1');
    assert.equal(JSON.stringify(card.data).includes('private'), false);
    // Mail a change queues goes out right after it, without waiting for the minute's run.
    let sent = 0;
    for (let i = 0; i < 30 && !sent; i++) { sent = (await db.prepare("SELECT COUNT(*) n FROM mail_outbox WHERE state='sent'").first()).n; if (!sent) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(sent >= 1);
    await wb.scheduled({cron:'*/5 * * * *'});
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM mail_outbox WHERE state='pending'").first()).n, 0);

    assert.equal((await call(b, 'DELETE', `/api/tasks/${taskId}`, undefined, setup.cookie)).status, 200);
    assert.equal((await call(a, 'GET', `/api/cards/${linked.data.cardId}`, undefined, setup.cookie)).data.linkedTask, null);
    const sheetImport=await call(a,'POST','/api/tasks/import',{sourceName:'Workbook.csv',text:'Custom,Tên công việc,Mã công việc\nExtra,Imported on D1,12345'},setup.cookie);
    assert.equal(sheetImport.status,200,JSON.stringify(sheetImport.data));
    const sheet=await call(b,'GET',`/api/tasks/imports/${sheetImport.data.importId}/sheet`,undefined,setup.cookie);
    assert.equal(sheet.status,200);assert.deepEqual(sheet.data.headers,['Custom','Tên công việc','Mã công việc']);assert.equal(sheet.data.rows[0][0],'Extra');assert.ok(sheet.data.taskIds[0]);
    const service=await call(a,'POST','/api/ads/services',{clientId:'C01',client:'D1 client',service:'Coating',accountId:'act_111111',campaignIds:[],monthlyBudget:1000,kpiTarget:20,conversionType:'LeadForm'},setup.cookie);
    assert.equal(service.status,201,JSON.stringify(service.data));
    assert.equal((await call(b,'GET','/api/ads/services',undefined,setup.cookie)).data[0].client,'D1 client');
    const summary=await call(b,'GET','/api/ads/summary?until=2026-11-01',undefined,setup.cookie);
    assert.equal(summary.status,200);assert.equal(summary.data.rows[0].kpiStatus,'Data error');assert.equal(summary.data.rows[0].spend30,null);
    assert.equal((await call(a,'PUT',`/api/ads/services/${service.data.id}`,{notes:'Updated on D1'},setup.cookie)).status,200);
    assert.equal((await call(b,'GET','/api/ads/services',undefined,setup.cookie)).data[0].notes,'Updated on D1');
    assert.equal((await call(b,'DELETE',`/api/ads/services/${service.data.id}`,undefined,setup.cookie)).status,200);
    for (let i = 0; i < 8; i++) assert.equal((await call(i % 2 ? a : b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 401);
    assert.equal((await call(b, 'POST', '/api/auth/login', { email: 'wrong@example.test', password: 'wrong-password' })).status, 429);
  } finally { await mf.dispose(); }
});

test('Workers: missing D1 binding returns 503 while static UI remains available', { skip: !existsSync(bundle) }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(workerOptions('missing-db', externalTransport(), {}, false)));
  try {
    assert.equal((await call(mf, 'GET', '/')).status, 200);
    assert.equal((await call(mf, 'GET', '/api/auth/me')).status, 503);
  } finally { await mf.dispose(); }
});


test('Workers: Turnstile configuration cannot silently disable verification', { skip: !existsSync(bundle) }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions(workerOptions('missing-turnstile', externalTransport(), { TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' })));
  try {
    const config = await call(mf, 'GET', '/api/auth/config');
    assert.equal(config.data.turnstile.required, true);
    const login = await call(mf, 'POST', '/api/auth/login', { email: 'test@example.test', password: 'test-password' });
    assert.equal(login.status, 503);
    assert.equal(login.cookie, undefined);
  } finally { await mf.dispose(); }
});
