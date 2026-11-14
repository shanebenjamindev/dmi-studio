// Source footage from Google Drive: the clips and photos a request sheet (or a pasted folder link) points at, for Claude
// Code to look at and build with (server/video-mcp.ts). Files are streamed from Drive on demand; every URL is signed so
// the API can't be used to read arbitrary Drive files.
import crypto from 'node:crypto';
import { Router, HttpError, json, readJson } from './http';
import { getSetting, setSetting } from './db';
import * as G from './google';

const MAX_SOURCES = 150;
const MAX_FOLDERS = 60;

export interface Source {
  id: string; account: string; sig: string; name: string; kind: 'video' | 'image'; mime: string;
  duration?: number; folder: string; url: string; thumb: string;
  /** The script row of the request sheet that asked for this clip. */
  row?: string;
}

// ---------------------------------------------------------------- signing
let secret: string | null = null;
async function key() {
  if (!secret) {
    secret = await getSetting<string>('source_secret', '');
    if (!secret) { secret = crypto.randomBytes(32).toString('hex'); await setSetting('source_secret', secret); }
  }
  return secret;
}
const sign = async (account: string, id: string) => crypto.createHmac('sha256', await key()).update(`${account}\n${id}`).digest('base64url').slice(0, 32);
export async function verify(account: string, id: string, sig: unknown) {
  const want = Buffer.from(await sign(account, id));
  const got = Buffer.from(String(sig || ''));
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new HttpError(403, 'Link source không hợp lệ');
}
/** Sources sent back by the browser: keep only the fields we trust, after checking each signature. */
export async function checkSources(list: any): Promise<Source[]> {
  if (!Array.isArray(list)) return [];
  const out: Source[] = [];
  for (const s of list.slice(0, MAX_SOURCES)) {
    await verify(String(s.account), String(s.id), s.sig);
    const src = await sourceOut(String(s.account), {
      id: String(s.id), name: String(s.name || ''), mimeType: String(s.mime || ''), videoMediaMetadata: s.duration ? { durationMillis: String(s.duration * 1000) } : undefined,
    }, String(s.folder || ''));
    out.push(s.row ? { ...src, row: String(s.row).slice(0, 200) } : src);
  }
  return out;
}

export async function sourceOut(account: string, f: Pick<G.GFile, 'id' | 'name' | 'mimeType' | 'videoMediaMetadata'>, folder: string): Promise<Source> {
  const sig = await sign(account, f.id);
  const q = `a=${encodeURIComponent(account)}&sig=${sig}`;
  const ms = Number(f.videoMediaMetadata?.durationMillis);
  return {
    id: f.id, account, sig, name: f.name, kind: f.mimeType.startsWith('video/') ? 'video' : 'image', mime: f.mimeType,
    ...(ms ? { duration: Math.round(ms / 100) / 10 } : {}), folder,
    url: `/api/sources/${encodeURIComponent(f.id)}?${q}`, thumb: `/api/sources/${encodeURIComponent(f.id)}/thumb?${q}`,
  };
}

/** Copies of one clip (the same file uploaded twice has two Drive ids): same name, same length. */
export const copyKey = (f: Pick<G.GFile, 'name' | 'videoMediaMetadata'>) => `${f.name.trim().toLowerCase()}|${Math.round(Number(f.videoMediaMetadata?.durationMillis || 0) / 100)}`;

// ---------------------------------------------------------------- scanning a Drive link
/** Folder or file id from any Drive URL shape (…/folders/ID, …/file/d/ID/view, ?id=ID) or a bare id. */
export function driveId(link: string) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : '';
}

export async function locate(id: string) {
  const accounts = await G.accounts();
  if (!accounts.length) throw new HttpError(400, 'Chưa kết nối tài khoản Google Drive nào. Quản trị viên hãy kết nối trong trang Khách hàng.');
  const fields = 'id,name,mimeType,videoMediaMetadata(durationMillis),thumbnailLink,shortcutDetails(targetId,targetMimeType)';
  for (const a of accounts) {
    let file: G.GFile;
    try { file = await G.meta(a.email, id, fields) as G.GFile; }
    catch { continue; } // not visible to this account
    // A link to a shortcut opens what it points at (folder, clip, photo or sheet).
    if (file.mimeType === G.SHORTCUT_MIME && file.shortcutDetails) {
      try { file = { ...await G.meta(a.email, file.shortcutDetails.targetId, fields) as G.GFile, name: file.name }; }
      catch { throw new HttpError(404, 'Lối tắt này trỏ tới file đã bị xoá hoặc chưa được chia sẻ'); }
    }
    return { account: a.email, file };
  }
  throw new HttpError(404, `Không mở được link này bằng tài khoản Google đã kết nối (${accounts.map((a) => a.email).join(', ')}). Hãy chia sẻ link (quyền Người xem) cho một trong các tài khoản đó.`);
}

export async function scan(link: string) {
  const id = driveId(link);
  if (!id) throw new HttpError(400, 'Link Google Drive không hợp lệ');
  const { account, file } = await locate(id);
  if (file.mimeType !== G.FOLDER_MIME) {
    if (!file.mimeType.startsWith('video/')) throw new HttpError(400, 'Link này không phải thư mục hay video');
    G.rememberThumb(file.id, file.thumbnailLink);
    return { folder: file.name, account, total: 1, sources: [await sourceOut(account, file, '')] };
  }
  // Walk sub-folders breadth-first; each file remembers the path of the folder it came from.
  const paths = new Map<string, string>([[file.id, '']]);
  let level = [file.id];
  while (level.length && paths.size < MAX_FOLDERS) {
    const next: string[] = [];
    for (const parent of level) {
      for (const d of await G.listFoldersDeep(account, parent)) {
        if (paths.size >= MAX_FOLDERS) break;
        if (paths.has(d.id)) continue; // folder shortcuts can loop back
        paths.set(d.id, [paths.get(parent), d.name].filter(Boolean).join('/'));
        next.push(d.id);
      }
    }
    level = next;
  }
  // Video only, each clip once (a copy of one already listed is left out).
  const seen = new Set<string>();
  const files = (await G.listMediaIn(account, [...paths.keys()])).filter((f) => f.mimeType.startsWith('video/') && !seen.has(copyKey(f)) && !!seen.add(copyKey(f)));
  const sources: Source[] = [];
  for (const f of files.slice(0, MAX_SOURCES)) {
    G.rememberThumb(f.id, f.thumbnailLink);
    sources.push(await sourceOut(account, f, paths.get(f.parents?.[0] || '') || ''));
  }
  return { folder: file.name, account, total: files.length, sources };
}

// ---------------------------------------------------------------- routes
export function registerSources(api: Router) {
  api.post('/api/sources/scan', async (req, res) => json(res, 200, await scan((await readJson(req)).link)));
  api.get('/api/sources/:id', async (req, res) => {
    const a = req.query.get('a') || '';
    await verify(a, req.params.id, req.query.get('sig'));
    await G.streamFile(a, req.params.id, req, res);
  });
  api.get('/api/sources/:id/thumb', async (req, res) => {
    const a = req.query.get('a') || '';
    await verify(a, req.params.id, req.query.get('sig'));
    await G.streamThumb(a, req.params.id, res);
  });
}
