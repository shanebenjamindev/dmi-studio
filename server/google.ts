import {gmailIssue} from '../shared/gmail-errors';
// "Sign in with Google" (OAuth 2.0, web-server flow) + the few Google Drive v3 calls the workspace needs.
// Several accounts can be connected; refresh tokens live in the settings table like the other API keys.
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type http from 'node:http';
import { HttpError, untrustedHeaders } from './http';
import { all, get, run, getSetting, setSetting, now, uid } from './db';

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

export interface GAccount { email: string; name: string; picture: string; refresh: string; scopes?: string; access?: string; expiry?: number }
export async function oauthConfig() {
  const c = await getSetting<{ clientId?: string; clientSecret?: string }>('google_oauth', {});
  return { clientId: c.clientId || process.env.GOOGLE_CLIENT_ID || '', clientSecret: c.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '' };
}
export const setOauthConfig = async (clientId: string, clientSecret: string) =>
  await setSetting('google_oauth', clientId || clientSecret ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() } : null);

// Short-lived access tokens stay in process memory (refresh tokens remain server-side in user_google_accounts).
const tokenCache = new Map<string, { access: string; expiry: number }>();
const tokenKey = (email: string, userId?: string) => `${userId || '*'}|${email.toLowerCase()}`;

export async function userAccounts(userId: string): Promise<GAccount[]> {
  return (
    await all<any>(
      'SELECT email, name, picture, refresh, scopes FROM user_google_accounts WHERE user_id = ? ORDER BY created_at ASC, email ASC',
      userId
    )
  ).map((r) => ({ email: r.email, name: r.name || r.email, picture: r.picture || '', refresh: r.refresh, scopes: r.scopes || 'drive' }));
}

export async function publicUserAccounts(userId: string) {
  return (
    await all<any>(
      'SELECT id, email, name, picture, scopes, created_at FROM user_google_accounts WHERE user_id = ? ORDER BY created_at ASC, email ASC',
      userId
    )
  ).map((r) => ({ id: r.id, email: r.email, name: r.name || r.email, picture: r.picture || '', scopes: r.scopes || 'drive', createdAt: r.created_at }));
}

export async function hasUserAccount(userId: string, email: string): Promise<boolean> {
  if (!email) return false;
  return !!(await get('SELECT 1 FROM user_google_accounts WHERE user_id = ? AND LOWER(email) = LOWER(?) LIMIT 1', userId, email));
}

export async function anyUserHasAccount(email: string): Promise<boolean> {
  if (!email) return false;
  return !!(await get('SELECT 1 FROM user_google_accounts WHERE LOWER(email) = LOWER(?) LIMIT 1', email));
}

/** Server-wide connected Drive accounts (internal audit & bound-folder fallback; never expose directly to users). */
export async function accounts(): Promise<GAccount[]> {
  const rows = await all<any>('SELECT email, name, picture, refresh, scopes, updated_at FROM user_google_accounts ORDER BY updated_at DESC, email ASC');
  const seen = new Map<string, GAccount>();
  for (const r of rows) {
    const k = String(r.email || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.set(k, { email: r.email, name: r.name || r.email, picture: r.picture || '', refresh: r.refresh, scopes: r.scopes || 'drive' });
  }
  const legacy = await getSetting<GAccount[]>('google_accounts', []);
  for (const a of legacy) {
    const k = String(a.email || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.set(k, { email: a.email, name: a.name || a.email, picture: a.picture || '', refresh: a.refresh, scopes: 'drive' });
  }
  return [...seen.values()];
}

export const publicAccounts = async () => (await accounts()).map(({ email, name, picture }) => ({ email, name, picture }));

export async function removeUserAccount(userId: string, emailOrId: string) {
  const target = await get<any>(
    'SELECT id, email, refresh FROM user_google_accounts WHERE user_id = ? AND (LOWER(email) = LOWER(?) OR id = ?) LIMIT 1',
    userId,
    emailOrId,
    emailOrId
  );
  if (!target) return;
  await run('DELETE FROM user_google_accounts WHERE id = ? AND user_id = ?', target.id, userId);
  tokenCache.delete(tokenKey(target.email, userId));
  tokenCache.delete(tokenKey(target.email));
  const stillUsed =
    (await get('SELECT 1 FROM user_google_accounts WHERE refresh = ? LIMIT 1', target.refresh)) ||
    (await get('SELECT 1 FROM user_gmail WHERE refresh = ? LIMIT 1', target.refresh)) ||
    (await getSetting<GAccount | null>('notification_mail', null))?.refresh === target.refresh;
  if (!stillUsed) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(target.refresh)}`, { method: 'POST' }).catch(() => {});
  }
}

// ---------------------------------------------------------------- OAuth
// 'drive' connects an account for storage; 'signin' only identifies who is logging in to DMI Workspace; 'mail' is the
// admin's send-only account for notifications; 'mailbox' is one person's own Gmail for Hộp thư (server/mailbox.ts).
export type Purpose = 'drive' | 'signin' | 'mail' | 'mailbox';
export const MAILBOX_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
interface OAuthState { redirect: string; purpose: Purpose; owner_id?:string|null }
/** `hint`: the Google account to open with (Google skips choosing one). */
export async function authUrl(redirect: string, purpose: Purpose = 'drive', ownerId?:string, hint?: string) {
  const { clientId } = await oauthConfig();
  if (!clientId) throw new HttpError(400, 'Chưa cấu hình Google OAuth Client ID');
  const state = crypto.randomBytes(16).toString('hex');
  await run('DELETE FROM oauth_states WHERE expires_at < ?', Date.now());
  await run('INSERT INTO oauth_states(id, redirect, purpose, expires_at, owner_id) VALUES(?,?,?,?,?)', state, redirect, purpose, Date.now() + 15 * 60e3,ownerId||null);
  const q = new URLSearchParams(purpose === 'signin'
    ? { client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', prompt: 'select_account', state }
    : {
      client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: purpose==='mail'?'openid email profile https://www.googleapis.com/auth/gmail.send':purpose==='mailbox'?`openid email profile ${MAILBOX_SCOPE}`:SCOPES,
      // A mailbox asks for Gmail alone: its token never carries the Drive access given to the same account.
      access_type: 'offline', prompt: hint ? 'consent' : 'consent select_account', include_granted_scopes: purpose==='mailbox'?'false':'true', state,
      ...(hint ? { login_hint: hint } : {}),
    });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
export async function tokenCall(params: Record<string, string>) {
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
  const p = await get<OAuthState>('DELETE FROM oauth_states WHERE id=? AND expires_at>? RETURNING redirect, purpose, owner_id', state, Date.now());
  if (!p) throw new HttpError(400, 'Phiên đăng nhập đã hết hạn, hãy thử lại');
  if(p.purpose==='mail'&&!await get("SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0",p.owner_id||''))throw new HttpError(403,'Chỉ quản trị viên kết nối tài khoản gửi mail');
  const t = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: p.redirect });
  const me: any = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } })).json();
  if (!me.email) throw new HttpError(400, 'Không đọc được email tài khoản Google');
  if (p.purpose === 'signin') {
    if (me.email_verified === false) throw new HttpError(400, 'Email Google này chưa được xác minh');
    return { purpose: p.purpose, email: String(me.email).toLowerCase(), name: me.name || me.email, picture: me.picture || '' };
  }
  if(p.purpose==='mail'){
    if(me.email_verified===false)throw new HttpError(400,'Email Google chưa được xác minh');
    if(t.scope&&!String(t.scope).split(' ').includes('https://www.googleapis.com/auth/gmail.send'))throw new HttpError(400,'Chưa cấp quyền gửi mail qua Gmail');
    const previous=await getSetting<GAccount|null>('notification_mail',null);
    const account:GAccount={email:String(me.email).toLowerCase(),name:me.name||me.email,picture:me.picture||'',refresh:t.refresh_token||(previous?.email===String(me.email).toLowerCase()?previous.refresh:''),access:t.access_token,expiry:Date.now()+((t.expires_in||3600)-60)*1000};
    if(!account.refresh)throw new HttpError(400,'Google chưa cấp quyền truy cập lâu dài, hãy kết nối lại');
    await setSetting('notification_mail',account);
    await setSetting('notification_mail_issue',null);
    return {purpose:p.purpose,email:account.email,name:account.name,picture:account.picture};
  }
  if(p.purpose==='mailbox'){
    if(!p.owner_id||!await get('SELECT 1 FROM users WHERE id=? AND disabled=0',p.owner_id))throw new HttpError(403,'Hãy đăng nhập DMI Workspace trước');
    if(t.scope&&!String(t.scope).split(' ').includes(MAILBOX_SCOPE))throw new HttpError(400,'Chưa cấp quyền đọc và gửi Gmail: hãy kết nối lại và tích chọn quyền Gmail');
    const email=String(me.email).toLowerCase(),previous=await get<any>('SELECT email,refresh FROM user_gmail WHERE user_id=?',p.owner_id);
    const refresh=t.refresh_token||(previous?.email===email?previous.refresh:'');
    if(!refresh)throw new HttpError(400,'Google chưa cấp quyền truy cập lâu dài, hãy kết nối lại');
    await run('INSERT INTO user_gmail(user_id,email,name,picture,refresh,access,expiry,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture,refresh=excluded.refresh,access=excluded.access,expiry=excluded.expiry',
      p.owner_id,email,me.name||email,me.picture||'',refresh,t.access_token,Date.now()+((t.expires_in||3600)-60)*1000,Date.now());
    // One Gmail per account: the one just connected (Google has shown it is theirs) is also where their notifications go.
    if(me.email_verified!==false)await run(`INSERT INTO notification_preferences(user_id,enabled,updated_at,email,verified_at) VALUES(?,1,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at,pending_email=NULL,verification_hash=NULL,verification_expires=NULL,verification_attempts=0,updated_at=excluded.updated_at`,p.owner_id,Date.now(),email,Date.now());
    return {purpose:p.purpose,email,name:me.name||email,picture:me.picture||''};
  }
  if (!p.owner_id || !(await get('SELECT 1 FROM users WHERE id=? AND disabled=0', p.owner_id))) {
    throw new HttpError(403, 'Hãy đăng nhập DMI Workspace trước');
  }
  const email = String(me.email).toLowerCase();
  const prev = await get<any>('SELECT id, refresh FROM user_google_accounts WHERE user_id=? AND LOWER(email)=LOWER(?)', p.owner_id, email);
  const refresh = t.refresh_token || prev?.refresh || '';
  if (!refresh) throw new HttpError(400, 'Google không cấp quyền truy cập lâu dài, hãy đăng nhập lại');
  const timestamp = now();
  await run(
    `INSERT INTO user_google_accounts(id, user_id, email, name, picture, refresh, scopes, created_at, updated_at)
     VALUES(?,?,?,?,?,?, 'drive', ?,?)
     ON CONFLICT(user_id, email) DO UPDATE SET name=excluded.name, picture=excluded.picture, refresh=excluded.refresh, scopes=excluded.scopes, updated_at=excluded.updated_at`,
    uid('ga_'),
    p.owner_id,
    email,
    me.name || email,
    me.picture || '',
    refresh,
    timestamp,
    timestamp
  );
  const cached = { access: t.access_token as string, expiry: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
  tokenCache.set(tokenKey(email, p.owner_id), cached);
  tokenCache.set(tokenKey(email), cached);
  return { purpose: p.purpose, email, name: me.name || email, picture: me.picture || '' };
}

export async function accessToken(email: string, force = false, userId?: string) {
  const targetEmail = String(email || '').trim().toLowerCase();
  let row = userId
    ? await get<any>('SELECT email, refresh FROM user_google_accounts WHERE user_id = ? AND LOWER(email) = LOWER(?) LIMIT 1', userId, targetEmail)
    : await get<any>('SELECT email, refresh FROM user_google_accounts WHERE LOWER(email) = LOWER(?) ORDER BY updated_at DESC LIMIT 1', targetEmail);
  if (userId && !row) {
    throw new HttpError(403, 'Bạn chỉ dùng được Google Drive từ Gmail bạn đã liên kết');
  }
  if (!row && !userId) {
    const legacy = (await getSetting<GAccount[]>('google_accounts', [])).find((x) => String(x.email || '').toLowerCase() === targetEmail);
    if (legacy) row = legacy;
  }
  if (!row) throw new HttpError(401, `Tài khoản Google ${email} chưa được kết nối, hãy đăng nhập lại`);
  const key = tokenKey(targetEmail, userId);
  const hit = tokenCache.get(key);
  if (!force && hit && hit.expiry > Date.now()) return hit.access;
  const t = await tokenCall({ refresh_token: row.refresh, grant_type: 'refresh_token' }).catch(() => {
    tokenCache.delete(key);
    throw new HttpError(401, `Phiên Google của ${email} đã hết hạn, hãy đăng nhập lại`);
  });
  const entry = { access: t.access_token as string, expiry: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
  tokenCache.set(key, entry);
  tokenCache.set(tokenKey(targetEmail), entry);
  return entry.access;
}
/** Authorised request to a Google API; retries once with a fresh token on 401. */
export async function gfetch(email: string, url: string, init: RequestInit = {}, retry = true, userId?: string): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as any), authorization: `Bearer ${await accessToken(email, !retry, userId)}` } });
  if (res.status === 401 && retry) return await gfetch(email, url, init, false, userId);
  return res;
}
async function gjson<T = any>(email: string, url: string, init: RequestInit = {}, userId?: string): Promise<T> {
  const res = await gfetch(email, url, init, true, userId);
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `Google Drive: ${j.error?.message || res.status}`);
  return j;
}

// ---------------------------------------------------------------- Drive
const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
const q = (s: string) => encodeURIComponent(s);
export interface GFile { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; webViewLink?: string; thumbnailLink?: string; parents?: string[]; driveId?: string; shared?: boolean; videoMediaMetadata?: { durationMillis?: string }; shortcutDetails?: { targetId: string; targetMimeType: string } }

export async function sharedDrives(email: string, userId?: string) {
  const j = await gjson<{ drives: { id: string; name: string }[] }>(email, `${DRIVE}/drives?pageSize=100`, {}, userId);
  return j.drives || [];
}
async function listAll(email: string, query: string, fields: string, corpora = '', userId?: string) {
  const out: GFile[] = [];
  let page = '';
  do {
    const j = await gjson<{ files: GFile[]; nextPageToken?: string }>(email,
      `${DRIVE}/files?q=${q(query)}&fields=${q(`nextPageToken,files(${fields})`)}&orderBy=${q('folder,name')}&pageSize=200&${ALL}${corpora ? `&corpora=${corpora}` : ''}${page ? `&pageToken=${page}` : ''}`, {}, userId);
    out.push(...j.files); page = j.nextPageToken || '';
  } while (page && out.length < 2000);
  return out;
}
export const listFolders = async (email: string, parent: string, userId?: string) =>
  await listAll(email, `'${parent}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`, 'id,name', '', userId);
/** Everything (files, folders, shortcuts) directly inside any of `parents`, chunked so the query stays short; each item carries its `parents`. */
export async function listChildrenIn(email: string, parents: string[], userId?: string) {
  const out: GFile[] = [];
  for (let i = 0; i < parents.length; i += 40) {
    const q = parents.slice(i, i + 40).map((p) => `'${p}' in parents`).join(' or ');
    out.push(...await listAll(email, `(${q}) and trashed=false`,
      'id,name,size,mimeType,modifiedTime,webViewLink,thumbnailLink,shared,parents,shortcutDetails(targetId,targetMimeType)', 'allDrives', userId));
  }
  return out;
}
// Shortcuts ("Add shortcut to Drive") are followed to their target: the target's id, thumbnail and duration are used,
// the shortcut's name is kept because that is what people see in the folder.
const MEDIA_FIELDS = 'id,name,mimeType,size,modifiedTime,thumbnailLink,parents,videoMediaMetadata(durationMillis),shortcutDetails(targetId,targetMimeType)';
const isMedia = (mime = '') => /^(video|image)\//.test(mime);
export async function resolveShortcuts(email: string, files: GFile[], userId?: string) {
  const out: GFile[] = [];
  for (const f of files) {
    if (f.mimeType !== SHORTCUT_MIME) { out.push(f); continue; }
    const t = f.shortcutDetails;
    if (!t) continue;
    if (t.targetMimeType === FOLDER_MIME) { out.push({ id: t.targetId, name: f.name, mimeType: FOLDER_MIME, parents: f.parents }); continue; }
    if (!isMedia(t.targetMimeType)) continue;
    try { out.push({ ...await meta(email, t.targetId, MEDIA_FIELDS, userId) as GFile, name: f.name, parents: f.parents }); } catch { /* target deleted or not shared */ }
  }
  return out;
}
/** Sub-folders of `parent`, including shortcuts to folders (as their target). */
export async function listFoldersDeep(email: string, parent: string, userId?: string) {
  return await resolveShortcuts(email, await listAll(email,
    `'${parent}' in parents and (mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}') and trashed=false`, 'id,name,mimeType,shortcutDetails(targetId,targetMimeType)', 'allDrives', userId), userId)
    .then((l) => l.filter((f) => f.mimeType === FOLDER_MIME));
}
/** Videos and images directly inside any of `parents` (shortcuts followed), with what a source picker needs (duration, thumbnail). */
export async function listMediaIn(email: string, parents: string[], userId?: string) {
  const out: GFile[] = [];
  for (let i = 0; i < parents.length; i += 40) {
    const q = parents.slice(i, i + 40).map((p) => `'${p}' in parents`).join(' or ');
    // Parents may sit in different shared drives; Drive returns nothing for such a query unless corpora=allDrives.
    out.push(...await listAll(email, `(${q}) and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType='${SHORTCUT_MIME}') and trashed=false`, MEDIA_FIELDS, 'allDrives', userId));
  }
  return (await resolveShortcuts(email, out, userId)).filter((f) => isMedia(f.mimeType));
}
/** Files and folders whose name contains `term`, across My Drive, shared items and shared drives (shortcuts followed). */
export async function searchByName(email: string, term: string, limit = 20) {
  const query = `name contains '${term.replace(/['\\]/g, '\\$&')}' and trashed=false and (mimeType contains 'video/' or mimeType contains 'image/' or mimeType='${FOLDER_MIME}' or mimeType='${SHORTCUT_MIME}')`;
  const j = await gjson<{ files: GFile[] }>(email,
    `${DRIVE}/files?q=${q(query)}&fields=${q(`files(${MEDIA_FIELDS})`)}&pageSize=${limit}&corpora=allDrives&${ALL}`);
  return await resolveShortcuts(email, j.files || []);
}
/** Video library for report selection. Read-only; no permissions or files are changed. */
export async function searchVideos(email: string, term: string, limit=60, userId?: string) {
  const escaped=term.replace(/['\\]/g,'\\$&');
  const query=`trashed=false and mimeType contains 'video/'${term?` and name contains '${escaped}'`:''}`;
  const j=await gjson<{files:GFile[]}>(email,`${DRIVE}/files?q=${q(query)}&fields=${q(`files(${MEDIA_FIELDS})`)}&pageSize=${Math.min(limit,100)}&orderBy=${q('modifiedTime desc')}&corpora=allDrives&${ALL}`, {}, userId);
  return j.files || [];
}
/** One tab of a Google Sheet as CSV or XLSX (works with the Drive scope; the Sheets API need not be enabled). */
export async function sheetExport(email: string, id: string, gid: string, format: 'csv' | 'xlsx') {
  const r = await gfetch(email, `https://docs.google.com/spreadsheets/d/${q(id)}/export?format=${format}${gid ? `&gid=${q(gid)}` : ''}`);
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, `Google Sheets: không đọc được sheet (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}
export const meta = async (email: string, id: string, fields = 'id,name,mimeType,parents,driveId,webViewLink', userId?: string) =>
  await gjson<GFile>(email, `${DRIVE}/files/${q(id)}?fields=${q(fields)}&supportsAllDrives=true`, {}, userId);
export async function createFolder(email: string, parent: string, name: string, userId?: string) {
  return await gjson<GFile>(email, `${DRIVE}/files?fields=id,name&supportsAllDrives=true`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  }, userId);
}
export async function findChildFolder(email: string, parent: string, name: string, userId?: string) {
  const f = await listAll(email, `'${parent}' in parents and mimeType='${FOLDER_MIME}' and name='${name.replace(/['\\]/g, '\\$&')}' and trashed=false`, 'id,name', '', userId);
  return f[0] || null;
}
export const rename = async (email: string, id: string, name: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
export const trash = async (email: string, id: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
export const shareAnyone = async (email: string, id: string) =>
  await gjson(email, `${DRIVE}/files/${q(id)}/permissions?supportsAllDrives=true`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });

/** Breadcrumb from the drive root down to `id` (My Drive or a shared drive). */
export async function crumbs(email: string, id: string, userId?: string) {
  const chain: { id: string; name: string }[] = [];
  let cur: string | undefined = id;
  for (let k = 0; cur && k < 25; k++) {
    const f: GFile = await meta(email, cur, 'id,name,parents,driveId', userId);
    const isSharedRoot = f.driveId && f.id === f.driveId;
    if (!f.parents?.length || isSharedRoot) {
      if (isSharedRoot) chain.unshift({ id: f.id, name: (await sharedDrives(email, userId)).find((d) => d.id === f.id)?.name || f.name });
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
  if (!r.ok && r.status !== 206) throw new HttpError(r.status === 404 ? 404 : 502, `Google Drive: không đọc được file (${r.status})`);
  // Drive file ids never change content in place (a new upload is a new id), so the browser may reuse what it fetched.
  const out: Record<string, string> = { 'cache-control': 'private, max-age=86400', 'accept-ranges': 'bytes' };
  for (const h of ['content-type', 'content-length', 'content-range']) { const v = r.headers.get(h); if (v) out[h] = v; }
  // Whatever someone put on Drive is never shown as a page of this site (an HTML or SVG file is downloaded instead).
  Object.assign(out, untrustedHeaders(out['content-type'] || 'application/octet-stream'));
  res.writeHead(r.status, out);
  if (!r.body) return res.end();
  const s = Readable.fromWeb(r.body as any);
  res.on('close', () => s.destroy());
  // Google drops a stream the browser stopped reading (e.g. a paused video, 5 min idle): end this response
  // instead of letting the unhandled stream error take the whole server down.
  s.on('error', () => res.destroy());
  s.pipe(res);
}
/** Saves a whole file to disk (footage for a HyperFrames project on the Mac), through a .part file so a broken
 *  download never looks finished. */
export async function downloadFile(email: string, id: string, dest: string) {
  const r = await gfetch(email, `${DRIVE}/files/${q(id)}?alt=media&supportsAllDrives=true`);
  if (!r.ok || !r.body) throw new HttpError(r.status === 404 ? 404 : 502, `Google Drive: không tải được file (${r.status})`);
  await pipeline(Readable.fromWeb(r.body as any), fs.createWriteStream(dest + '.part'));
  await fs.promises.rename(dest + '.part', dest);
}
// Thumbnails: the link comes from the folder listing (no extra API call) and the image bytes are kept in memory.
const thumbLinks = new Map<string, string>();
export const rememberThumb = (id: string, link?: string) => { if (link) thumbLinks.set(id, link.replace(/=s\d+$/, '=s480')); };
const thumbBytes = new Map<string, { type: string; body: Buffer }>();
/** Thumbnail bytes (480 px), cached in memory. */
export async function thumbBuffer(email: string, id: string, userId?: string) {
  if (userId && !(await hasUserAccount(userId, email))) {
    throw new HttpError(403, 'Bạn chỉ dùng được Google Drive từ Gmail bạn đã liên kết');
  }
  let hit = thumbBytes.get(id);
  if (!hit) {
    let link = thumbLinks.get(id);
    if (!link) { link = (await meta(email, id, 'thumbnailLink', userId)).thumbnailLink?.replace(/=s\d+$/, '=s480'); if (link) thumbLinks.set(id, link); }
    if (!link) throw new HttpError(404, 'Chưa có ảnh thu nhỏ');
    let r = await gfetch(email, link, {}, true, userId);
    if (!r.ok) { // links expire after a few hours: ask Drive for a fresh one once
      link = (await meta(email, id, 'thumbnailLink', userId)).thumbnailLink?.replace(/=s\d+$/, '=s480');
      if (link) { thumbLinks.set(id, link); r = await gfetch(email, link, {}, true, userId); }
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

/** Separate send-only connection; Drive tokens are never reused for notifications. */
export async function sendNotificationMail(to:string,subject:string,text:string){
  const account=await getSetting<GAccount|null>('notification_mail',null);
  if(!account)throw new HttpError(400,'Chưa kết nối tài khoản gửi Gmail');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(account.email))throw new HttpError(400,'Email không hợp lệ');
  if(!account.access||(account.expiry||0)<Date.now()){
    const token=await tokenCall({refresh_token:account.refresh,grant_type:'refresh_token'});
    account.access=token.access_token;account.expiry=Date.now()+((token.expires_in||3600)-60)*1000;
    await setSetting('notification_mail',account);
  }
  const mime=[`From: DMI Workspace <${account.email}>`,`To: ${to}`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text).toString('base64')].join('\r\n');
  const result=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{authorization:`Bearer ${account.access}`,'content-type':'application/json'},body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')}),signal:AbortSignal.timeout(15000)});
  if(result.status===401)await setSetting('notification_mail',{...account,access:undefined,expiry:0});
  if(!result.ok){const issue=gmailIssue(result.status,await result.json().catch(()=>null));await setSetting('notification_mail_issue',issue);throw new HttpError(502,issue.message);}
  await setSetting('notification_mail_issue',null);
}
