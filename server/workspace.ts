// Customer workspace. A customer's videos live in a folder that is either
//  • on Google Drive through "Sign in with Google" (Drive API; uploads stream straight to Google, nothing kept on disk), or
//  • a folder on this Mac (data/workspace, or a Google Drive for desktop mount that syncs by itself).
// The folder is the source of truth: videos added to it elsewhere show up here too.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';
import type { Router, Req, Res } from './http';
import { HttpError, json, readJson, sendFile, publicOrigin } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { DATA_DIR } from './config';
import * as G from './google';
import { currentUser, finishGoogleSignin } from './auth';

const pexec = promisify(execFile);
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
const WORKSPACE_FOLDER = 'DM Studio Workspace';
const SPARE = 300 * 1024 * 1024; // keep this much disk free after a local upload

export type Loc = { kind: 'fs'; dir: string } | { kind: 'gdrive'; account: string; id: string; label?: string; owned?: boolean };

// ---------------------------------------------------------------- local folders (incl. Google Drive for desktop)
const CLOUD = path.join(os.homedir(), 'Library', 'CloudStorage');
const LOCAL_WS = () => path.join(DATA_DIR, 'workspace');
function driveMounts() {
  try {
    return fs.readdirSync(CLOUD).filter((d) => d.startsWith('GoogleDrive-')).map((d) => ({ account: d.slice('GoogleDrive-'.length), dir: path.join(CLOUD, d, 'My Drive') }))
      .filter((m) => fs.existsSync(m.dir));
  } catch { return []; }
}
const onDesktopDrive = (dir: string) => dir.startsWith(CLOUD + path.sep + 'GoogleDrive-');
function allowed(p: string) {
  const r = path.resolve(p);
  return (r.startsWith(CLOUD + path.sep) && /\/CloudStorage\/GoogleDrive-[^/]+\/(My Drive|Shared drives)(\/|$)/.test(r)) || r === LOCAL_WS() || r.startsWith(LOCAL_WS() + path.sep);
}
function mustDir(p: string) {
  const r = path.resolve(String(p || ''));
  if (!allowed(r)) throw new HttpError(400, 'Chỉ chọn được thư mục trong Google Drive hoặc thư mục workspace trên máy');
  if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw new HttpError(404, 'Thư mục không tồn tại');
  return r;
}
interface FsPlace { label: string; account: string | null; kind: 'my' | 'shared' | 'local'; dir: string }
function fsPlaces(): FsPlace[] {
  fs.mkdirSync(LOCAL_WS(), { recursive: true });
  const out: FsPlace[] = [];
  for (const m of driveMounts()) {
    out.push({ label: 'My Drive', account: m.account, kind: 'my', dir: m.dir });
    try {
      for (const d of fs.readdirSync(path.join(path.dirname(m.dir), 'Shared drives'), { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('.')) out.push({ label: d.name, account: m.account, kind: 'shared', dir: path.join(path.dirname(m.dir), 'Shared drives', d.name) });
      }
    } catch { /* no shared drives */ }
  }
  out.push({ label: 'Trên máy (không đồng bộ)', account: null, kind: 'local', dir: LOCAL_WS() });
  return out;
}
function fsCrumbs(dir: string) {
  const pl = fsPlaces().filter((x) => dir === x.dir || dir.startsWith(x.dir + path.sep)).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (!pl) return { account: null, crumbs: [{ name: dir, loc: { kind: 'fs', dir } as Loc }] };
  const crumbs = [{ name: pl.label, loc: { kind: 'fs', dir: pl.dir } as Loc }];
  let cur = pl.dir;
  for (const part of path.relative(pl.dir, dir).split(path.sep).filter(Boolean)) { cur = path.join(cur, part); crumbs.push({ name: part, loc: { kind: 'fs', dir: cur } }); }
  return { account: pl.account, crumbs };
}
const fsLabel = (dir: string) => fsCrumbs(dir).crumbs.map((c) => c.name).join(' › ');

const idCache = new Map<string, { mtime: number; id: string | null }>();
/** Drive file/folder ID that Drive for desktop stores as an extended attribute once the item is synced. */
async function desktopDriveId(p: string, mtime: number) {
  const hit = idCache.get(p);
  if (hit && hit.mtime === mtime && hit.id) return hit.id;
  let id: string | null = null;
  try {
    const { stdout } = await pexec('xattr', ['-p', 'com.google.drivefs.item-id#S', p]);
    id = stdout.trim() || null;
    if (id && (!/^[\w-]{15,}$/.test(id) || id.startsWith('local'))) id = null; // placeholder ids until the upload finishes
  } catch { /* not synced yet / not on Drive */ }
  idCache.set(p, { mtime, id });
  return id;
}

/** Google Drive names may contain "/" (e.g. "11/2026"); only control characters are dropped. */
const driveName = (s: string) => s.normalize('NFC').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const safeName = (s: string) => s.normalize('NFC').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
function uniqueIn(dir: string, name: string) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let out = name;
  for (let k = 2; fs.existsSync(path.join(dir, out)); k++) out = `${stem} (${k})${ext}`;
  return out;
}

// ---------------------------------------------------------------- workspace root
/** Saved root → legacy folder setting / DRIVE_DIR → first Drive for desktop mount → local folder in data/. */
export function rootLoc(): Loc {
  const saved = getSetting<Loc | null>('workspace_root', null);
  if (saved && (saved.kind === 'fs' || G.accounts().some((a) => a.email === saved.account))) return saved;
  const legacy = getSetting<string>('workspace_dir', '') || process.env.DRIVE_DIR || '';
  if (legacy) return { kind: 'fs', dir: legacy };
  const m = driveMounts()[0];
  return { kind: 'fs', dir: m ? path.join(m.dir, WORKSPACE_FOLDER) : LOCAL_WS() };
}
const storageOf = (l: Loc) => (l.kind === 'gdrive' ? 'google' : onDesktopDrive(l.dir) ? 'desktop' : 'local');
function locLabel(l: Loc) { return l.kind === 'gdrive' ? l.label || 'Google Drive' : fsLabel(l.dir); }
function locAccount(l: Loc) { return l.kind === 'gdrive' ? l.account : fsCrumbs(l.dir).account; }

async function gLabel(account: string, id: string) { return (await G.crumbs(account, id)).map((c) => c.name).join(' › '); }
async function mustLoc(raw: any): Promise<Loc> {
  if (raw?.kind === 'gdrive') {
    const account = String(raw.account || ''), id = String(raw.id || '');
    const f = await G.meta(account, id, 'id,mimeType,trashed');
    if (f.mimeType !== G.FOLDER_MIME) throw new HttpError(400, 'Đây không phải thư mục');
    return { kind: 'gdrive', account, id: f.id, label: await gLabel(account, f.id) };
  }
  return { kind: 'fs', dir: mustDir(raw?.dir) };
}

// ---------------------------------------------------------------- customers
const mustCustomer = (id: string) => {
  const c = get<any>('SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Không tìm thấy khách hàng');
  return c;
};
/** gloc set → Google Drive folder; otherwise `folder` is a local path (relative to a local root, or absolute). */
function custLoc(c: any): Loc {
  if (c.gloc) return { kind: 'gdrive', ...JSON.parse(c.gloc) };
  if (path.isAbsolute(c.folder)) return { kind: 'fs', dir: c.folder };
  const r = rootLoc();
  return { kind: 'fs', dir: path.join(r.kind === 'fs' ? r.dir : LOCAL_WS(), c.folder) };
}

// A customer's folder holds video folders (shown as tabs); videos lying directly in it show under "Chung".
const knownIds = new Map<string, Set<string>>(); // customer → Drive file/folder ids seen under its folder
function remember(cid: string, ids: string[]) {
  if (!knownIds.has(cid)) knownIds.set(cid, new Set());
  for (const id of ids) knownIds.get(cid)!.add(id);
}
/** A Drive video directly in the customer folder or in one of its video folders. */
async function mustOwnVideo(c: any, l: Extract<Loc, { kind: 'gdrive' }>, key: string) {
  if (knownIds.get(c.id)?.has(key)) return;
  const f = await G.meta(l.account, key, 'id,parents,mimeType');
  const parent = f.parents?.[0];
  let ok = f.mimeType.startsWith('video/') && !!parent;
  if (ok && parent !== l.id) ok = !!(await G.meta(l.account, parent!, 'id,parents').catch(() => null))?.parents?.includes(l.id);
  if (!ok) throw new HttpError(404, 'Không tìm thấy video');
  remember(c.id, [key]);
}
const validSub = (n: string) => !!n && !/[\/\\]/.test(n) && !n.startsWith('.');
/** Video folder `fkey` ('' = the customer folder itself): a Drive folder id inside the customer folder, or a sub-folder name on disk. */
async function subLoc(c: any, l: Loc, fkey: string): Promise<Loc> {
  if (!fkey) return l;
  if (l.kind === 'gdrive') {
    if (!knownIds.get(c.id)?.has(fkey)) {
      const f = await G.meta(l.account, fkey, 'id,parents,mimeType').catch(() => null);
      if (f?.mimeType !== G.FOLDER_MIME || !f.parents?.includes(l.id)) throw new HttpError(404, 'Không tìm thấy thư mục video');
      remember(c.id, [fkey]);
    }
    return { kind: 'gdrive', account: l.account, id: fkey };
  }
  if (!validSub(fkey)) throw new HttpError(404, 'Không tìm thấy thư mục video');
  return { kind: 'fs', dir: path.join(l.dir, fkey) };
}
/** Local video keys are "name" or "folder/name". */
function fsVideoKey(key: string) {
  const parts = key.split('/');
  if (parts.length > 2 || !parts.every(validSub) || !VIDEO.test(key)) throw new HttpError(404, 'Không tìm thấy video');
  return parts;
}
const byNew = (a: any, b: any) => b.modifiedAt - a.modifiedAt;
const gVideo = (c: any, f: G.GFile) => ({
  key: f.id, name: f.name, bytes: Number(f.size || 0), modifiedAt: Date.parse(f.modifiedTime || '') || 0,
  url: `/api/customers/${c.id}/videos/${f.id}`, thumb: f.thumbnailLink ? `/api/customers/${c.id}/videos/${f.id}/thumb?v=${Date.parse(f.modifiedTime || '') || 0}` : null,
  driveId: f.id, driveUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`, shared: !!f.shared,
});
async function fsVideos(c: any, dir: string, prefix: string) {
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => VIDEO.test(n) && !n.startsWith('.')); } catch { return []; }
  const desktop = onDesktopDrive(dir);
  const out = await Promise.all(names.map(async (name) => {
    const p = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { return null; }
    if (!st.isFile()) return null;
    const id = desktop ? await desktopDriveId(p, st.mtimeMs) : null;
    return {
      key: prefix + name, name, bytes: st.size, modifiedAt: st.mtimeMs, url: `/api/customers/${c.id}/videos/${encodeURIComponent(prefix + name)}`, thumb: null,
      driveId: id, driveUrl: id ? `https://drive.google.com/file/d/${id}/view` : null, shared: false,
    };
  }));
  return out.filter(Boolean).sort(byNew);
}
const fsSubdirs = (dir: string) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && validSub(d.name)).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'vi')); }
  catch { return []; }
};
// Drive listings are reused for 30 s (sidebar counts and the open customer share them); any change made here drops them.
const libCache = new Map<string, { at: number; data: Promise<Awaited<ReturnType<typeof readLibrary>>> }>();
const invalidate = (cid: string) => libCache.delete(cid);
function library(c: any, l: Loc, fresh = false) {
  if (l.kind !== 'gdrive') return readLibrary(c, l);
  const hit = libCache.get(c.id);
  if (!fresh && hit && Date.now() - hit.at < 30e3) return hit.data;
  const data = readLibrary(c, l);
  libCache.set(c.id, { at: Date.now(), data });
  data.catch(() => libCache.delete(c.id));
  return data;
}
/** Loose videos in the customer folder + every video folder with its videos. */
async function readLibrary(c: any, l: Loc) {
  if (l.kind === 'gdrive') {
    const dirs = await G.listFolders(l.account, l.id);
    const files = await G.listVideosIn(l.account, [l.id, ...dirs.map((d) => d.id)]);
    remember(c.id, [...dirs.map((d) => d.id), ...files.map((f) => f.id)]);
    for (const f of files) G.rememberThumb(f.id, f.thumbnailLink);
    const of = (id: string) => files.filter((f) => f.parents?.includes(id)).map((f) => gVideo(c, f)).sort(byNew);
    return { videos: of(l.id), folders: dirs.map((d) => ({ key: d.id, name: d.name, driveUrl: `https://drive.google.com/drive/folders/${d.id}`, videos: of(d.id) })) };
  }
  const desktop = onDesktopDrive(l.dir);
  return {
    videos: await fsVideos(c, l.dir, ''),
    folders: await Promise.all(fsSubdirs(l.dir).map(async (name) => {
      const dir = path.join(l.dir, name);
      let id: string | null = null;
      if (desktop) { try { id = await desktopDriveId(dir, fs.statSync(dir).mtimeMs); } catch { /* gone */ } }
      return { key: name, name, driveUrl: id ? `https://drive.google.com/drive/folders/${id}` : null, videos: await fsVideos(c, dir, name + '/') };
    })),
  };
}
async function counts(c: any, l: Loc, fresh = false): Promise<{ videos: number | null; folders: number | null }> {
  if (l.kind === 'gdrive') {
    return library(c, l, fresh).then((x) => ({ videos: x.videos.length + x.folders.reduce((n, f) => n + f.videos.length, 0), folders: x.folders.length }))
      .catch(() => ({ videos: null, folders: null }));
  }
  const n = (dir: string) => { try { return fs.readdirSync(dir).filter((x) => VIDEO.test(x) && !x.startsWith('.')).length; } catch { return 0; } };
  const subs = fsSubdirs(l.dir);
  return { videos: n(l.dir) + subs.reduce((k, d) => k + n(path.join(l.dir, d)), 0), folders: subs.length };
}

// ---------------------------------------------------------------- root folder ↔ customer list
// Every folder inside the workspace root is a customer: folders made on Drive directly show up on their own.
// Hiding a customer remembers its folder so it does not come back on the next sync.
const folderKey = (l: Loc) => (l.kind === 'gdrive' ? `g:${l.id}` : `f:${path.resolve(l.dir)}`);
const hidden = () => new Set(getSetting<string[]>('hidden_folders', []));
function setHidden(key: string, on: boolean) {
  const h = hidden();
  if (on) h.add(key); else h.delete(key);
  setSetting('hidden_folders', h.size ? [...h] : null);
}
let syncing: Promise<Set<string>> | null = null;
const syncRoot = () => (syncing ??= doSync().finally(() => { syncing = null; }));
/** Imports new folders of the root and returns the keys of every folder directly inside it. */
async function doSync() {
  const r = rootLoc(), skip = hidden();
  for (const c of all<any>('SELECT * FROM customers')) skip.add(folderKey(custLoc(c)));
  const found: { name: string; folder: string; gloc: string | null; key: string }[] = [];
  if (r.kind === 'gdrive') {
    for (const d of await G.listFolders(r.account, r.id)) {
      found.push({ name: d.name, folder: d.name, key: `g:${d.id}`, gloc: JSON.stringify({ account: r.account, id: d.id, label: `${locLabel(r)} › ${d.name}`, owned: true }) });
    }
  } else {
    for (const name of fsSubdirs(r.dir)) found.push({ name, folder: name, gloc: null, key: folderKey({ kind: 'fs', dir: path.join(r.dir, name) }) });
  }
  for (const f of found) {
    if (skip.has(f.key)) continue;
    run('INSERT INTO customers(id, name, links, notes, folder, gloc, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', uid('c_'), f.name, '[]', '', f.folder, f.gloc, now(), now());
  }
  return new Set(found.map((f) => f.key));
}
// Links about the customer: their Google Sheet, Docs, Facebook page… Only http(s) URLs are kept.
function cleanLinks(v: any) {
  if (!Array.isArray(v)) throw new HttpError(400, 'Danh sách link không hợp lệ');
  return v.slice(0, 50).map((x) => {
    const url = String(x?.url || '').trim();
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { throw new HttpError(400, `Link không hợp lệ: ${url || '(trống)'}`); }
    return { label: String(x?.label || '').trim().slice(0, 80), url };
  });
}
const linksOf = (c: any) => { try { return JSON.parse(c.links || '[]'); } catch { return []; } };

async function customerOut(c: any, full = false, fresh = false) {
  const l = custLoc(c);
  const out: any = {
    id: c.id, name: c.name, links: linksOf(c), notes: c.notes || '',
    storage: storageOf(l), account: locAccount(l), folderLabel: locLabel(l), folderLoc: l, folderPath: l.kind === 'fs' ? l.dir : '',
    createdAt: c.created_at, updatedAt: c.updated_at,
  };
  if (full) {
    try { Object.assign(out, await library(c, l, fresh)); } catch (e: any) { Object.assign(out, { videos: [], folders: [], error: e.message }); }
    out.projects = all<any>('SELECT id, title, aspect, updated_at FROM projects WHERE customer_id = ? ORDER BY updated_at DESC', c.id)
      .map((p) => ({ id: p.id, title: p.title, aspect: p.aspect, updatedAt: p.updated_at }));
    if (l.kind === 'gdrive') out.driveFolderUrl = `https://drive.google.com/drive/folders/${l.id}`;
    else {
      let st: fs.Stats | null = null;
      try { st = fs.statSync(l.dir); } catch { /* not created yet */ }
      const fid = st && onDesktopDrive(l.dir) ? await desktopDriveId(l.dir, st.mtimeMs) : null;
      out.driveFolderUrl = fid ? `https://drive.google.com/drive/folders/${fid}` : null;
    }
  } else {
    out.projectCount = get<any>('SELECT COUNT(*) n FROM projects WHERE customer_id = ?', c.id)?.n || 0;
    const n = await counts(c, l, fresh);
    out.videoCount = n.videos; out.folderCount = n.folders;
  }
  return out;
}

const redirectUri = (req: Req) => `${publicOrigin(req)}/api/google/callback`;
const redirect = (res: Res, to: string) => { res.writeHead(302, { location: to }); res.end(); };

export function registerWorkspace(api: Router) {
  // ---------------------------------------------------------------- Google sign-in
  api.get('/api/google/status', (req, res) => {
    const c = G.oauthConfig();
    json(res, 200, { configured: !!(c.clientId && c.clientSecret), clientId: c.clientId, redirectUri: redirectUri(req), accounts: G.publicAccounts() });
  });
  api.put('/api/google/config', async (req, res) => {
    const b = await readJson(req);
    G.setOauthConfig(String(b.clientId || ''), String(b.clientSecret || ''));
    json(res, 200, { ok: true });
  });
  api.get('/api/google/login', (req, res) => redirect(res, G.authUrl(redirectUri(req))));
  // Shared by both Google flows: connecting a Drive account, and signing in to DM Studio.
  api.get('/api/google/callback', async (req, res) => {
    const err = req.query.get('error'), state = req.query.get('state') || '';
    const signin = G.purposeOf(state) === 'signin';
    try {
      if (err) throw new Error(err === 'access_denied' ? 'Bạn đã huỷ đăng nhập' : err);
      const a = await G.finishLogin(req.query.get('code') || '', state);
      if (a.purpose === 'signin') { finishGoogleSignin(req, res, a.email); return redirect(res, '/'); }
      if (!currentUser(req)) throw new Error('Hãy đăng nhập DM Studio trước');
      redirect(res, `/#workspace?google=${encodeURIComponent(a.email)}`);
    } catch (e: any) {
      redirect(res, signin ? `/?auth_error=${encodeURIComponent(e.message)}` : `/#workspace?google_error=${encodeURIComponent(e.message)}`);
    }
  });
  api.delete('/api/google/accounts/:email', (req, res) => { G.removeAccount(req.params.email); json(res, 200, { accounts: G.publicAccounts() }); });

  // ---------------------------------------------------------------- workspace root & folder browsing
  // Breadcrumb of the root (each step can become the root); Drive paths are cached since they cost a call per level.
  const crumbCache = new Map<string, { name: string; loc: Loc }[]>();
  async function rootCrumbs(l: Loc) {
    if (l.kind === 'fs') return fsCrumbs(l.dir).crumbs;
    const k = `${l.account}|${l.id}`;
    if (!crumbCache.has(k)) {
      const chain = await G.crumbs(l.account, l.id).catch(() => null);
      if (!chain) return [{ name: locLabel(l), loc: l }];
      crumbCache.set(k, chain.map((c) => ({ name: c.name, loc: { kind: 'gdrive', account: l.account, id: c.id } as Loc })));
    }
    return crumbCache.get(k)!;
  }
  const wsOut = async () => {
    const l = rootLoc();
    return { loc: l, storage: storageOf(l), label: locLabel(l), account: locAccount(l), drive: storageOf(l) !== 'local', mounts: driveMounts(), crumbs: await rootCrumbs(l) };
  };
  api.get('/api/workspace', async (_q, res) => json(res, 200, await wsOut()));
  // Change the root. Existing customers keep their current folders; new customers go to the new root.
  api.put('/api/workspace', async (req, res) => {
    const l = await mustLoc((await readJson(req)).loc);
    const old = rootLoc();
    if (old.kind === 'fs') {
      for (const c of all<any>('SELECT id, folder, gloc FROM customers')) {
        if (!c.gloc && !path.isAbsolute(c.folder)) run('UPDATE customers SET folder=? WHERE id=?', path.join(old.dir, c.folder), c.id);
      }
    }
    setSetting('workspace_root', l);
    json(res, 200, await wsOut());
  });
  api.get('/api/workspace/places', async (_q, res) => {
    const out: { label: string; account: string | null; kind: string; via: string; loc: Loc }[] = [];
    for (const a of G.accounts()) {
      out.push({ label: 'My Drive', account: a.email, kind: 'my', via: 'google', loc: { kind: 'gdrive', account: a.email, id: 'root' } });
      for (const d of await G.sharedDrives(a.email).catch(() => [])) out.push({ label: d.name, account: a.email, kind: 'shared', via: 'google', loc: { kind: 'gdrive', account: a.email, id: d.id } });
    }
    for (const p of fsPlaces()) out.push({ label: p.label, account: p.account, kind: p.kind, via: p.kind === 'local' ? 'local' : 'desktop', loc: { kind: 'fs', dir: p.dir } });
    json(res, 200, out);
  });
  api.post('/api/workspace/browse', async (req, res) => {
    const raw = (await readJson(req)).loc;
    if (raw?.kind === 'gdrive') {
      const account = String(raw.account), chain = await G.crumbs(account, String(raw.id));
      const here = chain[chain.length - 1];
      const dirs = (await G.listFolders(account, here.id)).map((f) => ({ name: f.name, loc: { kind: 'gdrive', account, id: f.id } }));
      return json(res, 200, { loc: { kind: 'gdrive', account, id: here.id }, account, crumbs: chain.map((c) => ({ name: c.name, loc: { kind: 'gdrive', account, id: c.id } })), dirs });
    }
    const dir = mustDir(raw?.dir);
    let dirs: { name: string; loc: Loc }[] = [];
    try {
      dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => ({ name: d.name, loc: { kind: 'fs', dir: path.join(dir, d.name) } as Loc })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    } catch (e: any) { throw new HttpError(500, 'Không đọc được thư mục: ' + e.message); }
    json(res, 200, { loc: { kind: 'fs', dir }, ...fsCrumbs(dir), dirs });
  });
  api.post('/api/workspace/folders', async (req, res) => {
    const b = await readJson(req);
    const name = safeName(String(b.name || ''));
    if (!name) throw new HttpError(400, 'Hãy nhập tên thư mục');
    if (b.loc?.kind === 'gdrive') {
      const account = String(b.loc.account);
      if (await G.findChildFolder(account, String(b.loc.id), name)) throw new HttpError(409, 'Đã có thư mục cùng tên');
      const f = await G.createFolder(account, String(b.loc.id), name);
      return json(res, 201, { name, loc: { kind: 'gdrive', account, id: f.id } });
    }
    const p = path.join(mustDir(b.loc?.dir), name);
    if (fs.existsSync(p)) throw new HttpError(409, 'Đã có thư mục cùng tên');
    fs.mkdirSync(p);
    json(res, 201, { name, loc: { kind: 'fs', dir: p } });
  });

  // ---------------------------------------------------------------- customers
  api.get('/api/customers', async (req, res) => {
    const fresh = req.query.get('fresh') === '1';
    // Only the folders inside the current root: customers of another root stay saved and come back when that root is chosen again.
    const inRoot = await syncRoot().catch((e) => { console.warn('workspace sync:', e.message); return null; });
    const rows = all<any>('SELECT * FROM customers ORDER BY name COLLATE NOCASE').filter((c) => !inRoot || inRoot.has(folderKey(custLoc(c))));
    json(res, 200, await Promise.all(rows.map((c) => customerOut(c, false, fresh))));
  });
  api.post('/api/customers', async (req, res) => {
    const b = await readJson(req);
    const name = safeName(String(b.name || ''));
    if (!name) throw new HttpError(400, 'Hãy nhập tên khách hàng');
    const root = rootLoc();
    let folder = name, gloc: string | null = null;
    if (root.kind === 'gdrive') {
      let unique = name;
      for (let k = 2; await G.findChildFolder(root.account, root.id, unique); k++) unique = `${name} (${k})`;
      const f = await G.createFolder(root.account, root.id, unique);
      folder = unique;
      gloc = JSON.stringify({ account: root.account, id: f.id, label: `${locLabel(root)} › ${unique}`, owned: true });
    } else {
      fs.mkdirSync(root.dir, { recursive: true });
      folder = uniqueIn(root.dir, name);
      fs.mkdirSync(path.join(root.dir, folder), { recursive: true });
    }
    const id = uid('c_');
    run('INSERT INTO customers(id, name, links, notes, folder, gloc, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
      id, String(b.name).trim(), JSON.stringify(b.links ? cleanLinks(b.links) : []), b.notes || '', folder, gloc, now(), now());
    json(res, 201, await customerOut(mustCustomer(id), true));
  });
  api.get('/api/customers/:id', async (req, res) => json(res, 200, await customerOut(mustCustomer(req.params.id), true, req.query.get('fresh') === '1')));
  api.put('/api/customers/:id', async (req, res) => {
    const c = mustCustomer(req.params.id);
    const b = await readJson(req);
    let folder = c.folder, gloc = c.gloc;
    const newName = b.name !== undefined ? String(b.name).trim() : '';
    if (newName && newName !== c.name) {
      // Rename the folder along with the customer when DM Studio created it (Drive keeps the same ID and share links).
      const want = safeName(newName), l = custLoc(c);
      if (l.kind === 'gdrive' && l.owned) {
        await G.rename(l.account, l.id, want).catch(() => {});
        const label = (l.label || '').split(' › ').slice(0, -1).concat(want).join(' › ');
        gloc = JSON.stringify({ ...JSON.parse(c.gloc), label }); folder = want;
      } else if (l.kind === 'fs' && !path.isAbsolute(c.folder)) {
        const parent = path.dirname(l.dir), next = uniqueIn(parent, want);
        try { fs.renameSync(l.dir, path.join(parent, next)); folder = next; } catch { /* keep old folder name */ }
      }
    }
    run('UPDATE customers SET name=?, links=?, notes=?, folder=?, gloc=?, updated_at=? WHERE id=?',
      newName || c.name, b.links !== undefined ? JSON.stringify(cleanLinks(b.links)) : c.links, b.notes ?? c.notes, folder, gloc, now(), c.id);
    json(res, 200, await customerOut(mustCustomer(c.id), true));
  });
  // Link the customer to any existing folder (e.g. an old project folder on Drive).
  api.put('/api/customers/:id/folder', async (req, res) => {
    const c = mustCustomer(req.params.id);
    const l = await mustLoc((await readJson(req)).loc);
    setHidden(folderKey(l), false);
    if (l.kind === 'gdrive') run('UPDATE customers SET folder=?, gloc=?, updated_at=? WHERE id=?', l.label?.split(' › ').pop() || c.folder, JSON.stringify({ account: l.account, id: l.id, label: l.label }), now(), c.id);
    else run('UPDATE customers SET folder=?, gloc=NULL, updated_at=? WHERE id=?', l.dir, now(), c.id);
    knownIds.delete(c.id); invalidate(c.id);
    json(res, 200, await customerOut(mustCustomer(c.id), true));
  });
  // Hides the customer in DM Studio only; the folder and its videos stay untouched.
  api.delete('/api/customers/:id', (req, res) => {
    setHidden(folderKey(custLoc(mustCustomer(req.params.id))), true);
    run('UPDATE projects SET customer_id = NULL WHERE customer_id = ?', req.params.id);
    run('DELETE FROM customers WHERE id = ?', req.params.id);
    json(res, 200, { ok: true });
  });
  api.post('/api/customers/:id/reveal', async (req, res) => {
    const l = custLoc(mustCustomer(req.params.id));
    if (l.kind !== 'fs') throw new HttpError(400, 'Thư mục này nằm trên Google Drive, hãy dùng "Mở trên Drive"');
    fs.mkdirSync(l.dir, { recursive: true });
    await pexec('open', [l.dir]).catch(() => { throw new HttpError(500, 'Không mở được Finder'); });
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- video folders (tabs)
  api.post('/api/customers/:id/folders', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c);
    const raw = String((await readJson(req)).name || ''), name = l.kind === 'gdrive' ? driveName(raw) : safeName(raw);
    if (!name) throw new HttpError(400, 'Hãy đặt tên thư mục');
    if (l.kind === 'gdrive') {
      const taken = new Set((await G.listFolders(l.account, l.id)).map((d) => d.name));
      let unique = name;
      for (let k = 2; taken.has(unique); k++) unique = `${name} (${k})`;
      const f = await G.createFolder(l.account, l.id, unique);
      remember(c.id, [f.id]); invalidate(c.id);
      return json(res, 201, { key: f.id, name: unique });
    }
    fs.mkdirSync(l.dir, { recursive: true });
    const unique = uniqueIn(l.dir, name);
    fs.mkdirSync(path.join(l.dir, unique));
    json(res, 201, { key: unique, name: unique });
  });
  api.put('/api/customers/:id/folders/:fkey', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c), sub = await subLoc(c, l, req.params.fkey);
    const raw = String((await readJson(req)).name || ''), name = sub.kind === 'gdrive' ? driveName(raw) : safeName(raw);
    if (!name) throw new HttpError(400, 'Hãy đặt tên thư mục');
    invalidate(c.id);
    if (sub.kind === 'gdrive') { await G.rename(sub.account, sub.id, name); return json(res, 200, { key: sub.id, name }); }
    if (name === req.params.fkey) return json(res, 200, { key: name, name });
    const next = uniqueIn(path.dirname(sub.dir), name);
    fs.renameSync(sub.dir, path.join(path.dirname(sub.dir), next));
    json(res, 200, { key: next, name: next });
  });
  // Only empty folders: a slip of the mouse should never take a batch of videos with it.
  api.delete('/api/customers/:id/folders/:fkey', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c), sub = await subLoc(c, l, req.params.fkey);
    const busy = 'Thư mục còn video hoặc file khác, hãy chuyển/xoá chúng trước';
    if (sub.kind === 'gdrive') {
      const j = await (await G.gfetch(sub.account, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${sub.id}' in parents and trashed=false`)}&pageSize=1&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`)).json() as any;
      if (j.files?.length) throw new HttpError(409, busy);
      await G.trash(sub.account, sub.id);
      knownIds.get(c.id)?.delete(sub.id); invalidate(c.id);
      return json(res, 200, { ok: true });
    }
    try { fs.rmSync(path.join(sub.dir, '.DS_Store'), { force: true }); fs.rmdirSync(sub.dir); }
    catch (e: any) { throw new HttpError(e.code === 'ENOENT' ? 404 : 409, e.code === 'ENOENT' ? 'Không tìm thấy thư mục' : busy); }
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- videos
  // Google Drive: hand the browser a resumable upload URL so the video goes straight to Google.
  api.post('/api/customers/:id/videos/session', async (req, res) => {
    const c = mustCustomer(req.params.id), l = await subLoc(c, custLoc(c), String(req.query.get('folder') || ''));
    if (l.kind !== 'gdrive') throw new HttpError(400, 'Chỉ dùng cho Google Drive');
    const name = safeName(String(req.query.get('name') || 'video.mp4')), size = Number(req.query.get('size') || 0);
    if (!VIDEO.test(name)) throw new HttpError(400, 'Chỉ nhận file video (.mp4, .mov, .m4v, .webm)');
    if (!size) throw new HttpError(400, 'Thiếu kích thước file');
    const mime = String(req.query.get('mime') || '');
    const origin = String(req.headers.origin || publicOrigin(req));
    invalidate(c.id);
    json(res, 200, { url: await G.uploadSession(l.account, l.id, name, mime.startsWith('video/') ? mime : 'video/mp4', size, origin) });
  });
  // After a direct upload whose answer the browser could not read: did Google get the whole file?
  api.post('/api/customers/:id/videos/session/check', async (req, res) => {
    const c = mustCustomer(req.params.id), b = await readJson(req);
    const done = await G.sessionDone(String(b.url || ''), Number(b.size || 0));
    if (done) invalidate(c.id);
    json(res, 200, { done });
  });
  api.post('/api/customers/:id/videos', async (req, res) => {
    const c = mustCustomer(req.params.id), fkey = String(req.query.get('folder') || ''), l = await subLoc(c, custLoc(c), fkey);
    const raw = safeName(String(req.query.get('name') || 'video.mp4'));
    if (!VIDEO.test(raw)) throw new HttpError(400, 'Chỉ nhận file video (.mp4, .mov, .m4v, .webm)');
    const size = Number(req.headers['content-length'] || 0);
    if (l.kind === 'gdrive') {
      if (!size) throw new HttpError(411, 'Thiếu kích thước file');
      const mime = String(req.headers['content-type'] || 'video/mp4').split(';')[0];
      const f = await G.uploadStream(l.account, l.id, raw, mime.startsWith('video/') ? mime : 'video/mp4', size, req);
      remember(c.id, [f.id]); invalidate(c.id);
      run('UPDATE customers SET updated_at=? WHERE id=?', now(), c.id);
      return json(res, 201, { name: f.name, key: f.id });
    }
    // Local: stream to a temp file first, then move it into the folder in one step,
    // so Drive for desktop never picks up a half-written video.
    const free = await fs.promises.statfs(DATA_DIR).then((s) => s.bavail * s.bsize).catch(() => Infinity);
    if (size && free - size < SPARE) {
      throw new HttpError(507, `Ổ cứng chỉ còn ${Math.round(free / 1e6)} MB, không đủ chỗ cho video ${Math.round(size / 1e6)} MB. Hãy dọn bớt dung lượng máy hoặc chuyển khách hàng sang Google Drive (đăng nhập Google).`);
    }
    fs.mkdirSync(l.dir, { recursive: true });
    const tmpDir = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, uid('up_'));
    try {
      await pipeline(req, fs.createWriteStream(tmp));
      const name = uniqueIn(l.dir, raw);
      try { fs.renameSync(tmp, path.join(l.dir, name)); }
      catch { await fs.promises.copyFile(tmp, path.join(l.dir, name)); fs.unlinkSync(tmp); }
      run('UPDATE customers SET updated_at=? WHERE id=?', now(), c.id);
      json(res, 201, { name, key: (fkey ? fkey + '/' : '') + name });
    } finally { fs.rm(tmp, { force: true }, () => {}); }
  });
  api.get('/api/customers/:id/videos/:key', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c), key = req.params.key;
    if (l.kind === 'gdrive') { await mustOwnVideo(c, l, key); return G.streamFile(l.account, key, req, res); }
    fsVideoKey(key);
    if (!sendFile(req, res, l.dir, key)) throw new HttpError(404, 'Không tìm thấy video');
  });
  api.get('/api/customers/:id/videos/:key/thumb', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c);
    if (l.kind !== 'gdrive') throw new HttpError(404, 'Không có ảnh thu nhỏ');
    await mustOwnVideo(c, l, req.params.key);
    await G.streamThumb(l.account, req.params.key, res);
  });
  // Anyone with the link can view (Drive files are private by default).
  api.post('/api/customers/:id/videos/:key/share', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c);
    if (l.kind !== 'gdrive') throw new HttpError(400, 'Chỉ chia sẻ được video trên Google Drive đã đăng nhập');
    await mustOwnVideo(c, l, req.params.key);
    await G.shareAnyone(l.account, req.params.key); invalidate(c.id);
    json(res, 200, { url: `https://drive.google.com/file/d/${req.params.key}/view?usp=sharing` });
  });
  // Deleting moves the file to Google Drive's trash (recoverable for 30 days); local files are removed.
  api.delete('/api/customers/:id/videos/:key', async (req, res) => {
    const c = mustCustomer(req.params.id), l = custLoc(c), key = req.params.key;
    if (l.kind === 'gdrive') { await mustOwnVideo(c, l, key); await G.trash(l.account, key); knownIds.get(c.id)?.delete(key); invalidate(c.id); return json(res, 200, { ok: true }); }
    try { fs.unlinkSync(path.join(l.dir, ...fsVideoKey(key))); } catch { throw new HttpError(404, 'Không tìm thấy video'); }
    json(res, 200, { ok: true });
  });
}
