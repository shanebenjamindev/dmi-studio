// DM Studio accounts: email + password (or "Sign in with Google" for an email an admin has added),
// cookie sessions, and admin-only user management. The first visitor creates the admin account.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type http from 'node:http';
import { Router, HttpError, json, readJson, publicOrigin, type Req, type Res } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import * as G from './google';
import { turnstileConfig, verifyTurnstile } from './turnstile';

export type Role = 'admin' | 'member';
export interface User { id: string; email: string; name: string; role: Role; disabled: number; pass: string | null; last_login: number | null; created_at: number }

const COOKIE = 'dms_sid';
const TTL = 30 * 24 * 3600e3;
const ROLES: Role[] = ['admin', 'member'];

// ---------------------------------------------------------------- passwords & sessions
const scrypt = promisify(crypto.scrypt);
async function hashPass(pw: string) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${((await scrypt(pw, salt, 64)) as Buffer).toString('hex')}`;
}
async function checkPass(pw: string, stored: string | null) {
  const [v, salt, hash] = (stored || '').split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual((await scrypt(pw, Buffer.from(salt, 'hex'), want.length)) as Buffer, want);
}
const tokenId = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// Cookies are Secure whenever the site is served over https (cloud deploy).
const secure = (req: http.IncomingMessage) => (publicOrigin(req).startsWith('https:') ? '; Secure' : '');
async function startSession(req: http.IncomingMessage, res: Res, u: User) {
  const token = crypto.randomBytes(32).toString('base64url');
  await run('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?,?,?,?)', tokenId(token), u.id, now(), now() + TTL);
  await run('UPDATE users SET last_login=? WHERE id=?', now(), u.id);
  await run('DELETE FROM sessions WHERE expires_at < ?', now());
  res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure(req)}`);
}
const clearCookie = (req: http.IncomingMessage, res: Res) => res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req)}`);
const cookieToken = (req: http.IncomingMessage) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';

export async function currentUser(req: http.IncomingMessage): Promise<User | null> {
  const t = cookieToken(req);
  if (!t) return null;
  const u = await get<User>('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0', tokenId(t), now());
  return u || null;
}

// ---------------------------------------------------------------- access rules
const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/google\/callback$/];
// Settings that affect everyone: who can sign in, which Google accounts and root folder the workspace uses, AI keys.
const ADMIN: [string, RegExp][] = [
  ['*', /^\/api\/users/], ['PUT', /^\/api\/access$/],
  ['PUT', /^\/api\/google\/config$/], ['GET', /^\/api\/google\/login$/], ['DELETE', /^\/api\/google\/accounts\//],
  ['PUT', /^\/api\/workspace$/], ['PUT', /^\/api\/settings\//], ['POST', /^\/api\/settings\//],
  // Members browse, upload and keep links/notes; creating, renaming and deleting folders, customers and videos is for admins.
  ['POST', /^\/api\/customers$/], ['DELETE', /^\/api\/customers\/[^/]+$/], ['PUT', /^\/api\/customers\/[^/]+\/folder$/],
  ['POST', /^\/api\/customers\/[^/]+\/folders$/], ['PUT', /^\/api\/customers\/[^/]+\/folders\//], ['DELETE', /^\/api\/customers\/[^/]+\/folders\//],
  ['DELETE', /^\/api\/customers\/[^/]+\/videos\//], ['POST', /^\/api\/workspace\/folders$/],
];
// ---------------------------------------------------------------- pages each role may open
// Admins always reach every page; which pages members see is set in Quản trị and enforced on the API as well.
export type Page = 'workspace' | 'editor';
export const PAGES: Page[] = ['workspace', 'editor'];
export async function pageAccess(): Promise<Record<Role, Page[]>> {
  const v = await getSetting<{ member?: Page[] } | null>('page_access', null);
  const member = Array.isArray(v?.member) ? v!.member.filter((p) => PAGES.includes(p)) : PAGES;
  return { admin: PAGES, member };
}
const PAGE_OF: [RegExp, Page][] = [
  [/^\/api\/(customers|workspace)(\/|$)/, 'workspace'],
  [/^\/api\/(projects|sheets|sources|proxies|capcut|ai|jobs|renders|templates)(\/|$)/, 'editor'],
];

/** Throws unless the request may proceed; returns the signed-in user (null for public endpoints). */
export async function guard(req: Req): Promise<User | null> {
  if (PUBLIC.some((r) => r.test(req.path))) return await currentUser(req);
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Hãy đăng nhập');
  if (u.role !== 'admin' && ADMIN.some(([m, r]) => (m === '*' || m === req.method) && r.test(req.path))) throw new HttpError(403, 'Chỉ quản trị viên mới làm được việc này');
  const page = u.role === 'admin' ? null : PAGE_OF.find(([r]) => r.test(req.path))?.[1];
  if (page && !(await pageAccess())[u.role].includes(page)) throw new HttpError(403, 'Tài khoản của bạn chưa được cấp quyền vào trang này');
  return u;
}

// ---------------------------------------------------------------- helpers
export const userOut = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, hasPassword: !!u.pass, lastLogin: u.last_login, createdAt: u.created_at,
});
const normEmail = (e: any) => String(e || '').trim().toLowerCase();
function validEmail(e: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Email không hợp lệ'); return e; }
function validPass(p: any) { const s = String(p || ''); if (s.length < 8) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự'); return s; }
const userCount = async () => (await get<any>('SELECT COUNT(*) n FROM users'))?.n || 0;
const activeAdmins = async () => (await get<any>("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0"))?.n || 0;
async function mustUser(id: string) {
  const u = await get<User>('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'Không tìm thấy người dùng');
  return u;
}
const redirect = (res: Res, to: string) => { res.writeHead(302, { location: to }); res.end(); };

// Slow down password guessing: 8 failures per email+IP within 15 minutes locks that pair for the rest of the window.
async function throttle(key: string, failed?: boolean) {
  const at = Date.now(), expiry = at + 15 * 60e3;
  if (failed === undefined) {
    const f = await get<{ n: number; expires_at: number }>('SELECT n, expires_at FROM login_attempts WHERE id=?', key);
    if (f && f.expires_at > at && f.n >= 8) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần, hãy thử lại sau 15 phút');
    return;
  }
  if (!failed) { await run('DELETE FROM login_attempts WHERE id=?', key); return; }
  await run(`INSERT INTO login_attempts(id,n,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET
    n=CASE WHEN expires_at<=? THEN 1 ELSE n+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`, key, expiry, at, at);
  await run('DELETE FROM login_attempts WHERE expires_at<?', at);
}

// ---------------------------------------------------------------- routes
export function registerAuth(api: Router) {
  api.get('/api/auth/config', (_req, res) => json(res, 200, { turnstile: turnstileConfig() }));
  api.get('/api/auth/me', async (req, res) => {
    const u = await currentUser(req);
    const c = await G.oauthConfig();
    json(res, 200, { user: u ? userOut(u) : null, pages: u ? (await pageAccess())[u.role] : [], setup: await userCount() === 0, setupCode: !!process.env.SETUP_CODE, google: !!(c.clientId && c.clientSecret) });
  });
  // Which pages each role may open (members' list is editable by admins; at least one page stays open).
  api.get('/api/access', async (_req, res) => json(res, 200, await pageAccess()));
  api.put('/api/access', async (req, res) => {
    const b = await readJson(req);
    const member = (Array.isArray(b.member) ? b.member : []).filter((p: any) => PAGES.includes(p));
    if (!member.length) throw new HttpError(400, 'Nhân viên cần được vào ít nhất một trang');
    await setSetting('page_access', { member });
    json(res, 200, await pageAccess());
  });
  // First run only: whoever opens DM Studio first creates the admin account.
  api.post('/api/auth/setup', async (req, res) => {
    if (await userCount() > 0) throw new HttpError(409, 'Đã có tài khoản quản trị, hãy đăng nhập');
    const b = await readJson(req);
    await verifyTurnstile(req, b.turnstileToken, 'setup');
    // On a public server SETUP_CODE keeps strangers from claiming the admin account before you do.
    const code = process.env.SETUP_CODE || '';
    if (code && !(typeof b.code === 'string' && b.code.length === code.length && crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(code)))) {
      throw new HttpError(403, 'Mã cài đặt không đúng');
    }
    const email = validEmail(normEmail(b.email)), name = String(b.name || '').trim() || email.split('@')[0];
    const id = uid('u_');
    // One atomic statement: concurrent setup requests must not create multiple first admins.
    const created = await run('INSERT INTO users(id, email, name, role, pass, created_at, updated_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users)', id, email, name, 'admin', await hashPass(validPass(b.password)), now(), now());
    if (!created.changes) throw new HttpError(409, 'Đã có tài khoản quản trị, hãy đăng nhập');
    const u = await mustUser(id);
    await startSession(req, res, u);
    json(res, 201, { user: userOut(u) });
  });
  api.post('/api/auth/login', async (req, res) => {
    const b = await readJson(req);
    await verifyTurnstile(req, b.turnstileToken, 'login');
    const email = normEmail(b.email), key = `${email}|${req.socket.remoteAddress}`;
    await throttle(key);
    const u = await get<User>('SELECT * FROM users WHERE email = ?', email);
    const ok = !!u && await checkPass(String(b.password || ''), u.pass);
    await throttle(key, !ok);
    if (!ok) throw new HttpError(401, u && !u.pass ? 'Tài khoản này đăng nhập bằng Google' : 'Sai email hoặc mật khẩu');
    if (u!.disabled) throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên');
    await startSession(req, res, u!);
    json(res, 200, { user: userOut(u!) });
  });
  api.post('/api/auth/logout', async (req, res) => {
    const t = cookieToken(req);
    if (t) await run('DELETE FROM sessions WHERE id = ?', tokenId(t));
    clearCookie(req, res);
    json(res, 200, { ok: true });
  });
  api.put('/api/auth/password', async (req, res) => {
    const u = await currentUser(req);
    if (!u) throw new HttpError(401, 'Hãy đăng nhập');
    const b = await readJson(req);
    if (u.pass && !await checkPass(String(b.current || ''), u.pass)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    await run('UPDATE users SET pass=?, updated_at=? WHERE id=?', await hashPass(validPass(b.next)), now(), u.id);
    // Sign out every other device.
    await run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, tokenId(cookieToken(req)));
    json(res, 200, { ok: true });
  });
  api.get('/api/auth/google', async (req, res) => redirect(res, await G.authUrl(`${publicOrigin(req)}/api/google/callback`, 'signin')));

  // ---------------------------------------------------------------- user management (admin)
  api.get('/api/users', async (_q, res) => json(res, 200, (await all<User>('SELECT * FROM users ORDER BY created_at')).map(userOut)));
  api.post('/api/users', async (req, res) => {
    const b = await readJson(req);
    const email = validEmail(normEmail(b.email));
    if (await get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    const role: Role = ROLES.includes(b.role) ? b.role : 'member';
    const pass = b.password ? await hashPass(validPass(b.password)) : null;
    const id = uid('u_');
    await run('INSERT INTO users(id, email, name, role, pass, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, email, String(b.name || '').trim() || email.split('@')[0], role, pass, now(), now());
    json(res, 201, userOut(await mustUser(id)));
  });
  api.put('/api/users/:id', async (req, res) => {
    const u = await mustUser(req.params.id), me = (await currentUser(req))!;
    const b = await readJson(req);
    const role: Role = b.role !== undefined && ROLES.includes(b.role) ? b.role : u.role;
    const disabled = b.disabled !== undefined ? (b.disabled ? 1 : 0) : u.disabled;
    if (u.id === me.id && (role !== 'admin' || disabled)) throw new HttpError(400, 'Bạn không thể tự hạ quyền hoặc khoá chính mình');
    if (u.role === 'admin' && !u.disabled && (role !== 'admin' || disabled) && await activeAdmins() <= 1) throw new HttpError(400, 'Cần giữ ít nhất một quản trị viên');
    let email = u.email;
    if (b.email !== undefined && normEmail(b.email) !== u.email) {
      email = validEmail(normEmail(b.email));
      if (await get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    }
    const pass = b.password ? await hashPass(validPass(b.password)) : u.pass;
    await run('UPDATE users SET email=?, name=?, role=?, disabled=?, pass=?, updated_at=? WHERE id=?',
      email, b.name !== undefined ? String(b.name).trim() || u.name : u.name, role, disabled, pass, now(), u.id);
    // A new password, a lock or a lower role takes effect immediately on every device.
    if (b.password || disabled || role !== u.role) await run('DELETE FROM sessions WHERE user_id = ?', u.id);
    json(res, 200, userOut(await mustUser(u.id)));
  });
  api.delete('/api/users/:id', async (req, res) => {
    const u = await mustUser(req.params.id);
    if (u.id === (await currentUser(req))!.id) throw new HttpError(400, 'Bạn không thể xoá chính mình');
    if (u.role === 'admin' && !u.disabled && await activeAdmins() <= 1) throw new HttpError(400, 'Cần giữ ít nhất một quản trị viên');
    await run('DELETE FROM users WHERE id = ?', u.id);
    json(res, 200, { ok: true });
  });
}

/** Google sent the user back after "Sign in with Google": start a session if an admin has added that email. */
export async function finishGoogleSignin(req: http.IncomingMessage, res: Res, email: string) {
  const u = await get<User>('SELECT * FROM users WHERE email = ?', email);
  if (!u) throw new HttpError(403, `${email} chưa được cấp quyền vào DM Studio. Hãy nhờ quản trị viên thêm email này.`);
  if (u.disabled) throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên');
  await startSession(req, res, u);
}
