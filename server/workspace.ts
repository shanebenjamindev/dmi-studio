import {projectLevels,requireProject} from './project-access';
import {customerLevels,customerLevel,requireCustomer,customerAccessSql,canDeleteCustomer,headedDepartment} from './customer-access';
import {notifyPeople} from './notifications';
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
import { DATA_DIR, CLOUD_STORAGE_ONLY, IS_CLOUDFLARE } from './config';
import * as G from './google';
import { currentUser, finishGoogleSignin, deptLevel, pagesOf, type User } from './auth';

import { readCustomerImport } from '../shared/customer-import';
import { normName } from './taskimport';
import { driveId, locate } from './drive-links';
import {customerStatuses,customerStatus,defaultCustomerStatus} from './customer-statuses';
import { renameProjectBoard, projectHome, projectCustomerChanged } from './taskworkspace';
import { syncProjectCards } from './work-sync';
import { customerServices, oneService, projectServices, saveProjectServices, settleCustomerServices } from './project-services';
import { customerBoardId, syncBoardPeople } from './board-people';

const pexec = promisify(execFile);
/** Company admins and department admins create, rename and delete customers, folders and files. */
const canManage = (u: User | null) => !!u && (u.role === 'admin' || deptLevel(u) === 'admin');
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;
// Not shown: macOS/Windows bookkeeping files and Office lock files.
const HIDDEN = /^(\.|~\$)|^(Icon\r|desktop\.ini|Thumbs\.db)$/i;
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
  if (CLOUD_STORAGE_ONLY) throw new HttpError(400, 'Bản cloud chỉ dùng Google Drive. Hãy kết nối Google và chọn thư mục gốc trong Quản trị.');
  const r = path.resolve(String(p || ''));
  if (!allowed(r)) throw new HttpError(400, 'Chỉ chọn được thư mục trong Google Drive hoặc thư mục workspace trên máy');
  if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) throw new HttpError(404, 'Thư mục không tồn tại');
  return r;
}
interface FsPlace { label: string; account: string | null; kind: 'my' | 'shared' | 'local'; dir: string }
function fsPlaces(): FsPlace[] {
  if (CLOUD_STORAGE_ONLY) return [];
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
export async function rootLoc(): Promise<Loc> {
  const saved = await getSetting<Loc | null>('workspace_root', null);
  if (saved && (saved.kind === 'fs' || (await G.accounts()).some((a) => a.email === saved.account))) return saved;
  const legacy = await getSetting<string>('workspace_dir', '') || process.env.DRIVE_DIR || '';
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
/** A customer's details; `drive`: the folder it is linked to (null: in the database only). Its code (from an import) is kept, not shown. */
const customerRecord = (c: any) => {
  const g = c.gloc ? JSON.parse(c.gloc) : null;
  return { id:c.id, name:c.name, contact:c.contact || '', phone:c.phone || '', email:c.email || '', notes:c.notes || '',createdBy:c.created_by||null,createdAt:c.created_at??null,updatedAt:c.updated_at??null,
    drive: g ? { label: String(g.label || c.folder || ''), url: `https://drive.google.com/drive/folders/${g.id}` } : c.folder ? { label: path.basename(String(c.folder)), url: null } : null };
};
/** A customer's services are those of its projects (server/project-services.ts). */
const needsOf = customerServices;
/** Each customer's tags (Quản trị › Khách hàng › Phân loại is the list of tags), in the order of that list. */
async function tagsOf(ids?: string[]) {
  const out = new Map<string, { id: string; name: string; color: string }[]>();
  for (const r of await all<any>(`SELECT t.customer_id, c.id, c.name, c.color FROM customer_tags t JOIN customer_categories c ON c.id = t.tag_id${ids ? ' WHERE t.customer_id IN (SELECT value FROM json_each(?))' : ''} ORDER BY c.pos, c.name`, ...(ids ? [JSON.stringify(ids)] : [])))
    out.set(r.customer_id, [...(out.get(r.customer_id) || []), { id: r.id, name: r.name, color: r.color }]);
  return out;
}
const TAG_COLORS = ['#0b7df2', '#16a34a', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b'];
/** Tags given as ids of the list or as new names (a name already in the list, any case, is that tag; a new one joins
 *  the list). At most 20, names up to 40 characters. */
async function tagIds(v: unknown) {
  if (!Array.isArray(v) || v.length > 20) throw new HttpError(400, 'Tối đa 20 tag cho một khách hàng');
  const ids: string[] = [];
  for (const x of v) {
    const id = x && typeof x === 'object' ? String((x as any).id || '') : '', name = x && typeof x === 'object' ? String((x as any).name || '').trim().replace(/\s+/g, ' ') : '';
    if (id) { if (!(await get('SELECT 1 FROM customer_categories WHERE id = ?', id))) throw new HttpError(400, 'Không tìm thấy tag'); ids.push(id); continue; }
    if (!name || name.length > 40) throw new HttpError(400, 'Tên tag cần từ 1 đến 40 ký tự');
    let tag = await get<any>('SELECT id FROM customer_categories WHERE name = ? COLLATE NOCASE', name);
    if (!tag) {
      const pos = Number((await get<any>('SELECT MAX(pos) m FROM customer_categories'))?.m || 0) + 1;
      tag = { id: uid('cus_') };
      await run('INSERT INTO customer_categories(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)', tag.id, name, TAG_COLORS[pos % TAG_COLORS.length], pos, now(), now());
    }
    ids.push(tag.id);
  }
  return [...new Set(ids)];
}
/** The tags a create or save asks for: `tags`, or the one category older pages send; null when neither is given. */
const tagsIn = async (b: any, category: string | null) => (b.tags !== undefined ? tagIds(b.tags) : b.categoryId !== undefined ? (category ? [category] : []) : null);
/** Puts these tags on the customer; its first one is also its category, for the views that group by one. */
async function saveTags(customerId: string, ids: string[]) {
  await run('DELETE FROM customer_tags WHERE customer_id = ? AND tag_id NOT IN (SELECT value FROM json_each(?))', customerId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO customer_tags(customer_id, tag_id, created_at) VALUES(?,?,?)', customerId, id, now());
  await run('UPDATE customers SET category_id = ? WHERE id = ?', ids[0] || null, customerId);
}
async function customerClassification(b: any, old?: any) {
  const status=!old&&b.status===undefined?await defaultCustomerStatus():await customerStatus(b.status,old?.status||null);
  const category=b.categoryId===undefined?old?.category_id||null:b.categoryId||null;
  if(category!==null&&(typeof category!=='string'||!await get('SELECT 1 FROM customer_categories WHERE id=? AND (active=1 OR id=?)',category,old?.category_id||null)))throw new HttpError(400,'Phân loại không hợp lệ');
  const source=b.sourceId===undefined?old?.source_id||null:b.sourceId||null;
  if(source!==null&&(typeof source!=='string'||!await get('SELECT 1 FROM customer_sources WHERE id=? AND (active=1 OR id=?)',source,old?.source_id||null)))throw new HttpError(400,'Nguồn khách hàng không hợp lệ');
  const manager=b.managerId===undefined?old?.manager_id||null:b.managerId||null;
  if(manager!==null&&(typeof manager!=='string'||!await get('SELECT 1 FROM users WHERE id=? AND (disabled=0 OR id=?)',manager,old?.manager_id||null)))throw new HttpError(400,'Người phụ trách không hợp lệ');
  return {status,category,source,manager};
}
function customerFields(b: any, old?: any) {
  const field = (key: string, max: number) => { const value=String(b[key] ?? old?.[key] ?? '').trim(); if(value.length>max)throw new HttpError(400,`Trường ${key} tối đa ${max} ký tự`);return value; };
  const name=field('name',200), contact=field('contact',200), phone=field('phone',60), email=field('email',320), notes=field('notes',20000);
  if(!name)throw new HttpError(400,'Hãy nhập tên khách hàng');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Email không hợp lệ');
  return {name,contact,phone,email,notes};
}
const mustCustomer = async (id: string) => {
  const c = await get<any>('SELECT * FROM customers WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Không tìm thấy khách hàng');
  return c;
};
/** gloc set → Google Drive folder; otherwise `folder` is a local path (relative to a local root, or absolute). */
async function custLoc(c: any): Promise<Loc> {
  if (!c.gloc && !c.folder) throw new HttpError(400, 'Khách hàng chưa liên kết thư mục. Hãy chọn Liên kết thư mục trước.');
  if (c.gloc) return { kind: 'gdrive', ...JSON.parse(c.gloc) };
  if (CLOUD_STORAGE_ONLY) throw new HttpError(400, 'Khách hàng này dùng thư mục trên máy cũ. Hãy liên kết lại với Google Drive.');
  if (path.isAbsolute(c.folder)) return { kind: 'fs', dir: c.folder };
  const r = await rootLoc();
  return { kind: 'fs', dir: path.join(r.kind === 'fs' ? r.dir : LOCAL_WS(), c.folder) };
}

// A customer's folder holds folders (shown as tabs); files lying directly in it show under "Chung". Every kind of
// file is listed, like on Drive; folders inside a tab open in place.
const knownIds = new Map<string, Set<string>>(); // customer → Drive file/folder ids seen under its folder
function remember(cid: string, ids: string[]) {
  if (!knownIds.has(cid)) knownIds.set(cid, new Set());
  for (const id of ids) knownIds.get(cid)!.add(id);
}
type GLoc = Extract<Loc, { kind: 'gdrive' }>;
/** A Drive file (or folder) somewhere inside the customer folder: its parents are walked up, at most 10 levels. */
async function mustOwn(c: any, l: GLoc, key: string, what: 'file' | 'folder') {
  if (knownIds.get(c.id)?.has(key)) return;
  const missing = new HttpError(404, what === 'folder' ? 'Không tìm thấy thư mục' : 'Không tìm thấy file');
  const f = await G.meta(l.account, key, 'id,parents,mimeType').catch(() => null);
  if (!f || (f.mimeType === G.FOLDER_MIME) !== (what === 'folder')) throw missing;
  let parent = f.parents?.[0];
  for (let k = 0; parent && k < 10; k++) {
    if (parent === l.id || knownIds.get(c.id)?.has(parent)) { remember(c.id, [key]); return; }
    parent = (await G.meta(l.account, parent, 'id,parents').catch(() => null))?.parents?.[0];
  }
  throw missing;
}
const validSub = (n: string) => !!n && !/[\/\\]/.test(n) && !n.startsWith('.');
/** Local keys are paths inside the customer folder: "name", "folder/name", "folder/sub/name"… */
function fsKey(key: string) {
  const parts = key.split('/');
  if (parts.length > 10 || !parts.every(validSub)) throw new HttpError(404, 'Không tìm thấy file');
  return parts;
}
/** A file of a customer's folder, checked to be in it (for a card's videos): its name and where it opens. */
export async function customerFile(customerId: string, key: string) {
  const c = await mustCustomer(customerId), l = await custLoc(c);
  if (l.kind === 'gdrive') {
    await mustOwn(c, l, key, 'file');
    const f = await G.meta(l.account, key, 'id,name,mimeType');
    return { customer: c, name: f.name as string, url: driveLink(key, f.mimeType) };
  }
  const p = path.join(l.dir, ...fsKey(key));
  if (!fs.existsSync(p)) throw new HttpError(404, 'Không tìm thấy file');
  return { customer: c, name: path.basename(p), url: fileUrl(c.id, key) };
}
/** Folder `fkey` ('' = the customer folder itself): a Drive folder id inside the customer folder, or a path on disk. */
async function subLoc(c: any, l: Loc, fkey: string): Promise<Loc> {
  if (!fkey) return l;
  if (l.kind === 'gdrive') { await mustOwn(c, l, fkey, 'folder'); return { kind: 'gdrive', account: l.account, id: fkey }; }
  return { kind: 'fs', dir: path.join(l.dir, ...fsKey(fkey)) };
}

/** What a file is (Drive's own types or the extension), for its icon, the type filter and how it opens. */
export type FileKind = 'folder' | 'video' | 'image' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'archive' | 'other';
const GAPPS = 'application/vnd.google-apps.';
const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', rtf: 'application/rtf', doc: 'application/msword', pages: 'application/vnd.apple.pages',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', numbers: 'application/vnd.apple.numbers',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', key: 'application/vnd.apple.keynote',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip',
  // Drive for desktop shows Google Docs, Sheets and Slides as small link files.
  gdoc: GAPPS + 'document', gsheet: GAPPS + 'spreadsheet', gslides: GAPPS + 'presentation',
};
const mimeOfName = (name: string) => EXT_MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
function kindOf(mime: string): FileKind {
  if (mime === G.FOLDER_MIME) return 'folder';
  const top = mime.split('/')[0];
  if (top === 'video' || top === 'image' || top === 'audio') return top;
  if (mime === 'application/pdf') return 'pdf';
  if (/spreadsheet|ms-excel|numbers|csv/.test(mime)) return 'sheet';
  if (/presentation|powerpoint|keynote/.test(mime)) return 'slides';
  if (/wordprocessing|msword|google-apps\.document|apple\.pages|rtf|opendocument\.text|^text\//.test(mime)) return 'doc';
  if (/zip|rar|7z|tar|gzip|compressed/.test(mime)) return 'archive';
  return 'other';
}
/** Where a Drive item opens: folders and Google Docs/Sheets/Slides in their own pages, other files in Drive's preview. */
function driveLink(id: string, mime: string) {
  if (mime === G.FOLDER_MIME) return `https://drive.google.com/drive/folders/${id}`;
  const app = ({ document: 'document', spreadsheet: 'spreadsheets', presentation: 'presentation' } as Record<string, string>)[mime.startsWith(GAPPS) ? mime.slice(GAPPS.length) : ''];
  return app ? `https://docs.google.com/${app}/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`;
}
export interface FileItem {
  key: string; name: string; kind: FileKind; mime: string; bytes: number; modifiedAt: number;
  url: string | null; thumb: string | null; driveId: string | null; driveUrl: string | null; shared: boolean; shortcut?: boolean;
}
const SHOWN_IMAGE = /^image\/(jpeg|png|gif|webp|svg\+xml|avif|bmp)$/;
/** Folders first (by name), then files, newest first. */
const order = (a: FileItem, b: FileItem) => (+(b.kind === 'folder') - +(a.kind === 'folder')) || (a.kind === 'folder' ? a.name.localeCompare(b.name, 'vi') : b.modifiedAt - a.modifiedAt);
const fileUrl = (cid: string, key: string) => `/api/customers/${cid}/files/${encodeURIComponent(key)}`;
function gItem(c: any, f: G.GFile): FileItem {
  // A shortcut points outside the customer folder: it opens on Drive, not here.
  const target = f.shortcutDetails, mime = target?.targetMimeType || f.mimeType, id = target?.targetId || f.id, kind = kindOf(mime);
  const at = Date.parse(f.modifiedTime || '') || 0, here = !target && kind !== 'folder' && !mime.startsWith(GAPPS);
  return {
    key: f.id, name: f.name, kind, mime, bytes: Number(f.size || 0), modifiedAt: at,
    url: here ? fileUrl(c.id, f.id) : null, thumb: !target && f.thumbnailLink ? `${fileUrl(c.id, f.id)}/thumb?v=${at}` : null,
    driveId: id, driveUrl: (!target && f.webViewLink) || driveLink(id, mime), shared: !!f.shared, ...(target ? { shortcut: true } : {}),
  };
}
async function fsItems(c: any, dir: string, prefix: string, withFolders: boolean): Promise<FileItem[]> {
  let ents: fs.Dirent[];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const desktop = onDesktopDrive(dir);
  const out = await Promise.all(ents.filter((d) => !HIDDEN.test(d.name) && (d.isFile() || (withFolders && d.isDirectory()))).map(async (d): Promise<FileItem | null> => {
    const p = path.join(dir, d.name), key = prefix + d.name;
    let st: fs.Stats;
    try { st = fs.statSync(p); } catch { return null; }
    const folder = st.isDirectory(), mime = folder ? G.FOLDER_MIME : mimeOfName(d.name), native = mime.startsWith(GAPPS);
    const id = desktop ? await desktopDriveId(p, st.mtimeMs) : null;
    const url = folder || native ? null : fileUrl(c.id, key);
    return {
      key, name: native ? d.name.replace(/\.g(doc|sheet|slides)$/i, '') : d.name, kind: kindOf(mime), mime, bytes: folder || native ? 0 : st.size, modifiedAt: st.mtimeMs,
      url, thumb: url && SHOWN_IMAGE.test(mime) ? url : null, driveId: id, driveUrl: id ? driveLink(id, mime) : null, shared: false,
    };
  }));
  return (out.filter(Boolean) as FileItem[]).sort(order);
}
const fsSubdirs = (dir: string) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && validSub(d.name)).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'vi')); }
  catch { return []; }
};
// Drive listings are reused for 30 s (sidebar counts and the open customer share them); any change made here drops them.
const libCache = new Map<string, { at: number; data: Promise<Awaited<ReturnType<typeof readLibrary>>> }>();
const invalidate = (cid: string) => libCache.delete(cid);
async function library(c: any, l: Loc, fresh = false) {
  if (l.kind !== 'gdrive') return await readLibrary(c, l);
  const hit = libCache.get(c.id);
  if (!fresh && hit && Date.now() - hit.at < 30e3) return hit.data;
  const data = readLibrary(c, l);
  libCache.set(c.id, { at: Date.now(), data });
  data.catch(() => libCache.delete(c.id));
  return data;
}
/** Loose files in the customer folder + every folder (tab) with what is inside it: its files and its own folders. */
async function readLibrary(c: any, l: Loc) {
  if (l.kind === 'gdrive') {
    const dirs = await G.listFolders(l.account, l.id);
    const items = await G.listChildrenIn(l.account, [l.id, ...dirs.map((d) => d.id)]);
    remember(c.id, [...dirs.map((d) => d.id), ...items.map((f) => f.id)]);
    for (const f of items) G.rememberThumb(f.id, f.thumbnailLink);
    const of = (id: string, withFolders: boolean) => items.filter((f) => f.parents?.includes(id) && (withFolders || f.mimeType !== G.FOLDER_MIME)).map((f) => gItem(c, f)).sort(order);
    return { files: of(l.id, false), folders: dirs.map((d) => ({ key: d.id, name: d.name, driveUrl: driveLink(d.id, G.FOLDER_MIME), files: of(d.id, true) })) };
  }
  const desktop = onDesktopDrive(l.dir);
  return {
    files: await fsItems(c, l.dir, '', false),
    folders: await Promise.all(fsSubdirs(l.dir).map(async (name) => {
      const dir = path.join(l.dir, name);
      let id: string | null = null;
      if (desktop) { try { id = await desktopDriveId(dir, fs.statSync(dir).mtimeMs); } catch { /* gone */ } }
      return { key: name, name, driveUrl: id ? driveLink(id, G.FOLDER_MIME) : null, files: await fsItems(c, dir, name + '/', true) };
    })),
  };
}
type Counts = { videos: number | null; files: number | null; folders: number | null };
async function counts(c: any, l: Loc, fresh = false): Promise<Counts> {
  if (l.kind === 'gdrive') {
    return library(c, l, fresh).then((x) => {
      const files = [...x.files, ...x.folders.flatMap((f) => f.files)].filter((f) => f.kind !== 'folder');
      return { videos: files.filter((f) => f.kind === 'video').length, files: files.length, folders: x.folders.length };
    }).catch(() => ({ videos: null, files: null, folders: null }));
  }
  const n = (dir: string) => {
    try { const f = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && !HIDDEN.test(d.name)); return [f.length, f.filter((d) => VIDEO.test(d.name)).length]; }
    catch { return [0, 0]; }
  };
  const subs = fsSubdirs(l.dir), all = [l.dir, ...subs.map((d) => path.join(l.dir, d))].map(n);
  return { files: all.reduce((k, x) => k + x[0], 0), videos: all.reduce((k, x) => k + x[1], 0), folders: subs.length };
}

// ---------------------------------------------------------------- root folder ↔ customer list
// Every folder inside the workspace root is a customer: folders made on Drive directly show up on their own.
// Hiding a customer remembers its folder so it does not come back on the next sync.
const folderKey = (l: Loc) => (l.kind === 'gdrive' ? `g:${l.id}` : `f:${path.resolve(l.dir)}`);
const hidden = async () => new Set(await getSetting<string[]>('hidden_folders', []));
async function setHidden(key: string, on: boolean) {
  const h = await hidden();
  if (on) h.add(key); else h.delete(key);
  await setSetting('hidden_folders', h.size ? [...h] : null);
}
const syncing = new Map<string, Promise<Set<string>>>();
async function syncFolder(r: Loc, label: string) {
  if (IS_CLOUDFLARE) return doSync(r, label);
  const k = folderKey(r);
  if (!syncing.has(k)) syncing.set(k, doSync(r, label).finally(() => syncing.delete(k)));
  return syncing.get(k)!;
}
/** Imports new sub-folders of the viewed folder as customers and returns the keys of every folder directly inside it. */
async function doSync(r: Loc, label: string) {
  if (CLOUD_STORAGE_ONLY && r.kind === 'fs') return new Set<string>();
  const skip = await hidden();
  for (const c of await all<any>('SELECT * FROM customers')) {
    if ((!c.folder && !c.gloc) || (CLOUD_STORAGE_ONLY && !c.gloc)) continue;
    skip.add(folderKey(await custLoc(c)));
  }
  const found: { name: string; folder: string; gloc: string | null; key: string }[] = [];
  if (r.kind === 'gdrive') {
    const known = new Map((await all<any>('SELECT * FROM customers WHERE gloc IS NOT NULL')).map((c) => [JSON.parse(c.gloc).id, c]));
    for (const d of await G.listFolders(r.account, r.id)) {
      found.push({ name: d.name, folder: d.name, key: `g:${d.id}`, gloc: JSON.stringify({ account: r.account, id: d.id, label: `${label} › ${d.name}`, owned: true }) });

    }
  } else {
    for (const name of fsSubdirs(r.dir)) found.push({ name, folder: path.join(r.dir, name), gloc: null, key: folderKey({ kind: 'fs', dir: path.join(r.dir, name) }) });
  }
  return new Set(found.map((f) => f.key));
}
/** Only direct child folders of CLIENTS are customer choices; browsing other folders must not pollute this list. */
export async function clientCustomers(){return all<any>('SELECT * FROM customers ORDER BY name COLLATE NOCASE');}
// ---------------------------------------------------------------- per-user view
// Everyone browses on their own (the `at` query, kept by the browser); the root is shared and set by admins.
// Members only see the root and what is inside it.
const crumbCache = new Map<string, { name: string; loc: Loc }[]>();
async function crumbsOf(l: Loc): Promise<{ name: string; loc: Loc }[]> {
  if (l.kind === 'fs') return fsCrumbs(l.dir).crumbs;
  const k = `${l.account}|${l.id}`;
  if (!crumbCache.has(k)) {
    const chain = await G.crumbs(l.account, l.id).catch(() => { throw new HttpError(404, 'Không mở được thư mục này trên Drive'); });
    crumbCache.set(k, chain.map((c) => ({ name: c.name, loc: { kind: 'gdrive', account: l.account, id: c.id } as Loc })));
  }
  return crumbCache.get(k)!;
}
const sameLoc = (a: Loc, b: Loc) => (a.kind === 'fs' && b.kind === 'fs' ? path.resolve(a.dir) === path.resolve(b.dir) : a.kind === 'gdrive' && b.kind === 'gdrive' && a.account === b.account && a.id === b.id);
async function viewOf(req: Req) {
  const root = await rootLoc(), raw = req.query.get('at');
  let l: Loc = root;
  if (raw) {
    let x: any; try { x = JSON.parse(raw); } catch { throw new HttpError(400, 'Thư mục không hợp lệ'); }
    l = x?.kind === 'gdrive' ? { kind: 'gdrive', account: String(x.account || ''), id: String(x.id || '') } : { kind: 'fs', dir: mustDir(x?.dir) };
    if (l.kind === 'gdrive' && !(await G.accounts()).some((a) => a.email === (l as any).account)) throw new HttpError(404, 'Tài khoản Google này chưa được kết nối');
  }
  let crumbs = await crumbsOf(l);
  if ((await currentUser(req))?.role !== 'admin') {
    if (l.kind === 'fs' && root.kind === 'fs') {
      const rel = path.relative(path.resolve(root.dir), path.resolve(l.dir));
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(403, 'Bạn chỉ xem được các thư mục bên trong thư mục gốc');
      let cur = root.dir;
      crumbs = [{ name: path.basename(root.dir), loc: root }, ...rel.split(path.sep).filter(Boolean).map((part) => ({ name: part, loc: { kind: 'fs', dir: (cur = path.join(cur, part)) } as Loc }))];
    } else {
      // "My Drive" picked as root is stored as the alias 'root'; the chain carries its real id.
      const i = crumbs.findIndex((c, k) => sameLoc(c.loc, root) || (root.kind === 'gdrive' && root.id === 'root' && k === 0 && c.loc.kind === 'gdrive' && c.loc.account === root.account));
      if (i < 0) throw new HttpError(403, 'Bạn chỉ xem được các thư mục bên trong thư mục gốc');
      crumbs = crumbs.slice(i);
    }
  }
  return { loc: l, crumbs, label: (await crumbsOf(l)).map((c) => c.name).join(' › '), isRoot: sameLoc(l, root) };
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
  if (!c.folder && !c.gloc) return { id:c.id, name:c.name, links:linksOf(c), notes:c.notes || '', storage:'local', account:null, folderLoc:null, folderLabel:'Chưa liên kết thư mục', folderPath:'', files:[], folders:[], projects:[], videoCount:0, fileCount:0, folderCount:0, projectCount:0, createdAt:c.created_at, updatedAt:c.updated_at, driveFolderUrl:null };

  const l = await custLoc(c);
  const out: any = {
    id: c.id, name: c.name, links: linksOf(c), notes: c.notes || '',
    storage: storageOf(l), account: locAccount(l), folderLabel: locLabel(l), folderLoc: l, folderPath: l.kind === 'fs' ? l.dir : '',
    createdAt: c.created_at, updatedAt: c.updated_at,
  };
  if (full) {
    try { Object.assign(out, await library(c, l, fresh)); } catch (e: any) { Object.assign(out, { files: [], folders: [], error: e.message }); }
    if (l.kind === 'gdrive') out.driveFolderUrl = `https://drive.google.com/drive/folders/${l.id}`;
    else {
      let st: fs.Stats | null = null;
      try { st = fs.statSync(l.dir); } catch { /* not created yet */ }
      const fid = st && onDesktopDrive(l.dir) ? await desktopDriveId(l.dir, st.mtimeMs) : null;
      out.driveFolderUrl = fid ? `https://drive.google.com/drive/folders/${fid}` : null;
    }
  } else {
    const n = await counts(c, l, fresh);
    out.videoCount = n.videos; out.fileCount = n.files; out.folderCount = n.folders;
  }
  return out;
}

// ---------------------------------------------------------------- projects ↔ customers
// A project belongs to one customer (projects.customer_id): the customer page lists it and the work overview counts it.
const redirectUri = (req: Req) => `${publicOrigin(req)}/api/google/callback`;
const redirect = (res: Res, to: string) => { res.writeHead(302, { location: to }); res.end(); };

export function registerWorkspace(api: Router) {
  // ---------------------------------------------------------------- Google sign-in
  api.get('/api/google/status', async (req, res) => {
    const c = await G.oauthConfig();
    json(res, 200, { configured: !!(c.clientId && c.clientSecret), clientId: c.clientId, redirectUri: redirectUri(req), accounts: await G.publicAccounts() });
  });
  api.put('/api/google/config', async (req, res) => {
    const b = await readJson(req);
    await G.setOauthConfig(String(b.clientId || ''), String(b.clientSecret || ''));
    json(res, 200, { ok: true });
  });
  api.get('/api/google/login', async (req, res) => redirect(res, await G.authUrl(redirectUri(req))));
  // Shared by both Google flows: connecting a Drive account, and signing in to DMI Workspace.
  api.get('/api/google/callback', async (req, res) => {
    const err = req.query.get('error'), state = req.query.get('state') || '';
    const purpose=await G.purposeOf(state);
    const signin=purpose==='signin';
    try {
      if (err) throw new Error(err === 'access_denied' ? 'Bạn đã huỷ đăng nhập' : err);
      const a = await G.finishLogin(req.query.get('code') || '', state);
      if (a.purpose === 'signin') { await finishGoogleSignin(req, res, a.email); return redirect(res, '/'); }
      if(a.purpose==='mail')return redirect(res,`/#admin?mail=${encodeURIComponent(a.email)}`);
      if (!await currentUser(req)) throw new Error('Hãy đăng nhập DMI Workspace trước');
      redirect(res, `/#admin?google=${encodeURIComponent(a.email)}`);
    } catch (e: any) {
      redirect(res, signin ? `/?auth_error=${encodeURIComponent(e.message)}` : purpose==='mail'?`/#admin?mail_error=${encodeURIComponent(e.message)}`:`/#admin?google_error=${encodeURIComponent(e.message)}`);
    }
  });
  api.delete('/api/google/accounts/:email', async (req, res) => { await G.removeAccount(req.params.email); json(res, 200, { accounts: await G.publicAccounts() }); });

  // ---------------------------------------------------------------- workspace root & folder browsing
  const wsOut = async (req: Req) => {
    const l = await rootLoc(), v = await viewOf(req);
    return { loc: l, storage: storageOf(l), label: locLabel(l), account: locAccount(l), drive: storageOf(l) !== 'local', mounts: driveMounts(), view: v.loc, viewIsRoot: v.isRoot, crumbs: v.crumbs };
  };
  api.get('/api/workspace', async (req, res) => json(res, 200, await wsOut(req)));
  // Change the root. Existing customers keep their current folders; new customers go to the new root.
  api.put('/api/workspace', async (req, res) => {
    const l = await mustLoc((await readJson(req)).loc);
    const old = await rootLoc();
    if (old.kind === 'fs') {
      for (const c of await all<any>('SELECT id, folder, gloc FROM customers')) {
        if (!c.gloc && !path.isAbsolute(c.folder)) await run('UPDATE customers SET folder=? WHERE id=?', path.join(old.dir, c.folder), c.id);
      }
    }
    await setSetting('workspace_root', l);
    req.query.delete('at');
    json(res, 200, await wsOut(req));
  });
  api.get('/api/workspace/places', async (_q, res) => {
    const out: { label: string; account: string | null; kind: string; via: string; loc: Loc }[] = [];
    for (const a of await G.accounts()) {
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
    // Only the folders inside the folder being viewed; customers elsewhere stay saved for when that folder is opened again.
    const v = await viewOf(req);
    const inside = await syncFolder(v.loc, v.label);
    const user=(await currentUser(req))!;
    const candidates=await all<any>(`SELECT * FROM customers c WHERE ${customerAccessSql()} ORDER BY name COLLATE NOCASE`,user.id,user.id,user.id);
    const rows: any[] = [];
    // Local folders from an imported database cannot be browsed on the cloud server.
    for (const c of candidates) {
      if ((!c.folder && !c.gloc) || (CLOUD_STORAGE_ONLY && !c.gloc)) continue;
      if (inside.has(folderKey(await custLoc(c)))) rows.push(c);
    }
    json(res, 200, await Promise.all(rows.map((c) => customerOut(c, false, fresh))));
  });
  api.post('/api/customers', async (req, res) => {
    const b = await readJson(req);
    const creator=(await currentUser(req))!.id;
    // Making or linking its Drive folder needs Drive (adding one without a folder may also come from Phân quyền).
    if(b.databaseOnly!==true&&!(await pagesOf((await currentUser(req))!)).includes('workspace'))throw new HttpError(403,'Tạo thư mục Drive cho khách hàng cần quyền trang Drive');
    const fields=customerFields(b), classification=await customerClassification(b);
    const managerId = b.managerId === undefined ? creator : classification.manager;
    const tags = await tagsIn(b, classification.category);
    if (b.databaseOnly === true) {
      const id=uid('c_');
      await run('INSERT INTO customers(id,name,contact,phone,email,notes,links,folder,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,fields.name,fields.contact,fields.phone,fields.email,fields.notes,'[]','',now(),now());
      await run('UPDATE customers SET created_by=?,status=?,category_id=?,source_id=?,manager_id=? WHERE id=?',creator,classification.status,classification.category,classification.source,managerId,id);
      if(managerId&&managerId!==creator)await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',id,managerId,'admin',creator,now());
      if(tags)await saveTags(id,tags);
      json(res,201,await customerOut(await mustCustomer(id),true));return;
    }
    const name = safeName(fields.name);
    if (!name) throw new HttpError(400, 'Hãy nhập tên khách hàng');
    if (b.existingFolder) {
      const l = await mustLoc(b.existingFolder);
      const id = uid('c_');
      const gloc = l.kind === 'gdrive' ? JSON.stringify({ account: l.account, id: l.id, label: l.label }) : null;
      await run('INSERT INTO customers(id,name,links,notes,folder,gloc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', id, name, '[]', String(b.notes || ''), l.kind === 'gdrive' ? name : l.dir, gloc, now(), now());
      await setHidden(folderKey(l), false);
      await run('UPDATE customers SET created_by=?,status=?,category_id=?,source_id=?,manager_id=? WHERE id=?',creator,classification.status,classification.category,classification.source,managerId,id);
      if(managerId&&managerId!==creator)await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',id,managerId,'admin',creator,now());
    if(tags)await saveTags(id,tags);
    json(res, 201, await customerOut(await mustCustomer(id), true)); return;
    }
    // Created inside the folder the admin is looking at.
    const view = await viewOf(req), root = view.loc;
    if (CLOUD_STORAGE_ONLY && root.kind === 'fs') throw new HttpError(400, 'Hãy kết nối Google Drive và chọn thư mục gốc trong Quản trị trước khi tạo khách hàng.');
    let folder = name, gloc: string | null = null;
    if (root.kind === 'gdrive') {
      let unique = name;
      for (let k = 2; await G.findChildFolder(root.account, root.id, unique); k++) unique = `${name} (${k})`;
      const f = await G.createFolder(root.account, root.id, unique);
      folder = unique;
      gloc = JSON.stringify({ account: root.account, id: f.id, label: `${view.label} › ${unique}`, owned: true });
    } else {
      fs.mkdirSync(root.dir, { recursive: true });
      folder = path.join(root.dir, uniqueIn(root.dir, name));
      fs.mkdirSync(folder, { recursive: true });
    }
    const id = uid('c_');
    await run('INSERT INTO customers(id, name, links, notes, folder, gloc, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
      id, String(b.name).trim(), JSON.stringify(b.links ? cleanLinks(b.links) : []), b.notes || '', folder, gloc, now(), now());
    await run('UPDATE customers SET created_by=?,status=?,category_id=?,source_id=?,manager_id=? WHERE id=?',creator,classification.status,classification.category,classification.source,managerId,id);
    if(managerId&&managerId!==creator)await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',id,managerId,'admin',creator,now());
    if(tags)await saveTags(id,tags);
    json(res, 201, await customerOut(await mustCustomer(id), true));
  });
  // Picker is scoped to CLIENTS, independently of the folder currently being browsed.
  api.get('/api/customers/all',async(req,res)=>{const user=(await currentUser(req))!;json(res,200,await all(`SELECT c.id,c.name,c.name label FROM customers c WHERE c.archived_at IS NULL AND ${customerAccessSql()} ORDER BY c.name COLLATE NOCASE`,user.id,user.id,user.id));});
  // CRM directory is independent of the folder currently being browsed. Customers archived in Quản trị are left out.
  api.get('/api/customers/directory', async (req, res) => {
    const user=(await currentUser(req))!,levels=await customerLevels(user.id),dept=await headedDepartment(user.id),needs=await needsOf(),tags=await tagsOf();
    const adminMembers=new Map<string,{id:string;name:string}>();
    for(const r of await all<any>("SELECT cm.customer_id,u.id,u.name FROM customer_members cm JOIN users u ON u.id=cm.user_id WHERE cm.role='admin' AND u.disabled=0 ORDER BY cm.created_at ASC")){
      if(!adminMembers.has(r.customer_id))adminMembers.set(r.customer_id,{id:r.id,name:r.name});
    }
    json(res,200,(await all<any>(`SELECT c.*, (SELECT team_role FROM users WHERE id=COALESCE(c.created_by,c.manager_id)) owner_team, (SELECT COUNT(*) FROM task_projects p WHERE p.customer_id=c.id) projects,
      cat.name category_name, cat.color category_color, src.name source_name, src.color source_color, ow.name owner_name, mg.name manager_name,
      (SELECT COUNT(*) FROM task_campaigns a JOIN task_projects p ON p.id=a.project_id WHERE p.customer_id=c.id) campaigns,
      (SELECT COUNT(*) FROM tasks t JOIN task_projects p ON p.id=t.project_id WHERE p.customer_id=c.id AND t.stub=0) tasks,
      (SELECT COUNT(*) FROM tasks t JOIN task_projects p ON p.id=t.project_id WHERE p.customer_id=c.id AND t.stub=0 AND t.done_at IS NOT NULL) completed
      FROM customers c LEFT JOIN customer_categories cat ON cat.id=c.category_id LEFT JOIN customer_sources src ON src.id=c.source_id LEFT JOIN users ow ON ow.id=c.created_by LEFT JOIN users mg ON mg.id=c.manager_id
      WHERE c.archived_at IS NULL ORDER BY c.name COLLATE NOCASE`)).filter(c=>levels.has(c.id)).map(c=>{
      const fallbackAdmin=adminMembers.get(c.id)||null;
      const owner=c.created_by&&c.owner_name?{id:c.created_by,name:c.owner_name}:fallbackAdmin;
      const manager=c.manager_id&&c.manager_name?{id:c.manager_id,name:c.manager_name}:owner;
      return {...customerRecord(c),needs:needs.get(c.id)||[],tags:tags.get(c.id)||[],
      status:c.status||null,category:c.category_id?{id:c.category_id,name:c.category_name||'',color:c.category_color||'#64748b'}:null,source:c.source_id?{id:c.source_id,name:c.source_name||'',color:c.source_color||'#64748b'}:null,
      owner,manager,level:levels.get(c.id),canManage:levels.get(c.id)==='admin',canDelete:user.role==='admin'||(c.created_by?c.created_by===user.id||!!dept&&c.owner_team===dept:levels.get(c.id)==='admin'),projects:c.projects,campaigns:c.campaigns,tasks:c.tasks,completed:c.completed,hasDrive:!!c.gloc};
    }));
  });
  api.post('/api/customers/import', async (req,res) => {
    if (!canManage(await currentUser(req))) throw new HttpError(403,'Chỉ quản trị viên được nhập khách hàng');
    const b=await readJson(req);
    let parsed: ReturnType<typeof readCustomerImport>;
    try { parsed=readCustomerImport(String(b.text || '')); } catch(e:any) { throw new HttpError(400,e.message); }
    const owner=(await currentUser(req))!.id;
    const existing=new Map((await all<any>(`SELECT c.id,c.name FROM customers c WHERE ${customerAccessSql()}`,owner,owner,owner)).map(c=>[normName(c.name),c.id]));
    let created=0,kept=0,projectLinks=0;
    for(const row of parsed.customers){
      const key=normName(row.name); let id=existing.get(key);
      if(id)kept++;
      else {
        id=uid('c_');const notes=[row.alias && `Tên khác / dịch vụ: ${row.alias}`,row.notes].filter(Boolean).join('\n');
        await run('INSERT INTO customers(id,name,email,phone,notes,links,folder,code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,row.name,row.email,row.phone,notes,'[]','',row.externalId||null,now(),now());
        await run('UPDATE customers SET created_by=?,manager_id=COALESCE(manager_id,?),status=? WHERE id=?',owner,owner,await defaultCustomerStatus(),id);
        existing.set(key,id);created++;
      }
      if(b.linkProjects===true){
        const names=new Set([row.name,...row.alias.split(/[;\n]/)].map(n=>normName(n).replace(/^[\[\s]*master[\]\s|:-]*/,'')).filter(Boolean));
        for(const p of await all<any>('SELECT id,name FROM task_projects WHERE customer_id IS NULL')) if(names.has(normName(p.name).replace(/^[\[\s]*master[\]\s|:-]*/,''))) {
          projectLinks+=(await run('UPDATE task_projects SET customer_id=? WHERE id=? AND customer_id IS NULL',id,p.id)).changes;
        }
      }
    }
    json(res,200,{created,kept,projectLinks,skipped:parsed.skipped});
  });
  api.get('/api/customers/:id/members',async(req,res)=>{
    const user=(await currentUser(req))!,level=await requireCustomer(user.id,req.params.id);
    const customer=await mustCustomer(req.params.id);
    const ownerId=customer.created_by||customer.manager_id||null;
    const members=await all<any>(`SELECT u.id,u.name,u.email,CASE WHEN u.id=? OR u.id=? THEN 'admin' ELSE m.role END level FROM users u LEFT JOIN customer_members m ON m.user_id=u.id AND m.customer_id=? WHERE u.disabled=0 AND (u.id=? OR u.id=? OR m.user_id IS NOT NULL) ORDER BY u.name`,ownerId,customer.manager_id,customer.id,ownerId,customer.manager_id);
    json(res,200,{ownerId,level,members,people:level==='admin'?await all('SELECT id,name,email FROM users WHERE disabled=0 ORDER BY name'):[]});
  });
  api.put('/api/customers/:id/members/:userId',async(req,res)=>{
    const user=(await currentUser(req))!;await requireCustomer(user.id,req.params.id,'admin');
    const customer=await mustCustomer(req.params.id),body=await readJson(req);
    if(!['admin','normal','observer'].includes(body.level))throw new HttpError(400,'Quyền không hợp lệ');
    if(!await get('SELECT id FROM users WHERE id=? AND disabled=0',req.params.userId))throw new HttpError(404,'Không tìm thấy nhân viên');
    if(customer.created_by===req.params.userId&&body.level!=='admin')throw new HttpError(400,'Chủ khách hàng luôn có quyền quản lý');
    const had=await get('SELECT 1 FROM customer_members WHERE customer_id=? AND user_id=?',customer.id,req.params.userId);
    await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',customer.id,req.params.userId,body.level,user.id,now());
    if(!had)await notifyPeople([req.params.userId],user.id,{title:'Bạn được thêm vào khách hàng',body:customer.name,link:`#customers/${customer.id}`});
    json(res,200,{ok:true});
  });
  api.delete('/api/customers/:id/members/:userId',async(req,res)=>{
    const user=(await currentUser(req))!;await requireCustomer(user.id,req.params.id,'admin');
    const customer=await mustCustomer(req.params.id);if(customer.created_by===req.params.userId)throw new HttpError(400,'Không thể gỡ chủ khách hàng');
    await run('DELETE FROM customer_members WHERE customer_id=? AND user_id=?',customer.id,req.params.userId);json(res,200,{ok:true});
  });
  api.post('/api/customers/:id/transfer-owner', async (req, res) => {
    const user = (await currentUser(req))!;
    const customer = await mustCustomer(req.params.id);
    const canTransfer = user.role === 'admin' || (customer.created_by && customer.created_by === user.id) || await canDeleteCustomer(user.id, customer);
    if (!canTransfer) throw new HttpError(403, 'Chỉ chủ khách hàng hoặc quản trị viên mới được chuyển quyền');
    const body = await readJson(req);
    const newOwnerId = String(body.userId || '').trim();
    if (!newOwnerId) throw new HttpError(400, 'Thiếu thông tin người nhận quyền');
    const newOwner = await get<any>('SELECT id, name FROM users WHERE id=? AND disabled=0', newOwnerId);
    if (!newOwner) throw new HttpError(404, 'Không tìm thấy nhân viên');
    const oldOwnerId = customer.created_by;
    if (oldOwnerId && oldOwnerId !== newOwnerId) {
      await run("INSERT INTO customer_members(customer_id, user_id, role, added_by, created_at) VALUES (?, ?, 'admin', ?, ?) ON CONFLICT(customer_id, user_id) DO UPDATE SET role='admin'", customer.id, oldOwnerId, user.id, now());
    }
    await run("INSERT INTO customer_members(customer_id, user_id, role, added_by, created_at) VALUES (?, ?, 'admin', ?, ?) ON CONFLICT(customer_id, user_id) DO UPDATE SET role='admin'", customer.id, newOwnerId, user.id, now());
    await run('UPDATE customers SET created_by=?, updated_at=?, updated_by=? WHERE id=?', newOwnerId, now(), user.id, customer.id);
    if (newOwnerId !== user.id) {
      await notifyPeople([newOwnerId], user.id, { title: 'Bạn đã trở thành chủ khách hàng', body: customer.name, link: `#customers/${customer.id}` });
    }
    json(res, 200, { ok: true, ownerId: newOwnerId });
  });
  api.get('/api/customers/:id/projects', async (req, res) => {
    await mustCustomer(req.params.id);
    const visible=await projectLevels((await currentUser(req))!.id);
    const rows=(await all<any>('SELECT p.id, p.name, (SELECT COUNT(*) FROM task_campaigns c WHERE c.project_id=p.id) campaigns, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id AND t.stub=0) tasks FROM task_projects p WHERE p.customer_id=? ORDER BY p.created_at DESC', req.params.id)).filter(p=>visible.has(p.id));
    const services=await projectServices(rows.map(p=>p.id));
    json(res, 200, rows.map(p=>({...p,services:services.get(p.id)||[]})));
  });
  api.post('/api/customers/:id/projects', async (req, res) => {
    await requireCustomer((await currentUser(req))!.id,req.params.id,'admin');
    await mustCustomer(req.params.id);
    const b = await readJson(req), name = String(b.name || '').trim();
    if (b.projectId) {
      const p = await get<any>('SELECT * FROM task_projects WHERE id=?', String(b.projectId));
      if (!p) throw new HttpError(404, 'Không tìm thấy dịch vụ');
      await requireProject((await currentUser(req))!.id,p.id,'admin');
      if (p.customer_id && p.customer_id !== req.params.id) throw new HttpError(409, 'Dịch vụ đã thuộc khách hàng khác');
      await run('UPDATE task_projects SET customer_id=? WHERE id=?', req.params.id, p.id);
      await settleCustomerServices([req.params.id]);
      json(res, 200, { id: p.id, name: p.name }); return;
    }
    // One of the customer's services, called by the service's name (a name only for one of no service).
    const services = b.services !== undefined ? await oneService(b.services, 'Chỉ chọn một dịch vụ') : null;
    const title = services?.length ? (await get<any>('SELECT name FROM services WHERE id=?', services[0]))?.name || '' : name;
    if (!title || title.length > 200) throw new HttpError(400, 'Hãy chọn dịch vụ');
    const id = uid('tj_');
    await run('INSERT INTO task_projects(id,name,customer_id,created_at) VALUES(?,?,?,?)', id, title, req.params.id, now());
    const creator=(await currentUser(req))!;await run('UPDATE task_projects SET created_by=?,team_id=? WHERE id=?',creator.id,creator.team_role||null,id);
    // The services chosen for it (the form offers the customer's as its defaults), or else those still set on the customer.
    if (services) { await saveProjectServices(id, services, creator.id); await run('DELETE FROM customer_needs WHERE customer_id=?', req.params.id); }
    else await settleCustomerServices([req.params.id]);
    if(await getSetting('task_workspace_auto',true))await projectHome(id);
    json(res, 201, { id, name: title });
  });
  api.put('/api/customers/:id/projects/:project', async (req, res) => {
    await requireProject((await currentUser(req))!.id,req.params.project,'admin');
    await requireCustomer((await currentUser(req))!.id,req.params.id,'admin');
    const p = await get<any>('SELECT * FROM task_projects WHERE id=? AND customer_id=?', req.params.project, req.params.id);
    if (!p) throw new HttpError(404, 'Không tìm thấy dịch vụ của khách hàng');
    const b = await readJson(req);
    if (b.unlink === true) {
      await run('UPDATE task_projects SET customer_id=NULL WHERE id=?', p.id);
      await projectCustomerChanged(p.id);
    } else {
      const name = String(b.name || '').trim();
      if (!name || name.length > 200) throw new HttpError(400, 'Tên dịch vụ cần từ 1 đến 200 ký tự');
      await run('UPDATE task_projects SET name=? WHERE id=?', name, p.id);
      await renameProjectBoard(p.id, name);
    }
    await syncProjectCards(p.id);
    json(res, 200, { ok: true });
  });
  api.get('/api/customers/statuses',async(_req,res)=>json(res,200,await customerStatuses()));
  api.get('/api/customers/classifications',async(_req,res)=>json(res,200,await all('SELECT id,name,color,active FROM customer_categories ORDER BY pos,name')));
  api.get('/api/customers/sources',async(_req,res)=>json(res,200,await all('SELECT id,name,color,active FROM customer_sources ORDER BY pos,name')));
  // A source not in the list yet, added from the customer form by anyone who adds or edits customers (a view-only role
  // can't); one with the same name, any case, is that one.
  api.post('/api/customers/sources',async(req,res)=>{
    const user=(await currentUser(req))!;
    if(user.role!=='admin'&&deptLevel(user)==='observer')throw new HttpError(403,'Role của bạn chỉ được xem');
    const name=String((await readJson(req)).name||'').trim().replace(/\s+/g,' ');
    if(!name||name.length>60)throw new HttpError(400,'Tên nguồn cần từ 1 đến 60 ký tự');
    const had=await get<any>('SELECT id,name,color,active FROM customer_sources WHERE name=? COLLATE NOCASE',name);
    if(had){if(!had.active)await run('UPDATE customer_sources SET active=1,updated_at=? WHERE id=?',now(),had.id);return json(res,200,{...had,active:1});}
    const pos=Number((await get<any>('SELECT MAX(pos) m FROM customer_sources'))?.m||0)+1,id=uid('cus_');
    await run('INSERT INTO customer_sources(id,name,color,pos,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)',id,name,TAG_COLORS[pos%TAG_COLORS.length],pos,now(),now());
    json(res,201,{id,name,color:TAG_COLORS[pos%TAG_COLORS.length],active:1});
  });
  api.get('/api/customers/managers',async(_req,res)=>json(res,200,await all('SELECT id,name,email,team_role teamId FROM users WHERE disabled=0 ORDER BY name COLLATE NOCASE')));
  const recordOut=async(c:any)=>{
    const owner=c.created_by?await get<{id:string;name:string}>('SELECT id,name FROM users WHERE id=?',c.created_by):null;
    const manager=(c.manager_id?await get<{id:string;name:string}>('SELECT id,name FROM users WHERE id=?',c.manager_id):null)||owner||(await get<{id:string;name:string}>("SELECT u.id,u.name FROM customer_members cm JOIN users u ON u.id=cm.user_id WHERE cm.customer_id=? AND cm.role='admin' AND u.disabled=0 ORDER BY cm.created_at ASC LIMIT 1",c.id))||null;
    return {...customerRecord(c),status:c.status||null,
      category:c.category_id?await get('SELECT id,name,color FROM customer_categories WHERE id=?',c.category_id):null,
      source:c.source_id?await get('SELECT id,name,color FROM customer_sources WHERE id=?',c.source_id):null,
      owner:owner||manager,manager,
      needs:(await needsOf([c.id])).get(c.id)||[],tags:(await tagsOf([c.id])).get(c.id)||[]};
  };
  api.get('/api/customers/:id/record',async(req,res)=>json(res,200,await recordOut(await mustCustomer(req.params.id))));
  api.put('/api/customers/:id/record',async(req,res)=>{
    const user=(await currentUser(req))!;
    await requireCustomer(user.id,req.params.id,'admin');
    const current=await mustCustomer(req.params.id), body=await readJson(req), fields=customerFields(body,current),classification=await customerClassification(body,current);
    const tags=await tagsIn(body,classification.category);
    await run('UPDATE customers SET name=?,contact=?,phone=?,email=?,notes=?,status=?,category_id=?,source_id=?,manager_id=?,updated_by=?,updated_at=? WHERE id=?',fields.name,fields.contact,fields.phone,fields.email,fields.notes,classification.status,classification.category,classification.source,classification.manager,user.id,now(),current.id);
    if(classification.manager&&classification.manager!==current.manager_id&&classification.manager!==current.created_by)await run('INSERT INTO customer_members(customer_id,user_id,role,added_by,created_at) VALUES(?,?,?,?,?) ON CONFLICT(customer_id,user_id) DO UPDATE SET role=excluded.role',current.id,classification.manager,'admin',user.id,now());
    if(tags)await saveTags(current.id,tags);
    // The customer's own board keeps its name (unless someone renamed it) and its manager.
    await run('UPDATE boards SET name=? WHERE id=? AND name=?',fields.name,customerBoardId(current.id),current.name);
    if(classification.manager!==current.manager_id)await syncBoardPeople(customerBoardId(current.id));
    json(res,200,await recordOut(await mustCustomer(current.id)));
  });
  // The services catalogue (Quản trị › Dịch vụ), to say what a project is for: names only, for everyone signed in.
  api.get('/api/services',async(_req,res)=>json(res,200,(await all<any>("SELECT s.id,s.name,c.name category FROM services s LEFT JOIN service_categories c ON c.id=s.category_id WHERE s.deleted_at IS NULL AND s.status<>'inactive' ORDER BY c.pos,s.name")).map(s=>({id:s.id,name:s.name,category:s.category||null}))));
  api.get('/api/customers/:id', async (req, res) => json(res, 200, await customerOut(await mustCustomer(req.params.id), true, req.query.get('fresh') === '1')));
  api.put('/api/customers/:id', async (req, res) => {
    const c = await mustCustomer(req.params.id);
    const b = await readJson(req);
    let folder = c.folder, gloc = c.gloc;
    const newName = b.name !== undefined ? String(b.name).trim() : '';
    if (newName && newName !== c.name && await customerLevel((await currentUser(req))!.id,c.id)!=='admin') throw new HttpError(403, 'Chỉ quản trị viên mới đổi được tên thư mục');
    await run('UPDATE customers SET name=?, links=?, notes=?, folder=?, gloc=?, updated_at=? WHERE id=?',
      newName || c.name, b.links !== undefined ? JSON.stringify(cleanLinks(b.links)) : c.links, b.notes ?? c.notes, folder, gloc, now(), c.id);
    if (newName) await run('UPDATE boards SET name=? WHERE id=? AND name=?', newName, customerBoardId(c.id), c.name);
    json(res, 200, await customerOut(await mustCustomer(c.id), true));
  });
  // Link the customer to any existing folder (e.g. an old project folder on Drive): one picked, or a pasted Drive link
  // that a connected Google account can open.
  api.put('/api/customers/:id/folder', async (req, res) => {
    const c = await mustCustomer(req.params.id), b = await readJson(req);
    let l: Loc;
    if (b.link !== undefined) {
      const id = driveId(String(b.link));
      if (!id) throw new HttpError(400, 'Link Google Drive không hợp lệ. Hãy dán link thư mục (drive.google.com/drive/folders/…)');
      const found = await locate(id);
      if (found.file.mimeType !== G.FOLDER_MIME) throw new HttpError(400, 'Link này là một file, không phải thư mục. Hãy dán link thư mục của khách hàng');
      l = await mustLoc({ kind: 'gdrive', account: found.account, id: found.file.id });
    } else l = await mustLoc(b.loc);
    const other = (await all<any>('SELECT id, name, folder, gloc FROM customers WHERE id <> ? AND (gloc IS NOT NULL OR folder <> \'\')', c.id)).find((x) => { try { return x.gloc ? `g:${JSON.parse(x.gloc).id}` === folderKey(l) : false; } catch { return false; } });
    if (other) throw new HttpError(409, `Thư mục này đang liên kết với khách hàng “${other.name}”`);
    await setHidden(folderKey(l), false);
    if (l.kind === 'gdrive') await run('UPDATE customers SET folder=?, gloc=?, updated_at=? WHERE id=?', l.label?.split(' › ').pop() || c.folder, JSON.stringify({ account: l.account, id: l.id, label: l.label }), now(), c.id);
    else await run('UPDATE customers SET folder=?, gloc=NULL, updated_at=? WHERE id=?', l.dir, now(), c.id);
    knownIds.delete(c.id); invalidate(c.id);
    json(res, 200, await customerOut(await mustCustomer(c.id), true));
  });
  // Unlinks the folder: the customer stays (database only) and the folder and its files stay on Drive. The folder is
  // hidden so the next look at the root does not bring it back as a new customer; linking it again shows it.
  api.delete('/api/customers/:id/folder', async (req, res) => {
    const c = await mustCustomer(req.params.id);
    if (!c.gloc && !c.folder) throw new HttpError(400, 'Khách hàng chưa liên kết thư mục nào');
    await setHidden(folderKey(await custLoc(c)), true);
    await run("UPDATE customers SET folder = '', gloc = NULL, updated_at = ? WHERE id = ?", now(), c.id);
    knownIds.delete(c.id); invalidate(c.id);
    json(res, 200, await recordOut(await mustCustomer(c.id)));
  });
  // Hides the customer in DMI Workspace only; the folder and its videos stay untouched.
  const removeCustomerById = async (customer: any) => {
    if (customer.folder || customer.gloc) await setHidden(folderKey(await custLoc(customer)), true).catch(() => {});
    await run('UPDATE projects SET customer_id = NULL WHERE customer_id = ?', customer.id);
    await run('UPDATE task_projects SET customer_id = NULL WHERE customer_id = ?', customer.id);
    await run('UPDATE reports SET customer_id = NULL WHERE customer_id = ?', customer.id);
    await run('UPDATE board_cards SET customer_id = NULL WHERE customer_id = ?', customer.id);
    await run('UPDATE boards SET customer_id = NULL WHERE customer_id = ?', customer.id); // its boards become unclassified
    await run('UPDATE card_attachments SET customer_id = NULL,file_key = NULL WHERE customer_id = ?', customer.id);
    await run('DELETE FROM customer_tags WHERE customer_id = ?', customer.id);
    await run('DELETE FROM customer_needs WHERE customer_id = ?', customer.id);
    await run('DELETE FROM customer_members WHERE customer_id = ?', customer.id);
    await run('DELETE FROM customers WHERE id = ?', customer.id);
  };
  api.delete('/api/customers/:id', async (req, res) => {
    const customer = await mustCustomer(req.params.id);
    if (!await canDeleteCustomer((await currentUser(req))!.id, customer)) throw new HttpError(403, 'Chỉ người tạo khách hàng, trưởng phòng hoặc quản trị viên được xoá khách hàng');
    await removeCustomerById(customer);
    json(res, 200, { ok: true });
  });
  api.post('/api/customers/bulk-delete', async (req, res) => {
    const user = (await currentUser(req))!, b = await readJson(req);
    const ids = Array.isArray(b.ids) ? [...new Set<string>(b.ids.filter((id: unknown) => typeof id === 'string' && id))] : [];
    if (!ids.length || ids.length > 200) throw new HttpError(400, 'Hãy chọn từ 1 đến 200 khách hàng để xoá');
    let deleted = 0;
    for (const id of ids) {
      const customer = await get<any>('SELECT * FROM customers WHERE id = ?', id);
      if (!customer || !await canDeleteCustomer(user.id, customer)) continue;
      await removeCustomerById(customer);
      deleted++;
    }
    json(res, 200, { ok: true, deleted });
  });
  api.post('/api/customers/:id/reveal', async (req, res) => {
    const l = await custLoc(await mustCustomer(req.params.id));
    if (l.kind !== 'fs') throw new HttpError(400, 'Thư mục này nằm trên Google Drive, hãy dùng "Mở trên Drive"');
    fs.mkdirSync(l.dir, { recursive: true });
    await pexec('open', [l.dir]).catch(() => { throw new HttpError(500, 'Không mở được Finder'); });
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- video folders (tabs)
  api.post('/api/customers/:id/folders', async (req, res) => {
    const c = await mustCustomer(req.params.id), l = await custLoc(c);
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
    const c = await mustCustomer(req.params.id), l = await custLoc(c), sub = await subLoc(c, l, req.params.fkey);
    const raw = String((await readJson(req)).name || ''), name = sub.kind === 'gdrive' ? driveName(raw) : safeName(raw);
    if (!name) throw new HttpError(400, 'Hãy đặt tên thư mục');
    invalidate(c.id);
    if (sub.kind === 'gdrive') { await G.rename(sub.account, sub.id, name); return json(res, 200, { key: sub.id, name }); }
    const parent = req.params.fkey.split('/').slice(0, -1);
    if (name === path.basename(sub.dir)) return json(res, 200, { key: req.params.fkey, name });
    const next = uniqueIn(path.dirname(sub.dir), name);
    fs.renameSync(sub.dir, path.join(path.dirname(sub.dir), next));
    json(res, 200, { key: [...parent, next].join('/'), name: next });
  });
  // A folder inside a tab (or deeper) opens in place, like on Drive.
  api.get('/api/customers/:id/browse', async (req, res) => {
    const c = await mustCustomer(req.params.id), key = String(req.query.get('folder') || '');
    if (!key) throw new HttpError(400, 'Thiếu thư mục');
    const sub = await subLoc(c, await custLoc(c), key);
    if (sub.kind === 'gdrive') {
      const items = await G.listChildrenIn(sub.account, [sub.id]);
      remember(c.id, items.map((f) => f.id));
      for (const f of items) G.rememberThumb(f.id, f.thumbnailLink);
      return json(res, 200, { files: items.map((f) => gItem(c, f)).sort(order) });
    }
    json(res, 200, { files: await fsItems(c, sub.dir, key + '/', true) });
  });
  // Only empty folders: a slip of the mouse should never take a batch of videos with it.
  api.delete('/api/customers/:id/folders/:fkey', async (req, res) => {
    const c = await mustCustomer(req.params.id), l = await custLoc(c), sub = await subLoc(c, l, req.params.fkey);
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

  // ---------------------------------------------------------------- files (any kind, like on Drive)
  // Google Drive: hand the browser a resumable upload URL so the file goes straight to Google.
  api.post('/api/customers/:id/videos/session', async (req, res) => {
    const c = await mustCustomer(req.params.id), l = await subLoc(c, await custLoc(c), String(req.query.get('folder') || ''));
    if (l.kind !== 'gdrive') throw new HttpError(400, 'Chỉ dùng cho Google Drive');
    const name = safeName(String(req.query.get('name') || 'file')), size = Number(req.query.get('size') || 0);
    if (!size) throw new HttpError(400, 'Thiếu kích thước file');
    const mime = String(req.query.get('mime') || '') || mimeOfName(name);
    const origin = String(req.headers.origin || publicOrigin(req));
    invalidate(c.id);
    json(res, 200, { url: await G.uploadSession(l.account, l.id, name, mime, size, origin) });
  });
  // After a direct upload whose answer the browser could not read: did Google get the whole file?
  api.post('/api/customers/:id/videos/session/check', async (req, res) => {
    const c = await mustCustomer(req.params.id), b = await readJson(req);
    const done = await G.sessionDone(String(b.url || ''), Number(b.size || 0));
    if (done) invalidate(c.id);
    json(res, 200, { done });
  });
  api.post('/api/customers/:id/videos', async (req, res) => {
    const c = await mustCustomer(req.params.id), fkey = String(req.query.get('folder') || ''), l = await subLoc(c, await custLoc(c), fkey);
    const raw = safeName(String(req.query.get('name') || 'file'));
    if (!raw) throw new HttpError(400, 'Tên file không hợp lệ');
    const size = Number(req.headers['content-length'] || 0);
    if (l.kind === 'gdrive') {
      if (!size) throw new HttpError(411, 'Thiếu kích thước file');
      const mime = String(req.headers['content-type'] || '').split(';')[0] || mimeOfName(raw);
      const f = await G.uploadStream(l.account, l.id, raw, mime, size, req);
      remember(c.id, [f.id]); invalidate(c.id);
      await run('UPDATE customers SET updated_at=? WHERE id=?', now(), c.id);
      return json(res, 201, { name: f.name, key: f.id });
    }
    // Local: stream to a temp file first, then move it into the folder in one step,
    // so Drive for desktop never picks up a half-written file.
    const free = await fs.promises.statfs(DATA_DIR).then((s) => s.bavail * s.bsize).catch(() => Infinity);
    if (size && free - size < SPARE) {
      throw new HttpError(507, `Ổ cứng chỉ còn ${Math.round(free / 1e6)} MB, không đủ chỗ cho file ${Math.round(size / 1e6)} MB. Hãy dọn bớt dung lượng máy hoặc chuyển khách hàng sang Google Drive (đăng nhập Google).`);
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
      await run('UPDATE customers SET updated_at=? WHERE id=?', now(), c.id);
      json(res, 201, { name, key: (fkey ? fkey + '/' : '') + name });
    } finally { fs.rm(tmp, { force: true }, () => {}); }
  });
  // Files are served under /files/ (older pages used /videos/ for the same thing).
  for (const kind of ['files', 'videos']) {
    api.get(`/api/customers/:id/${kind}/:key`, async (req, res) => {
      const c = await mustCustomer(req.params.id), l = await custLoc(c), key = req.params.key;
      if (l.kind === 'gdrive') { await mustOwn(c, l, key, 'file'); return await G.streamFile(l.account, key, req, res); }
      if (!sendFile(req, res, l.dir, fsKey(key).join('/'), { untrusted: true })) throw new HttpError(404, 'Không tìm thấy file');
    });
    api.get(`/api/customers/:id/${kind}/:key/thumb`, async (req, res) => {
      const c = await mustCustomer(req.params.id), l = await custLoc(c);
      if (l.kind !== 'gdrive') throw new HttpError(404, 'Không có ảnh thu nhỏ');
      await mustOwn(c, l, req.params.key, 'file');
      await G.streamThumb(l.account, req.params.key, res);
    });
    // Anyone with the link can view (Drive files are private by default).
    api.post(`/api/customers/:id/${kind}/:key/share`, async (req, res) => {
      const c = await mustCustomer(req.params.id), l = await custLoc(c);
      if (l.kind !== 'gdrive') throw new HttpError(400, 'Chỉ chia sẻ được file trên Google Drive đã đăng nhập');
      await mustOwn(c, l, req.params.key, 'file');
      await G.shareAnyone(l.account, req.params.key); invalidate(c.id);
      json(res, 200, { url: `https://drive.google.com/file/d/${req.params.key}/view?usp=sharing` });
    });
    // Deleting moves the file to Google Drive's trash (recoverable for 30 days); local files are removed.
    api.delete(`/api/customers/:id/${kind}/:key`, async (req, res) => {
      const c = await mustCustomer(req.params.id), l = await custLoc(c), key = req.params.key;
      if (l.kind === 'gdrive') { await mustOwn(c, l, key, 'file'); await G.trash(l.account, key); knownIds.get(c.id)?.delete(key); invalidate(c.id); return json(res, 200, { ok: true }); }
      try { fs.unlinkSync(path.join(l.dir, ...fsKey(key))); } catch { throw new HttpError(404, 'Không tìm thấy file'); }
      json(res, 200, { ok: true });
    });
  }
}
