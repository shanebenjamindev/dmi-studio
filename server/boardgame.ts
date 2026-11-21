// DMI Boardgame (/boardgame, web/public/boardgame/index.html), played without signing in. The players to pick from are
// the active staff; the leaderboard, the Gián Điệp pairs already dealt and the Ma Sói rooms for several phones live here.
// A player signed in to DMI Workspace is their account (u-<user id>), the same on every phone and computer they open it
// on; otherwise an anonymous id the browser made (x-bg-player) with a secret (x-bg-key, kept hashed) so only that
// browser changes its own part. Only someone in a room changes the room. Resetting the leaderboard takes a Workspace admin.
import crypto from 'node:crypto';
import { all, get, run, uid, now } from './db';
import { HttpError, json, readJson, type Router, type Req } from './http';
import { currentUser } from './auth';

const FRESH = 12 * 3600e3; // a room is listed this long after it was made
const KEEP = 2 * 86400e3; // rooms untouched for longer are cleared when a new one is made
const MAX_STATE = 64 * 1024, MAX_PLAYER = 4 * 1024, MAX_PAIRS = 2000;
const ROOM_ID = /^\d{4}$/, PLAYER_ID = /^[\w-]{8,64}$/;

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const parse = (s: string | undefined) => { try { return JSON.parse(s ?? 'null'); } catch { return null; } };
/** Who is calling: the signed-in account, or else the browser's player id; with the hashed secret that proves it. */
async function who(req: Req) {
  const u = await currentUser(req);
  if (u) return { id: playerOf(u.id), key: hash(`account:${u.id}`) };
  const id = String(req.headers['x-bg-player'] || ''), key = String(req.headers['x-bg-key'] || '');
  if (!PLAYER_ID.test(id) || key.length < 16 || key.length > 128) throw new HttpError(400, 'Thiếu mã người chơi');
  return { id, key: hash(key) };
}
export const playerOf = (userId: string) => `u-${userId}`;
function roomOf(req: Req) {
  if (!ROOM_ID.test(req.params.id)) throw new HttpError(400, 'Mã phòng không hợp lệ');
  return req.params.id;
}
/** Only someone who joined the room (from the same browser) changes it. */
async function member(req: Req, room: string) {
  const me = await who(req);
  if (!(await get('SELECT 1 FROM bg_players WHERE room_id = ? AND player_id = ? AND secret = ?', room, me.id, me.key))) throw new HttpError(403, 'Bạn không ở trong phòng này');
}
function sized(v: unknown, max: number) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Dữ liệu không hợp lệ');
  const s = JSON.stringify(v);
  if (s.length > max) throw new HttpError(413, 'Dữ liệu quá lớn');
  return s;
}
const strings = (v: unknown, max: number) => Array.isArray(v) && v.length <= MAX_PAIRS && v.every((x) => typeof x === 'string' && x.length <= max);
const bump = (room: string) => run('UPDATE bg_rooms SET v = v + 1, updated_at = ? WHERE id = ?', now(), room);
const kv = async (k: string) => (await get<{ v: string }>('SELECT v FROM bg_kv WHERE k = ?', k))?.v;

export function registerBoardgame(api: Router) {
  // The staff's names, for the seats' pickers.
  api.get('/api/boardgame/roster', async (_req, res) => {
    const rows = await all<{ name: string }>("SELECT name FROM users WHERE disabled = 0 AND TRIM(name) <> '' ORDER BY name COLLATE NOCASE");
    json(res, 200, { names: [...new Set(rows.map((r) => r.name.trim()))] });
  });

  // The games since the last reset, newest first (the page adds up the points), and whether this browser may reset.
  api.get('/api/boardgame/board', async (req, res) => {
    const games = await all<any>('SELECT game, text, results, created_at FROM bg_games WHERE created_at > ? ORDER BY created_at DESC LIMIT 1000', Number(await kv('board_reset')) || 0);
    json(res, 200, {
      games: games.map((g) => ({ t: g.created_at, game: g.game, text: g.text, results: parse(g.results) || [] })),
      canReset: (await currentUser(req))?.role === 'admin',
    });
  });
  api.post('/api/boardgame/games', async (req, res) => {
    const b = await readJson(req);
    const ok = ['spy', 'ww'].includes(b.game) && typeof b.text === 'string' && b.text.length <= 300 && Array.isArray(b.results) && b.results.length >= 1 && b.results.length <= 20
      && b.results.every((r: any) => typeof r?.name === 'string' && r.name.length <= 60 && Number.isInteger(r.pts) && r.pts >= 0 && r.pts <= 20 && typeof r.win === 'boolean');
    if (!ok) throw new HttpError(400, 'Kết quả ván không hợp lệ');
    const results = b.results.map(({ name, pts, win }: any) => ({ name, pts, win }));
    await run('INSERT INTO bg_games(id, game, text, results, created_at) VALUES(?,?,?,?,?)', uid('bg_'), b.game, b.text, JSON.stringify(results), now());
    json(res, 201, { ok: true });
  });
  // The games before now stay stored but no longer count.
  api.post('/api/boardgame/board/reset', async (req, res) => {
    if ((await currentUser(req))?.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên DMI Workspace mới đặt lại được bảng xếp hạng');
    await run("INSERT INTO bg_kv(k, v) VALUES('board_reset', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(now()));
    json(res, 200, { ok: true });
  });

  // Gián Điệp: the pairs already dealt, on any phone. A deal adds its pair; once a choice of topics is used up its
  // pairs are forgotten. In one statement, so two phones dealing at once keep both.
  api.get('/api/boardgame/spy-used', async (_req, res) => json(res, 200, { pairs: parse(await kv('spy_used')) || [] }));
  api.post('/api/boardgame/spy-used', async (req, res) => {
    const b = await readJson(req), add = b.add ?? [], forget = b.forget ?? [];
    if (!strings(add, 80) || !strings(forget, 80)) throw new HttpError(400, 'Danh sách không hợp lệ');
    await run("INSERT INTO bg_kv(k, v) VALUES('spy_used', '[]') ON CONFLICT(k) DO NOTHING");
    await run(`UPDATE bg_kv SET v = (SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(bg_kv.v) WHERE value NOT IN (SELECT value FROM json_each(?)) AND value NOT IN (SELECT value FROM json_each(?))
        UNION ALL SELECT DISTINCT value FROM json_each(?))) WHERE k = 'spy_used'`, JSON.stringify(forget), JSON.stringify(add), JSON.stringify(add));
    json(res, 200, { pairs: parse(await kv('spy_used')) || [] });
  });

  // Ma Sói for several phones. The rooms made lately, for the list to join from.
  api.get('/api/boardgame/rooms', async (_req, res) => {
    const rows = await all<any>('SELECT id, state, created_at FROM bg_rooms WHERE created_at > ? ORDER BY created_at DESC LIMIT 50', now() - FRESH);
    json(res, 200, { rooms: rows.map((r) => {
      const s = parse(r.state) || {};
      return { id: r.id, at: r.created_at, hostName: String(s.hostName || ''), phase: s.phase === 'play' ? 'play' : 'lobby' };
    }) });
  });
  // A room and its players, unless it has not changed since version ?v (the phones ask every second or two).
  api.get('/api/boardgame/rooms/:id', async (req, res) => {
    const id = roomOf(req);
    const room = await get<any>('SELECT state, v FROM bg_rooms WHERE id = ?', id);
    if (!room) throw new HttpError(404, 'Phòng đã đóng');
    if (String(room.v) === req.query.get('v')) return json(res, 200, { same: true });
    const players = await all<any>('SELECT player_id, data FROM bg_players WHERE room_id = ?', id);
    json(res, 200, { v: Number(room.v), room: parse(room.state), players: Object.fromEntries(players.map((p) => [p.player_id, parse(p.data)])) });
  });
  // Makes a room (create: a code in use is refused) or saves its new state (only someone in it).
  api.put('/api/boardgame/rooms/:id', async (req, res) => {
    const id = roomOf(req), b = await readJson(req), state = sized(b.state, MAX_STATE), t = now();
    if (b.create) {
      await who(req);
      if (await get('SELECT 1 FROM bg_rooms WHERE id = ? AND created_at > ?', id, t - FRESH)) throw new HttpError(409, 'Mã phòng đang được dùng');
      // Old rooms go, with their players: an old one under this code, and any left untouched for days.
      await run('DELETE FROM bg_players WHERE room_id = ? OR room_id IN (SELECT id FROM bg_rooms WHERE updated_at < ?)', id, t - KEEP);
      await run('DELETE FROM bg_rooms WHERE id = ? OR updated_at < ?', id, t - KEEP);
      await run('INSERT INTO bg_rooms(id, state, v, created_at, updated_at) VALUES(?,?,1,?,?)', id, state, t, t);
    } else {
      await member(req, id);
      // base: the revision (state.rev) the phone built this state on. When another phone has saved since, the write is
      // refused (409) so a phone holding an old copy (just woken, or no longer the host) cannot put the game back.
      if (typeof b.base === 'number') {
        const r = await run("UPDATE bg_rooms SET state = ?, v = v + 1, updated_at = ? WHERE id = ? AND COALESCE(json_extract(state, '$.rev'), 0) = ?", state, t, id, b.base);
        if (!r.changes) throw new HttpError(409, 'Phòng vừa đổi trên máy khác');
      } else {
        await run('UPDATE bg_rooms SET state = ?, v = v + 1, updated_at = ? WHERE id = ?', state, t, id);
      }
    }
    json(res, 200, { ok: true });
  });
  api.delete('/api/boardgame/rooms/:id', async (req, res) => {
    const id = roomOf(req);
    await member(req, id);
    await run('DELETE FROM bg_players WHERE room_id = ?', id);
    await run('DELETE FROM bg_rooms WHERE id = ?', id);
    json(res, 200, { ok: true });
  });
  // Joining, and each night's choice: the first write keeps the browser's secret, later ones must bring it.
  api.put('/api/boardgame/rooms/:id/players/me', async (req, res) => {
    const id = roomOf(req), me = await who(req), b = await readJson(req), data = sized(b.data, MAX_PLAYER);
    if (typeof b.data.name !== 'string' || !b.data.name.trim() || b.data.name.length > 60) throw new HttpError(400, 'Tên không hợp lệ');
    if (!(await get('SELECT 1 FROM bg_rooms WHERE id = ?', id))) throw new HttpError(404, 'Phòng đã đóng');
    const r = await run(`INSERT INTO bg_players(room_id, player_id, secret, data, updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(room_id, player_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE bg_players.secret = excluded.secret`, id, me.id, me.key, data, now());
    if (!r.changes) throw new HttpError(403, 'Mã người chơi này thuộc trình duyệt khác');
    await bump(id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/boardgame/rooms/:id/players/me', async (req, res) => {
    const id = roomOf(req), me = await who(req);
    await run('DELETE FROM bg_players WHERE room_id = ? AND player_id = ? AND secret = ?', id, me.id, me.key);
    await bump(id);
    json(res, 200, { ok: true });
  });
}
