import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

// One person does a task (server/task-assign.ts), as in Base Wework: giving it to someone hands it over, and whoever
// did it before follows it from then on. Drive points into the temporary directory.
const root = path.resolve(import.meta.dirname, '..');

test('a task has one person doing it; handing it over makes the previous one a follower', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dms-handover-'));
  await mkdir(path.join(dir, 'drive'), { recursive: true });
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: path.join(dir, 'data'), DRIVE_DIR: path.join(dir, 'drive'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, cookie) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json(), cookie: (r.headers.get('set-cookie') || '').match(/dms_sid=[^;]+/)?.[0] };
  };
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
      child.stdout.on('data', () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } });
      child.once('exit', () => reject(new Error(output)));
    });
    const boss = (await call('POST', '/api/auth/setup', { email: 'boss@example.test', name: 'Boss', password: 'Passw0rd!long', code: 'test-setup-only' })).cookie;
    const user = async (email, name) => (await call('POST', '/api/users', { email, name, password: 'Passw0rd!long', role: 'member' }, boss)).data.id;
    const mia = await user('mia@example.test', 'Mia'), lan = await user('lan@example.test', 'Lan'), khoa = await user('khoa@example.test', 'Khoa');
    const miaCookie = (await call('POST', '/api/auth/login', { email: 'mia@example.test', password: 'Passw0rd!long' })).cookie;
    const state = async (id) => {
      const t = (await call('GET', `/api/tasks/${id}`, undefined, boss)).data;
      return { doer: t.assignees.map((a) => a.userId), followers: t.followers.map((f) => f.id).sort() };
    };

    const id = (await call('POST', '/api/tasks', { title: 'Quay video', assigneeUserIds: [mia] }, boss)).data.id;
    assert.deepEqual(await state(id), { doer: [mia], followers: [] });

    // The person doing it hands it to someone else: they follow it now.
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [lan] }, miaCookie)).status, 200);
    assert.deepEqual(await state(id), { doer: [lan], followers: [mia] });

    // Its maker gives it back to Mia: Lan follows, Mia (doing it again) no longer needs to.
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [mia] }, boss)).status, 200);
    assert.deepEqual(await state(id), { doer: [mia], followers: [lan] });

    // Several named at once: the last one added does it; the one it had follows.
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [mia, khoa] }, boss)).status, 200);
    assert.deepEqual(await state(id), { doer: [khoa], followers: [lan, mia].sort() });

    // Nobody gives a task to themselves; a follower does not hand it over (they cannot change it).
    const bossId = (await call('GET', '/api/auth/me', undefined, boss)).data.user.id;
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [bossId] }, boss)).status, 400);
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [lan] }, miaCookie)).status, 404);
    assert.deepEqual(await state(id), { doer: [khoa], followers: [lan, mia].sort() });
    // Followers set in the same change stay, with the handed-off person added to them.
    assert.equal((await call('PUT', `/api/tasks/${id}`, { assigneeUserIds: [lan], followerUserIds: [] }, boss)).status, 200);
    assert.deepEqual(await state(id), { doer: [lan], followers: [khoa] });

    // On a board: putting someone on the task's card hands it over the same way.
    // (a new task gets its card on the board when it is made)
    const cardId = (await call('GET', `/api/tasks/${id}`, undefined, boss)).data.boardLink?.cardId;
    assert.ok(cardId, 'the task has its card');
    assert.equal((await call('PUT', `/api/cards/${cardId}/members`, { userId: mia, on: true }, boss)).status, 200);
    assert.deepEqual(await state(id), { doer: [mia], followers: [khoa, lan].sort() });
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
