// "Sign in with Google" (OAuth 2.0, web-server flow) + the few Google Drive v3 calls the workspace needs.
// Several accounts can be connected; refresh tokens live in the settings table like the other API keys.
import https from 'node:https';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { HttpError } from './http';
import { get, run, getSetting, setSetting } from './db';

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

export interface GAccount { email: string; name: string; picture: string; refresh: string; access?: string; expiry?: number }
export async function oauthConfig() {
  const c = await getSetting<{ clientId?: string; clientSecret?: string }>('google_oauth', {});
  return { clientId: c.clientId || process.env.GOOGLE_CLIENT_ID || '', clientSecret: c.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '' };
}
export const setOauthConfig = async (clientId: string, clientSecret: string) =>
  await setSetting('google_oauth', clientId || clientSecret ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : null);
export const accounts = async () => await getSetting<GAccount[]>('google_accounts', []);
const saveAccounts = async (a: GAccount[]) => await setSetting('google_accounts', a.length ? a : null);
export const publicAccounts = async () => (await accounts()).map(({ email, name, picture }) => ({ email, name, picture }));
export async function removeAccount(email: string) {
  const a = (await accounts()).find((x) => x.email === email);
  await saveAccounts((await accounts()).filter((x) => x.email !== email));
  if (a) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(a.refresh)}`, { method: 'POST' }).catch(() => {});
}

// ---------------------------------------------------------------- OAuth
// 'drive' connects an account for storage; 'signin' only identifies who is logging in to DM Studio.
export type Purpose = 'drive' | 'signin';
interface OAuthState { redirect: string; purpose: Purpose }
export async function authUrl(redirect: string, purpose: Purpose = 'drive') {
  const { clientId } = await oauthConfig();
  if (!clientId) throw new HttpError(400, 'Chưa cấu hình Google OAuth Client ID');
  const state = crypto.randomBytes(16).toString('hex');
  await run('DELETE FROM oauth_states WHERE expires_at < ?', Date.now());
  await run('INSERT INTO oauth_states(id, redirect, purpose, expires_at) VALUES(?,?,?,?)', state, redirect, purpose, Date.now() + 15 * 60e3);
  const q = new URLSearchParams(purpose === 'signin'
    ? { client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', prompt: 'select_account', state }
    : {
      client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES,
      access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', state,
    });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function tokenCall(params: Record<string, string>) {
  const { clientId, clientSecret } = await oauthConfig();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(400, `Google từ chối đăng nhập: ${j.error_description || j.error || res.status}`);
  return j;
}
export const purposeOf = async (state: string) => (await get<OAuthState>('SELECT purpose FROM oauth_states WHERE id=? AND expires_at>?', state, Date.now()))?.purpose ?? null;
export async function finishLogin(code: string, state: string) {
  const p = await get<OAuthState>('DELETE FROM oauth_states WHERE id=? AND expires_at>? RETURNING redirect, purpose', state, Date.now());
  if (!p) throw new HttpError(400, 'Phiên đăng nhập đã hết hạn, hãy thử lại');
  const t = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: p.redirect });
  const me: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } })).json();
  if (!me.email) throw new HttpError(400, 'Không đọc được email tài khoản Google');
  if (p.purpose === 'signin') {
    if (me.email_verified === false) throw new HttpError(400, 'Email Google này chưa được xác minh');
    return { purpose: p.purpose, email: String(me.email).toLowerCase(), name: me.name || me.email, picture: me.picture || '' };
  }
  const prev = (await accounts()).find((a) => a.email === me.email);
  const acc: GAccount = {
    email: me.email, name: me.name || me.email, picture: me.picture || '',
    refresh: t.refresh_token || prev?.refresh || '', access: t.access_token, expiry: Date.now() + (t.expires_in - 60) * 1000,
  };
  if (!acc.refresh) throw new HttpError(400, 'Google không cấp quyền truy cập lâu dài, hãy đăng nhập lại');
  await saveAccounts([...(await accounts()).filter((a) => a.email !== acc.email), acc]);
  return { purpose: p.purpose, email: acc.email, name: acc.name, picture: acc.picture };
}
export async function accessToken(email: string, force = false) {
  const list = await accounts();
  const a = list.find((x) => x.email === email);
  if (!a) throw new HttpError(401, `Tài khoản Google ${email} chưa được kết nối, hãy đăng nhập lại`);
  if (!force && a.access && (a.expiry || 0) > Date.now()) return a.access;
  const t = await tokenCall({ refresh_token: a.refresh, grant_type: 'refresh_token' }).catch(() => {
    throw new HttpError(401, `Phiên Google của ${email} đã hết hạn, hãy đăng nhập lại`);
  });
  a.access = t.access_token; a.expiry = Date.now() + (t.expires_in - 60) * 1000;
  await saveAccounts(list);
  return a.access!;
}
/** Authorised request to a Google API; retries once with a fresh token on 401. */
export async function gfetch(email: string, url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as any), authorization: `Bearer ${await accessToken(email, !retry)}` } });
  if (res.status === 401 && retry) return await gfetch(email, url, init, false);
  return res;
}
async function gjson<T = any>(email: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await gfetch(email, url, init);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${j.error?.message || res.status}`);
  return j;
}

// ---------------------------------------------------------------- Drive
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const q = (s: string) => encodeURIComponent(s);
export interface GFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string; thumbnailLink?: string; parents?: string[]; driveId?: string; shared?: boolean; videoMediaMetadata?: { durationMillis?: string }; shortcutDetails?: { targetId: string; targetMimeType: string } }

export async function sharedDrives(email: string) {
  const j = await gjson<{ drives: { id: string; name: string }[] }>(email, `${DRIVE}/drives?pageSize=100`);
  return j.drives || [];
}
async function listAll(email: string, query: string, fields: string, corpora = '') {
  const out: GFile[] = [];
  let page = '';
  do {
    const j = await gjson<{ files: GFile[]; nextPageToken?: string }>(email,
      `${DRIVE}/files?q=${q(query)}&fields=${q(`nextPageToken,files(${fields})`)}&orderBy=${q('folder,name')}&pageSize=200&${ALL}${corpora ? `&corpora=${corpora}` : ''}${page ? `&pageToken=${page}` : ''}`);
    out.push(...j.files); page = j.nextPageToken || '';
  } while (page && out.length < 2000);
  return out;
}
export const listFolders = async (email: string, parent: string) =>
  await listAll(email, `'${parent}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'id,name');
export const listVideos = async (email: string, parent: string) =>
  await listAll(email, `'${parent}' in parents and mimeType contains 'video/' and trashed=false`, 'id,name,size,mimeType,modifiedTime,webViewLink,thumbnailLink,shared');
/** Videos directly inside any of `parents` (chunked so the query stays short); each file carries its `parents`. */
export async function listVideosIn(email: string, parents: string[]) {
  const out: GFile[] = [];
  for (let i = 0; i < parents.length; i += 40) {
    const q = parents.slice(i, i + 40).map((p) => `'${p}' in parents`).join(' or ');
    out.push(...await listAll(email, `(${q}) and mimeType contains 'video/' and trashed=false`, 'id,name,size,mimeType,modifiedTime,webViewLink,thumbnailLink,shared,parents'));
  }
  return out;
}
// Shortcuts ("Add shortcut to Drive") are followed to their target: the target's id, thumbnail and duration are used,
// the shortcut's name is kept because that is what people see in the folder.
const MEDIA_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,parents,videoMediaMetadata(durationMillis),shortcutDetails(targetId,targetMimeType)';
const isMedia = (mime = '') => /^(video|image)\//.test(mime);
export async function resolveShortcuts(email: string, files: GFile[]) {
  const out: GFile[] = [];
  for (const f of files) {
    if (f.mimeType !== SHORTCUT_MIME) { out.push(f); continue; }
    const t = f.shortcutDetails;
    if (!t) continue;
    if (t.targetMimeType === FOLDER_MIME) { out.push({ id: t.targetId, name: f.name, mimeType: FOLDER_MIME, parents: f.parents }); continue; }
    if (!isMedia(t.targetMimeType)) continue;
    try { out.push({ ...await meta(email, t.targetId, MEDIA_FIELDS) as GFile, name: f.name, parents: f.parents }); } catch { /* target deleted or not shared */ }
  }
  return out;
}
/** Sub-folders of `parent`, including shortcuts to folders (as their target). */
export async function listFoldersDeep(email: string, parent: string) {
  return await resolveShortcuts(email, await listAll(email,
    `'${parent}' in parents and (mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}') and trashed=false`, 'id,name,mimeType,shortcutDetails(targetId,targetMimeType)', 'allDrives'))
    .then((l) => l.filter((f) => f.mimeType === FOLDER_MIME));
}
/** Videos and images directly inside any of `parents` (shortcuts followed), with what a source picker needs (duration, thumbnail). */
export async function listMediaIn(email: string, parents: string[]) {
  const out: GFile[] = [];
  for (let i = 0; i < parents.length; i += 40) {
    const q = parents.slice(i, i + 40).map((p) => `'${p}' in parents`).join(' or ');
    // Parents may sit in different shared drives; Drive returns nothing for such a query unless corpora=allDrives.
    out.push(...await listAll(email, `(${q}) and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType='${SHORTCUT_MIME}') and trashed=false`, MEDIA_FIELDS, 'allDrives'));
  }
  return (await resolveShortcuts(email, out)).filter((f) => isMedia(f.mimeType));
}
/** Files and folders whose name contains `term`, across My Drive, shared items and shared drives (shortcuts followed). */
export async function searchByName(email: string, term: string, limit = 20) {
  const query = `name contains '${term.replace(/['\\]/g, '\\$&')}' and trashed=false and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}')`;
  const j = await gjson<{ files: GFile[] }>(email,
    `${DRIVE}/files?q=${q(query)}&fields=${q(`files(${MEDIA_FIELDS})`)}&pageSize=${limit}&corpora=allDrives&${ALL}`);
  return await resolveShortcuts(email, j.files || []);
}
/** One tab of a Google Sheet as CSV or XLSX (works with the Drive scope; the Sheets API need not be enabled). */
export async function sheetExport(email: string, id: string, gid: string, format: 'csv' | 'xlsx') {
  const r = await gfetch(email, `https://docs.google.com/spreadsheets/d/${q(id)}/export?format=${format}${gid ? `&gid=${q(gid)}` : ''}`);
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Google Sheets: không đọc được sheet (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
export const meta = async (email: string, id: string, fields = 'id,name,mimeType,parents,driveId,webViewLink') =>
  await gjson<GFile>(email, `${DRIVE}/files/${q(id)}?fields=${q(fields)}&supportsAllDrives=true`);
export async function createFolder(email: string, parent: string, name: string) {
  return await gjson<GFile>(email, `${DRIVE}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
}
export async function findChildFolder(email: string, parent: string, name: string) {
  const f = await listAll(email, `'${parent}' in parents and mimeType='${FOLDER_MIME}' and name='${name.replace(/['\\]/g, '\\$&')}' and trashed=false`, 'id,name');
  return f[0] || null;
}
export const rename = async (email: string, id: string, name: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
export const trash = async (email: string, id: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
export const shareAnyone = async (email: string, id: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}/permissions?supportsAllDrives=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });

/** Breadcrumb from the drive root down to `id` (My Drive or a shared drive). */
export async function crumbs(email: string, id: string) {
  const chain: { id: string; name: string }[] = [];
  let cur: string | undefined = id;
  for (let k = 0; cur && k < 25; k++) {
    const f: GFile = await meta(email, cur, 'id,name,parents,driveId');
    const isSharedRoot = f.driveId && f.id === f.driveId;
    if (!f.parents?.length || isSharedRoot) {
      if (isSharedRoot) chain.unshift({ id: f.id, name: (await sharedDrives(email)).find((d) => d.id === f.id)?.name || f.name });
      else chain.unshift({ id: f.id, name: 'My Drive' });
      break;
    }
    chain.unshift({ id: f.id, name: f.name });
    cur = f.parents[0];
  }
  return chain;
}

/** Resumable upload, streaming the browser's request body straight to Google — nothing is written to local disk. */
/**
 * Opens a resumable upload and returns its session URL. Created with the browser's Origin, Google lets the
 * browser PUT the file straight to that URL (CORS), so the video does not pass through this server.
 */
export async function uploadSession(email: string, parent: string, name: string, mime: string, size: number, origin?: string) {
  const r = await gfetch(email, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': mime, 'x-upload-content-length': String(size), ...(origin ? { origin } : {}) },
    body: JSON.stringify({ name, parents: [parent] }),
  });
  const url = r.headers.get('location');
  if (!r.ok || !url) throw new HttpError(502, `Google Drive không nhận upload (${r.status})`);
  return url;
}
/** Whether a resumable session already holds the whole file (Google answers 200/201 when done, 308 while incomplete). */
export async function sessionDone(url: string, size: number) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'www.googleapis.com' || !u.pathname.startsWith('/upload/drive/')) throw new HttpError(400, 'Phiên tải lên không hợp lệ');
  const r = await fetch(u, { method: 'PUT', headers: { 'content-range': `bytes */${size}`, 'content-length': '0' } }).catch(() => null);
  return !!r && (r.status === 200 || r.status === 201);
}
export async function uploadStream(email: string, parent: string, name: string, mime: string, size: number, body: http.IncomingMessage) {
  const session = await uploadSession(email, parent, name, mime, size);
  return new Promise<GFile>((resolve, reject) => {
    const up = https.request(session, { method: 'PUT', headers: { 'content-type': mime, 'content-length': size } }, (r) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => {
        let j: any = {}; try { j = JSON.parse(data); } catch { /* empty */ }
        r.statusCode && r.statusCode < 300 ? resolve(j) : reject(new HttpError(502, `Google Drive: ${j.error?.message || r.statusCode}`));
      });
    });
    up.on('error', (e) => reject(new HttpError(502, 'Mất kết nối tới Google Drive: ' + e.message)));
    body.on('aborted', () => { up.destroy(); reject(new HttpError(499, 'Đã huỷ tải lên')); });
    body.pipe(up);
  });
}

/** Proxies the file bytes (with Range, so <video> can seek) without downloading the whole file to disk. */
export async function streamFile(email: string, id: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const headers: Record<string, string> = {};
  if (req.headers.range) headers.range = String(req.headers.range);
  const r = await gfetch(email, `${DRIVE}/files/${q(id)}?alt=media&supportsAllDrives=true`, { headers });
  if (!r.ok && r.status !== 206) throw new HttpError(r.status === 404 ? 404 : 502, `Google Drive: không đọc được video (${r.status})`);
  // Drive file ids never change content in place (a new upload is a new id), so the browser may reuse what it fetched.
  const out: Record<string, string> = { 'cache-control': 'private, max-age=86400', 'accept-ranges': 'bytes' };
  for (const h of ['content-type', 'content-length', 'content-range']) { const v = r.headers.get(h); if (v) out[h] = v; }
  res.writeHead(r.status, out);
  if (!r.body) return res.end();
  const s = Readable.fromWeb(r.body as any);
  res.on('close', () => s.destroy());
  // Google drops a stream the browser stopped reading (e.g. a paused video, 5 min idle): end this response
  // instead of letting the unhandled stream error take the whole server down.
  s.on('error', () => res.destroy());
  s.pipe(res);
}
// Thumbnails: the link comes from the folder listing (no extra API call) and the image bytes are kept in memory.
const thumbLinks = new Map<string, string>();
export const rememberThumb = (id: string, link?: string) => { if (link) thumbLinks.set(id, link.replace(/=s\d+$/, '=s480')); };
const thumbBytes = new Map<string, { type: string; body: Buffer }>();
/** Thumbnail bytes (480 px), cached in memory. */
export async function thumbBuffer(email: string, id: string) {
  let hit = thumbBytes.get(id);
  if (!hit) {
    let link = thumbLinks.get(id);
    if (!link) { link = (await meta(email, id, 'thumbnailLink')).thumbnailLink?.replace(/=s\d+$/, '=s480'); if (link) thumbLinks.set(id, link); }
    if (!link) throw new HttpError(404, 'Chưa có ảnh thu nhỏ');
    let r = await gfetch(email, link);
    if (!r.ok) { // links expire after a few hours: ask Drive for a fresh one once
      link = (await meta(email, id, 'thumbnailLink')).thumbnailLink?.replace(/=s\d+$/, '=s480');
      if (link) { thumbLinks.set(id, link); r = await gfetch(email, link); }
    }
    if (!r.ok) throw new HttpError(404, 'Chưa có ảnh thu nhỏ');
    hit = { type: r.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await r.arrayBuffer()) };
    thumbBytes.set(id, hit);
    if (thumbBytes.size > 500) thumbBytes.delete(thumbBytes.keys().next().value!);
  }
  return hit;
}
export async function streamThumb(email: string, id: string, res: http.ServerResponse) {
  const hit = await thumbBuffer(email, id);
  // The URL carries the file's modified time, so it can be cached for long.
  res.writeHead(200, { 'content-type': hit.type, 'content-length': hit.body.length, 'cache-control': 'private, max-age=604800, immutable' });
  res.end(hit.body);
}
