import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { buildMime, parseAddresses, readParts, person } from '../server/gmail-mime.ts';

// Hộp thư (server/mailbox.ts): each person's own Gmail. Gmail itself is not reached here: the mail is written and read
// by server/gmail-mime.ts, and the routes are checked up to the point they would call Google.
const root = path.resolve(import.meta.dirname, '..');

test('a message to send: headers that cannot be broken into, Vietnamese words encoded, files attached', () => {
  const raw = buildMime({ from: { email: 'mia@dmi.test', name: 'Mia Trần' }, to: ['a@x.com'], cc: ['b@y.com'], bcc: ['hidden@z.com'], subject: 'Báo giá\r\nBcc: evil@x.com', text: 'Chào anh',
    inReplyTo: '<m1@mail>', references: '<m0@mail>', attachments: [{ name: 'giá.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }] }, 'B');
  const head = raw.split('\r\n\r\n')[0];
  assert.ok(!/evil@x\.com/.test(head.split('\r\n').filter((l) => !l.startsWith('Subject:')).join('\n')), 'a line break in the subject starts no header');
  assert.match(head, /^From: =\?UTF-8\?B\?[^?]+\?= <mia@dmi\.test>$/m);
  assert.match(head, /^Cc: b@y\.com$/m);
  assert.match(head, /^Bcc: hidden@z\.com$/m);
  assert.match(head, /^In-Reply-To: <m1@mail>$/m);
  assert.match(head, /^References: <m0@mail> <m1@mail>$/m);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="B"/);
  assert.ok(raw.includes(Buffer.from('Chào anh').toString('base64')));
  assert.ok(raw.includes(Buffer.from('%PDF').toString('base64')));
  assert.ok(raw.trimEnd().endsWith('--B--'));
  assert.ok(!buildMime({ from: { email: 'a@x.com' }, to: ['b@y.com'], subject: 'Hi', text: 'x' }).includes('multipart'));
  // Formatted: the plain text and the HTML as alternatives, inside the mixed part when files come with it.
  const rich = buildMime({ from: { email: 'a@x.com' }, to: ['b@y.com'], subject: 'Hi', text: 'Chào', html: '<b>Chào</b>', attachments: [{ name: 'a.txt', type: 'text/plain', data: Buffer.from('x') }] }, 'R');
  assert.match(rich, /multipart\/mixed; boundary="R"/);
  assert.match(rich, /--R\r\nContent-Type: multipart\/alternative; boundary="Ra"/);
  assert.ok(rich.indexOf('text/plain; charset=UTF-8') < rich.indexOf('text/html; charset=UTF-8'), 'plain first, HTML last (the one preferred)');
  assert.ok(rich.includes(Buffer.from('<b>Chào</b>').toString('base64')));
  assert.ok(rich.includes('--Ra--'));
});

test('addresses as typed, and a message as Gmail returns it', () => {
  assert.deepEqual(parseAddresses('A <A@X.com>, b@y.com; a@x.com'), ['a@x.com', 'b@y.com']);
  assert.deepEqual(parseAddresses(''), []);
  assert.throws(() => parseAddresses('not an email'), /không hợp lệ/);
  assert.throws(() => parseAddresses('a@x.com\r\nBcc: c@z.com'), /không hợp lệ/);
  assert.deepEqual(person('"Lan Phạm" <Lan@X.com>'), { name: 'Lan Phạm', email: 'lan@x.com' });
  const b64 = (s) => Buffer.from(s).toString('base64url');
  const r = readParts({ mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Xin chào') } }, { mimeType: 'text/html', body: { data: b64('<b>Xin chào</b>') } }] },
    { mimeType: 'application/pdf', filename: 'hd.pdf', body: { attachmentId: 'att1', size: 1200 } },
  ] });
  assert.deepEqual(r, { html: '<b>Xin chào</b>', text: 'Xin chào', attachments: [{ id: 'att1', name: 'hd.pdf', type: 'application/pdf', size: 1200 }] });
});

test('each person connects their own Gmail; nothing is sent without one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dms-mailbox-'));
  await mkdir(path.join(dir, 'drive'), { recursive: true });
  const listener = net.createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: path.join(dir, 'data'), DRIVE_DIR: path.join(dir, 'drive'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only', ANTHROPIC_API_KEY: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, cookie) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, location: r.headers.get('location'), data: await r.json().catch(() => null), cookie: (r.headers.get('set-cookie') || '').match(/dms_sid=[^;]+/)?.[0] };
  };
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
      child.stdout.on('data', () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } });
      child.once('exit', () => reject(new Error(output)));
    });
    const boss = (await call('POST', '/api/auth/setup', { email: 'boss@example.test', name: 'Boss', password: 'Passw0rd!long', code: 'test-setup-only' })).cookie;
    await call('POST', '/api/users', { email: 'mia@example.test', name: 'Mia', password: 'Passw0rd!long', role: 'member' }, boss);
    const mia = (await call('POST', '/api/auth/login', { email: 'mia@example.test', password: 'Passw0rd!long' })).cookie;

    assert.deepEqual((await call('GET', '/api/mailbox', undefined, mia)).data, { connected: false, googleConfigured: false });
    assert.equal((await call('GET', '/api/mailbox', undefined)).status, 401);
    // Not connected: nothing to list or send (checked before Google is ever asked).
    assert.equal((await call('GET', '/api/mailbox/threads?folder=inbox', undefined, mia)).status, 400);
    assert.equal((await call('POST', '/api/mailbox/send', { to: 'a@x.com', subject: 'Hi', text: 'x' }, mia)).status, 400);
    assert.match((await call('POST', '/api/mailbox/send', { to: 'nope', subject: 'Hi', text: 'x' }, mia)).data.error, /không hợp lệ/);
    assert.match((await call('POST', '/api/mailbox/send', { to: '', subject: 'Hi', text: 'x' }, mia)).data.error, /người nhận/);

    // Once an admin has set up Google, a member connects their own Gmail: read and send, nothing of Drive.
    assert.equal((await call('PUT', '/api/google/config', { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test' }, boss)).status, 200);
    assert.equal((await call('GET', '/api/mailbox', undefined, mia)).data.googleConfigured, true);
    const go = await call('GET', '/api/mailbox/connect', undefined, mia);
    assert.equal(go.status, 302);
    const scope = new URL(go.location).searchParams.get('scope');
    assert.ok(scope.split(' ').includes('https://www.googleapis.com/auth/gmail.modify'));
    assert.ok(!scope.includes('/auth/drive'));
    assert.equal(new URL(go.location).searchParams.get('include_granted_scopes'), 'false');
    // Back from Google without a valid sign-in: the mailbox page says why.
    const back = await call('GET', '/api/google/callback?state=' + new URL(go.location).searchParams.get('state') + '&error=access_denied', undefined, mia);
    assert.match(back.location, /^\/#mail\?error=/);
    assert.equal((await call('DELETE', '/api/mailbox', undefined, mia)).status, 200);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
