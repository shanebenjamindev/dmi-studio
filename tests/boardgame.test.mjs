// DMI Boardgame's API (server/boardgame.ts): played without an account, players are browsers with a secret, only
// someone in a room changes it, and only an admin resets the leaderboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
// A server of its own on a scratch database (never the real data).
async function start(dataDir) {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  await mkdir(path.join(dataDir, 'workspace'), { recursive: true });
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, DRIVE_DIR: path.join(dataDir, 'workspace'), PORT: String(port), HOST: '127.0.0.1', PUBLIC_URL: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '', DMS_RUNTIME: '', CLOUD_STORAGE_ONLY: '', SETUP_CODE: 'admin-test', CF_API_TOKEN: '', CF_ACCOUNT_ID: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => output += b); child.stderr.on('data', (b) => output += b);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Startup timed out: ' + output)), 15000);
    const check = () => { if (output.includes('Database:')) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check); child.once('exit', () => { clearTimeout(t); reject(new Error('Server failed: ' + output)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  return {
    async call(method, url, body, { cookie, player } = {}) {
      const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(player ? { 'x-bg-player': player.id, 'x-bg-key': player.key } : {}) };
      const res = await fetch(origin + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
    },
    async close() { const done = once(child, 'exit'); child.kill(); await done; },
  };
}
const ok = (r, what = '') => { assert.ok(r.status < 300, `${what} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const player = (n) => ({ id: `player-${n}-0000`, key: `secret-of-player-${n}-0000` });

test('board game: no account needed, players keep their own part, admins reset', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dms-boardgame-'));
  const s = await start(dir);
  try {
    const boss = (await s.call('POST', '/api/auth/setup', { code: 'admin-test', name: 'Boss', email: 'boss@x.test', password: 'password-123' })).cookie;
    ok(await s.call('POST', '/api/admin/staff', { name: 'Ann', email: 'ann@x.test', password: 'password-123' }, { cookie: boss }), 'staff');
    const gone = ok(await s.call('POST', '/api/admin/staff', { name: 'Old', email: 'old@x.test', password: 'password-123' }, { cookie: boss }), 'staff');
    ok(await s.call('POST', `/api/admin/staff/${gone.id}/lock`, { locked: true }, { cookie: boss }), 'lock');
    const ann = (await s.call('POST', '/api/auth/login', { email: 'ann@x.test', password: 'password-123' })).cookie;

    // The staff still working, to anyone.
    assert.deepEqual(ok(await s.call('GET', '/api/boardgame/roster')).names, ['Ann', 'Boss']);

    // A room: made by one browser, joined by others; a code in use is refused.
    const [a, b, c] = [player('a'), player('b'), player('c')];
    const lobby = { host: a.id, hostName: 'Ann', phase: 'lobby', seats: [], g: null };
    ok(await s.call('PUT', '/api/boardgame/rooms/1234', { create: true, state: lobby }, { player: a }), 'create');
    assert.equal((await s.call('PUT', '/api/boardgame/rooms/1234', { create: true, state: lobby }, { player: c })).status, 409);
    assert.equal(ok(await s.call('GET', '/api/boardgame/rooms')).rooms[0].hostName, 'Ann');
    ok(await s.call('PUT', '/api/boardgame/rooms/1234/players/me', { data: { name: 'Ann', at: 1, act: null } }, { player: a }), 'join a');
    ok(await s.call('PUT', '/api/boardgame/rooms/1234/players/me', { data: { name: 'Bob', at: 2, act: null } }, { player: b }), 'join b');

    // Someone outside the room cannot change it; another browser cannot write a player's part with the id alone.
    assert.equal((await s.call('PUT', '/api/boardgame/rooms/1234', { state: { ...lobby, host: c.id } }, { player: c })).status, 403);
    assert.equal((await s.call('PUT', '/api/boardgame/rooms/1234/players/me', { data: { name: 'Bob?', at: 3 } }, { player: { id: b.id, key: 'some-other-browser-key' } })).status, 403);
    assert.equal((await s.call('DELETE', '/api/boardgame/rooms/1234', undefined, { player: c })).status, 403);

    // Someone in it can; asking with the version already seen answers "same".
    ok(await s.call('PUT', '/api/boardgame/rooms/1234', { state: { ...lobby, phase: 'play' } }, { player: b }), 'member write');
    const room = ok(await s.call('GET', '/api/boardgame/rooms/1234'));
    assert.equal(room.room.phase, 'play');
    assert.deepEqual(Object.keys(room.players).sort(), [a.id, b.id]);
    assert.equal(room.players[b.id].name, 'Bob');
    assert.deepEqual(ok(await s.call('GET', `/api/boardgame/rooms/1234?v=${room.v}`)), { same: true });
    ok(await s.call('PUT', '/api/boardgame/rooms/1234/players/me', { data: { name: 'Bob', at: 2, act: { night: 1, pick: 0 } } }, { player: b }));
    assert.equal(ok(await s.call('GET', `/api/boardgame/rooms/1234?v=${room.v}`)).players[b.id].act.pick, 0, 'a player\'s change moves the version');

    // Leaving, then closing the room.
    ok(await s.call('DELETE', '/api/boardgame/rooms/1234/players/me', undefined, { player: b }));
    assert.deepEqual(Object.keys(ok(await s.call('GET', '/api/boardgame/rooms/1234')).players), [a.id]);
    ok(await s.call('DELETE', '/api/boardgame/rooms/1234', undefined, { player: a }));
    assert.equal((await s.call('GET', '/api/boardgame/rooms/1234')).status, 404);

    // The leaderboard: anyone records a game; only an admin resets it.
    const game = { game: 'ww', text: 'Dân làng thắng sau 2 đêm', results: [{ name: 'Ann', pts: 2, win: true }, { name: 'Bob', pts: 0, win: false }] };
    ok(await s.call('POST', '/api/boardgame/games', game), 'record');
    assert.equal((await s.call('POST', '/api/boardgame/games', { ...game, results: [{ name: 'Ann', pts: 999, win: true }] })).status, 400);
    const board = ok(await s.call('GET', '/api/boardgame/board'));
    assert.equal(board.games.length, 1);
    assert.equal(board.canReset, false);
    assert.equal(ok(await s.call('GET', '/api/boardgame/board', undefined, { cookie: boss })).canReset, true);
    assert.equal((await s.call('POST', '/api/boardgame/board/reset')).status, 403);
    assert.equal((await s.call('POST', '/api/boardgame/board/reset', undefined, { cookie: ann })).status, 403);
    ok(await s.call('POST', '/api/boardgame/board/reset', undefined, { cookie: boss }), 'reset');
    assert.equal(ok(await s.call('GET', '/api/boardgame/board')).games.length, 0);

    // Gián Điệp's pairs dealt: added from any phone, forgotten once a choice of topics is used up.
    ok(await s.call('POST', '/api/boardgame/spy-used', { add: ['Phở|Bún bò'] }));
    ok(await s.call('POST', '/api/boardgame/spy-used', { add: ['Cam|Quýt', 'Phở|Bún bò'] }));
    assert.deepEqual(ok(await s.call('GET', '/api/boardgame/spy-used')).pairs.sort(), ['Cam|Quýt', 'Phở|Bún bò']);
    assert.deepEqual(ok(await s.call('POST', '/api/boardgame/spy-used', { add: ['Chó|Sói'], forget: ['Phở|Bún bò', 'Cam|Quýt'] })).pairs, ['Chó|Sói']);
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
});
