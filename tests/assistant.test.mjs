import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

// The in-app assistant (server/assistant.ts) against a scripted stand-in for the Claude API: the answer streams back,
// tools run with the person's rights, a change waits for approval. No real API call, no token spent.
const root = path.resolve(import.meta.dirname, '..');

/** A fake Messages API: a question gets list_tasks, a request to "tạo" gets create_task, tool results get a short answer. */
function fakeClaude() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const b = JSON.parse(body);
    requests.push({ headers: req.headers, body: b });
    const last = b.messages.at(-1);
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content;
    let block;
    if (blocks.some((x) => x.type === 'tool_result')) block = { type: 'text', text: 'Xong.' };
    else if (blocks.some((x) => x.type === 'text' && /tạo/i.test(x.text))) block = { type: 'tool_use', id: `toolu_${requests.length}`, name: 'create_task', input: { title: 'Việc từ trợ lý', due: '2026-12-24' } };
    else block = { type: 'tool_use', id: `toolu_${requests.length}`, name: 'list_tasks', input: { relation: 'created' } };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('message_start', { message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 } } });
    if (block.type === 'text') {
      send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: block.text } });
    } else {
      send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: block.type === 'text' ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 15 } });
    send('message_stop', {});
    res.end();
  });
  return { server, requests };
}

async function freePort() {
  const s = http.createServer().listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** Reads a streamed answer into its events. */
async function events(res) {
  const out = [];
  for (const chunk of (await res.text()).split('\n\n')) {
    const ev = chunk.match(/^event: (.+)$/m)?.[1], data = chunk.match(/^data: (.+)$/m)?.[1];
    if (ev) out.push({ event: ev, data: JSON.parse(data) });
  }
  return out;
}

test('assistant: streaming, tools with the person\'s rights, approval before a change', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dms-assistant-'));
  await mkdir(path.join(dir, 'drive'), { recursive: true });
  const claude = fakeClaude();
  claude.server.listen(0, '127.0.0.1');
  await once(claude.server, 'listening');
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: path.join(dir, 'data'), DRIVE_DIR: path.join(dir, 'drive'), HYPERFRAMES_DIR: path.join(dir, 'hf'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '',
      TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'test-setup-only',
      ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${claude.server.address().port}`, ASSISTANT_MODEL: '', ASSISTANT_MONTHLY_TOKENS: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  const base = `http://127.0.0.1:${port}`;
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
      child.stdout.on('data', () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } });
      child.once('exit', () => reject(new Error(output)));
    });
    const post = (url, body, cookie) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
    const r0 = await post('/api/auth/setup', { email: 'boss@example.test', name: 'Boss', password: 'Passw0rd!long', code: 'test-setup-only' });
    const cookie = r0.headers.get('set-cookie').match(/dms_sid=[^;]+/)[0];

    const info = await (await fetch(base + '/api/assistant', { headers: { cookie } })).json();
    assert.equal(info.enabled, true);
    assert.equal(info.model, 'claude-opus-5-5');

    // A question: the tool runs, the answer streams, the conversation is kept.
    const e1 = await events(await post('/api/assistant/conversations/new/messages', { text: 'Tôi có việc gì?' }, cookie));
    const conv = e1.find((e) => e.event === 'conversation').data.id;
    assert.deepEqual(e1.filter((e) => e.event === 'tool').map((e) => [e.data.name, e.data.status]), [['list_tasks', 'running'], ['list_tasks', 'done']]);
    assert.equal(e1.filter((e) => e.event === 'text').map((e) => e.data.delta).join(''), 'Xong.');
    assert.equal(e1.at(-1).event, 'done');

    // What reached the Claude API: model, fallback, cache breakpoints, tools that stream their input.
    const first = claude.requests[0];
    assert.equal(first.body.model, 'claude-opus-5-5');
    assert.equal(first.body.fallbacks, 'default');
    assert.match(first.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
    assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
    assert.equal(first.body.output_config.effort, 'medium');
    assert.ok(first.body.tools.every((t) => t.eager_input_streaming === true));
    assert.ok(!first.body.tools.some((t) => /sql|delete|lock/.test(t.name)));
    // The second call carries the tool result back.
    assert.ok(claude.requests[1].body.messages.at(-1).content.some((b) => b.type === 'tool_result' && !b.is_error));

    // A change waits for approval: nothing written until the person decides.
    const db = new DatabaseSync(path.join(dir, 'data', 'studio.db'));
    const tasks = () => db.prepare("SELECT COUNT(*) n FROM tasks WHERE title = 'Việc từ trợ lý'").get().n;
    const e2 = await events(await post(`/api/assistant/conversations/${conv}/messages`, { text: 'Hãy tạo việc mới' }, cookie));
    const approval = e2.find((e) => e.event === 'approval');
    assert.equal(approval.data.calls[0].name, 'create_task');
    assert.equal(tasks(), 0);
    assert.equal((await post(`/api/assistant/conversations/${conv}/messages`, { text: 'tiếp' }, cookie)).status, 409);
    const shown = await (await fetch(base + `/api/assistant/conversations/${conv}`, { headers: { cookie } })).json();
    assert.equal(shown.pending[0].name, 'create_task');

    const e3 = await events(await post(`/api/assistant/conversations/${conv}/decision`, { approve: true }, cookie));
    assert.deepEqual(e3.filter((e) => e.event === 'tool').map((e) => e.data.status), ['running', 'done']);
    assert.equal(tasks(), 1);
    assert.equal((await post(`/api/assistant/conversations/${conv}/decision`, { approve: true }, cookie)).status, 409);
    // Logged as the person, like any change.
    assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE agent = 'Claude (MCP)' AND action LIKE '%công việc%'").get().n > 0);

    // Declined: no change, and Claude is told so.
    await events(await post(`/api/assistant/conversations/${conv}/messages`, { text: 'Tạo thêm một việc nữa' }, cookie));
    const e4 = await events(await post(`/api/assistant/conversations/${conv}/decision`, { approve: false }, cookie));
    assert.equal(e4.find((e) => e.event === 'tool').data.status, 'declined');
    assert.equal(tasks(), 1);
    assert.ok(claude.requests.at(-1).body.messages.at(-1).content.some((b) => b.type === 'tool_result' && b.is_error));

    // Usage is counted per person; another person cannot open this conversation.
    assert.ok((await (await fetch(base + '/api/assistant', { headers: { cookie } })).json()).used > 0);
    await post('/api/users', { email: 'mia@example.test', name: 'Mia', password: 'Passw0rd!long', role: 'member' }, cookie);
    const mia = (await post('/api/auth/login', { email: 'mia@example.test', password: 'Passw0rd!long' })).headers.get('set-cookie').match(/dms_sid=[^;]+/)[0];
    assert.equal((await fetch(base + `/api/assistant/conversations/${conv}`, { headers: { cookie: mia } })).status, 404);
    db.close();
  } finally {
    child.kill();
    claude.server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
