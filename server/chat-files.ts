// Files of Tin nhắn, kept like Discord's: by this app itself (Cloudflare R2 in the cloud, DATA_DIR/chat-files on a Mac),
// never on Google Drive and never behind a public link. Each conversation (a channel, or the direct chat of two people)
// has a folder of its own with folders inside it; those folders exist only here, in the database. Only the people of a
// conversation open its files: both people of a direct chat, and for a channel whoever may read the channel.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Router, Req, Res } from './http';
import { HttpError, json, readJson, untrustedHeaders } from './http';
import { all, get, run, uid, now } from './db';
import { DATA_DIR, IS_CLOUDFLARE } from './config';
import { currentUser, type User } from './auth';
import { mimeOfName, kindOf, safeName, type FileKind } from './workspace';
import { needInChannel, type Perm } from './chat-perms';

/** Largest file sent in a chat. */
export const MAX_BYTES = 50 * 1024 * 1024;
const FOLDER = 'folder';

// ---------------------------------------------------------------- where the bytes live
// The R2 bucket the Worker is given (wrangler.jsonc › r2_buckets › CHAT_FILES); on a Mac, a folder of DATA_DIR.
let bucket: R2BucketLike | null = null;
interface R2BucketLike {
  put(key: string, body: ReadableStream | ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string, o?: { range?: { offset: number; length?: number } }): Promise<{ body: ReadableStream; size: number } | null>;
  delete(key: string): Promise<void>;
}
export const useChatBucket = (b: unknown) => { bucket = (b as R2BucketLike) || null; };
const diskDir = () => path.join(DATA_DIR, 'chat-files');
function store() {
  if (IS_CLOUDFLARE && !bucket) throw new HttpError(503, 'Chưa bật kho file của Tin nhắn (Cloudflare R2, binding CHAT_FILES)');
  return bucket;
}
/** Saves the request body (`size` bytes) under `key`, streamed: nothing is held in memory or left half-written. */
async function putBody(key: string, req: Req, size: number, mime: string) {
  const b = store();
  if (b) {
    const Fixed = (globalThis as any).FixedLengthStream;
    const web = Readable.toWeb(req) as unknown as ReadableStream;
    await b.put(key, Fixed ? web.pipeThrough(new Fixed(size)) : await new Response(web).arrayBuffer(), { httpMetadata: { contentType: mime } });
    return;
  }
  fs.mkdirSync(diskDir(), { recursive: true });
  const tmp = path.join(diskDir(), `.${key}.part`);
  try { await pipeline(req, fs.createWriteStream(tmp)); fs.renameSync(tmp, path.join(diskDir(), key)); }
  finally { fs.rm(tmp, { force: true }, () => {}); }
}
/** One byte range (for <video> seeking) or the whole file. */
function rangeOf(req: Req, size: number) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])), end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
async function sendBody(req: Req, res: Res, item: any) {
  const size = Number(item.bytes) || 0, r = rangeOf(req, size);
  const head: Record<string, string | number> = {
    'content-type': item.mime || 'application/octet-stream', 'accept-ranges': 'bytes',
    // An id never gets other bytes, so the browser may keep what it fetched (only for this account: private).
    'cache-control': 'private, max-age=604800, immutable', ...untrustedHeaders(item.mime || 'application/octet-stream', item.name),
    'content-length': r ? r.end - r.start + 1 : size, ...(r ? { 'content-range': `bytes ${r.start}-${r.end}/${size}` } : {}),
  };
  const b = store();
  let body: Readable;
  if (b) {
    const o = await b.get(item.store_key, r ? { range: { offset: r.start, length: r.end - r.start + 1 } } : undefined);
    if (!o) throw new HttpError(404, 'Không tìm thấy file');
    body = Readable.fromWeb(o.body as any);
  } else {
    const p = path.join(diskDir(), item.store_key);
    if (!fs.existsSync(p)) throw new HttpError(404, 'Không tìm thấy file');
    body = fs.createReadStream(p, r ? { start: r.start, end: r.end } : {});
  }
  res.writeHead(r ? 206 : 200, head);
  if (req.method === 'HEAD') { body.destroy(); return res.end(); }
  res.on('close', () => body.destroy());
  body.on('error', () => res.destroy());
  body.pipe(res);
}
async function dropBody(key: string) {
  const b = store();
  if (b) await b.delete(key);
  else fs.rmSync(path.join(diskDir(), key), { force: true });
}

// ---------------------------------------------------------------- conversations
/** A conversation as its folder knows it: `conv` is the same for both people of a direct chat. */
interface Conv { conv: string; title: string }
const cleanChannel = (s: string) => s.replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 64);
/** `c`: a channel id, "dm:<the other person>" or "dm:<a>:<b>". */
export async function convOf(u: User, raw: string): Promise<Conv> {
  if (raw.startsWith('dm:')) {
    const ids = raw.slice(3).split(':').filter(Boolean);
    const pair = ids.length === 1 ? [u.id, ids[0]] : ids;
    if (pair.length !== 2 || !pair.includes(u.id)) throw new HttpError(403, 'Bạn không ở trong cuộc trò chuyện này');
    const other = pair.find((x) => x !== u.id) || u.id;
    const people = await all<any>('SELECT id, name FROM users WHERE id IN (?, ?)', u.id, other);
    if (people.length !== (other === u.id ? 1 : 2)) throw new HttpError(404, 'Không tìm thấy người nhận');
    const sorted = [...pair].sort();
    return { conv: `dm:${sorted.join(':')}`, title: `@${people.find((p) => p.id === other)?.name || 'Ẩn danh'}` };
  }
  const id = cleanChannel(raw) || 'general';
  const custom = await get<any>('SELECT name FROM chat_channels WHERE id = ?', id);
  const ws = /^ws_(.+)_[^_]+$/.exec(id);
  return { conv: id, title: `#${custom?.name || (ws ? id.slice(`ws_${ws[1]}_`.length) : id)}` };
}
/** Everything of a conversation goes when its channel is deleted. */
export async function dropConversation(conv: string) {
  for (const r of await all<any>('SELECT store_key FROM chat_items WHERE conversation = ? AND store_key IS NOT NULL', conv)) await dropBody(r.store_key).catch(() => {});
  await run('DELETE FROM chat_items WHERE conversation = ?', conv);
}
/** Stops the request unless this person may `perm` in the conversation: a direct chat is its two people's, a channel's
 *  files follow its permissions (server/chat-perms.ts) — seeing them is viewing the channel, adding them is sending files. */
async function need(u: User, conv: string, perm: Perm) {
  if (conv.startsWith('dm:')) { if (!conv.slice(3).split(':').includes(u.id)) throw new HttpError(404, 'Không tìm thấy file'); return; }
  await needInChannel(u, conv, perm);
}

// ---------------------------------------------------------------- folders and files
export interface ChatFile {
  key: string; name: string; kind: FileKind; mime: string; bytes: number; modifiedAt: number;
  url: string | null; thumb: string | null; uploadedBy: string | null;
}
const out = (r: any): ChatFile => {
  const folder = r.kind === FOLDER, url = folder ? null : `/api/chat/files/${r.id}`;
  return {
    key: r.id, name: r.name, kind: folder ? 'folder' : kindOf(r.mime), mime: folder ? '' : r.mime, bytes: Number(r.bytes) || 0, modifiedAt: r.created_at,
    url, thumb: url && /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(r.mime) ? url : null, uploadedBy: r.uploader || null,
  };
};
const ITEM_SQL = 'SELECT i.*, u.name uploader FROM chat_items i LEFT JOIN users u ON u.id = i.uploaded_by';
async function mustItem(u: User, id: string) {
  const r = await get<any>(`${ITEM_SQL} WHERE i.id = ?`, id);
  if (!r) throw new HttpError(404, 'Không tìm thấy file');
  await need(u, r.conversation, 'view');
  return r;
}
/** Folder `id` of the conversation ('' = its top) with the folders above it, top first. */
async function folderIn(c: Conv, id: string) {
  const crumbs: { key: string; name: string }[] = [];
  for (let cur = id, k = 0; cur && k < 20; k++) {
    const r = await get<any>('SELECT id, name, parent_id, kind FROM chat_items WHERE id = ? AND conversation = ?', cur, c.conv);
    if (!r || r.kind !== FOLDER) throw new HttpError(404, 'Không tìm thấy thư mục');
    crumbs.unshift({ key: r.id, name: r.name });
    cur = r.parent_id;
  }
  return crumbs;
}
/** A name not yet used in that folder ("a.png" → "a (2).png"). */
async function freeName(conv: string, parent: string, name: string) {
  const taken = new Set((await all<any>('SELECT name FROM chat_items WHERE conversation = ? AND parent_id = ?', conv, parent)).map((r) => r.name));
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let n = name;
  for (let k = 2; taken.has(n); k++) n = `${stem} (${k})${ext}`;
  return n;
}

/** The attachments of a message: files of its conversation, by key. */
export async function attachmentsIn(u: User, raw: string, keys: unknown) {
  if (keys === undefined || keys === null) return [];
  if (!Array.isArray(keys) || keys.length > 10) throw new HttpError(400, 'Tối đa 10 file trong một tin nhắn');
  const c = await convOf(u, raw), list: Omit<ChatFile, 'modifiedAt' | 'uploadedBy'>[] = [];
  for (const k of keys) {
    const r = await get<any>(`${ITEM_SQL} WHERE i.id = ? AND i.conversation = ? AND i.kind <> ?`, String(k || ''), c.conv, FOLDER);
    if (!r) throw new HttpError(400, 'File đính kèm không thuộc cuộc trò chuyện này');
    const { modifiedAt, uploadedBy, ...a } = out(r);
    list.push(a);
  }
  return list;
}

export function registerChatFiles(api: Router) {
  const ctx = async (req: Req) => {
    const u = (await currentUser(req))!, c = await convOf(u, String(req.query.get('c') || ''));
    await need(u, c.conv, 'view');
    return { u, c, folder: String(req.query.get('folder') || '') };
  };

  api.get('/api/chat/files', async (req, res) => {
    const { c, folder } = await ctx(req);
    const crumbs = await folderIn(c, folder);
    const rows = await all<any>(`${ITEM_SQL} WHERE i.conversation = ? AND i.parent_id = ? ORDER BY CASE WHEN i.kind = ? THEN 0 ELSE 1 END, CASE WHEN i.kind = ? THEN i.name END COLLATE NOCASE, i.created_at DESC`, c.conv, folder, FOLDER, FOLDER);
    json(res, 200, { title: c.title, crumbs, items: rows.map(out) });
  });

  api.post('/api/chat/files/folders', async (req, res) => {
    const { u, c, folder } = await ctx(req);
    await need(u, c.conv, 'attach');
    await folderIn(c, folder);
    const raw = safeName(String((await readJson(req)).name || ''));
    if (!raw) throw new HttpError(400, 'Hãy đặt tên thư mục');
    const id = uid('cf_'), name = await freeName(c.conv, folder, raw);
    await run('INSERT INTO chat_items(id, conversation, parent_id, kind, name, mime, bytes, store_key, uploaded_by, created_at) VALUES(?,?,?,?,?,?,0,NULL,?,?)', id, c.conv, folder, FOLDER, name, '', u.id, now());
    json(res, 201, out(await get<any>(`${ITEM_SQL} WHERE i.id = ?`, id)));
  });

  // The file is the request body; its name comes in the address.
  api.post('/api/chat/files', async (req, res) => {
    const { u, c, folder } = await ctx(req);
    await need(u, c.conv, 'attach');
    await folderIn(c, folder);
    const raw = safeName(String(req.query.get('name') || 'file'));
    if (!raw) throw new HttpError(400, 'Tên file không hợp lệ');
    const size = Number(req.headers['content-length'] || 0);
    if (!size) throw new HttpError(411, 'Thiếu kích thước file');
    if (size > MAX_BYTES) throw new HttpError(413, `File tối đa ${MAX_BYTES / 1024 / 1024} MB`);
    const mime = String(req.headers['content-type'] || '').split(';')[0] || mimeOfName(raw);
    const id = uid('cf_');
    await putBody(id, req, size, mime);
    await run('INSERT INTO chat_items(id, conversation, parent_id, kind, name, mime, bytes, store_key, uploaded_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, c.conv, folder, 'file', await freeName(c.conv, folder, raw), mime, size, id, u.id, now());
    json(res, 201, out(await get<any>(`${ITEM_SQL} WHERE i.id = ?`, id)));
  });

  api.get('/api/chat/files/:key', async (req, res) => {
    const u = (await currentUser(req))!, r = await mustItem(u, req.params.key);
    if (r.kind === FOLDER) throw new HttpError(404, 'Không tìm thấy file');
    await sendBody(req, res, r);
  });
  // Whoever put it here, or an admin. Folders only when empty.
  api.delete('/api/chat/files/:key', async (req, res) => {
    const u = (await currentUser(req))!, r = await mustItem(u, req.params.key);
    if (r.uploaded_by !== u.id) {
      if (!r.conversation.startsWith('dm:')) await needInChannel(u, r.conversation, 'manage_messages');
      else if (u.role !== 'admin') throw new HttpError(403, 'Chỉ người tải lên hoặc quản trị viên mới xoá được');
    }
    if (r.kind === FOLDER && (await get('SELECT 1 FROM chat_items WHERE parent_id = ? LIMIT 1', r.id))) throw new HttpError(409, 'Thư mục còn file bên trong, hãy xoá chúng trước');
    if (r.store_key) await dropBody(r.store_key);
    await run('DELETE FROM chat_items WHERE id = ?', r.id);
    json(res, 200, { ok: true });
  });
}
