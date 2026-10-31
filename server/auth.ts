// DM Studio accounts: email + password (or "Sign in with Google" for an email an admin has added),
// cookie sessions, and admin-only user management. The first visitor creates the admin account.
import crypto from 'node:crypto';
import type http from 'node:http';
import { Router, HttpError, json, readJson, publicOrigin, type Req, type Res } from './http';
import { all, get, run, uid, now } from './db';
import * as G from './google';

export type Role = 'admin' | 'member';
export interface User { id: string; email: string; name: string; role: Role; disabled: number; pass: string | null; last_login: number | null; created_at: number }

const COOKIE = 'dms_sid';
const TTL = 30 * 24 * 3600e3;
const ROLES: Role[] = ['admin', 'member'];

// ---------------------------------------------------------------- passwords & sessions
function hashPass(pw: string) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPass(pw: string, stored: string | null) {
  const [v, salt, hash] = (stored || '').split('$');
  if (v !== 's1' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(salt, 'hex'), want.length), want);
}
const tokenId = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

// Cookies are Secure whenever the site is served over https (cloud deploy).
const secure = (req: http.IncomingMessage) => (publicOrigin(req).startsWith('https:') ? '; Secure' : '');
function startSession(req: http.IncomingMessage, res: Res, u: User) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES(?,?,?,?)', tokenId(token), u.id, now(), now() + TTL);
  run('UPDATE users SET last_login=? WHERE id=?', now(), u.id);
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure(req)}`);
}
const clearCookie = (req: http.IncomingMessage, res: Res) => res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req)}`);
const cookieToken = (req: http.IncomingMessage) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';

export function currentUser(req: http.IncomingMessage): User | null {
  const t = cookieToken(req);
  if (!t) return null;
  const u = get<User>('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0', tokenId(t), now());
  return u || null;
}

// ---------------------------------------------------------------- access rules
const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/google\/callback$/];
// Settings that affect everyone: who can sign in, which Google accounts and root folder the workspace uses, AI keys.
const ADMIN: [string, RegExp][] = [
  ['*', /^\/api\/users/],
  ['PUT', /^\/api\/google\/config$/], ['GET', /^\/api\/google\/login$/], ['DELETE', /^\/api\/google\/accounts\//],
  ['PUT', /^\/api\/workspace$/], ['PUT', /^\/api\/settings\//], ['POST', /^\/api\/settings\//],
  // Members browse, upload and keep links/notes; creating, renaming and deleting folders, customers and videos is for admins.
  ['POST', /^\/api\/customers$/], ['DELETE', /^\/api\/customers\/[^/]+$/], ['PUT', /^\/api\/customers\/[^/]+\/folder$/],
  ['POST', /^\/api\/customers\/[^/]+\/folders$/], ['PUT', /^\/api\/customers\/[^/]+\/folders\//], ['DELETE', /^\/api\/customers\/[^/]+\/folders\//],
  ['DELETE', /^\/api\/customers\/[^/]+\/videos\//], ['POST', /^\/api\/workspace\/folders$/],
];
/** Throws unless the request may proceed; returns the signed-in user (null for public endpoints). */
export function guard(req: Req): User | null {
  if (PUBLIC.some((r) => r.test(req.path))) return currentUser(req);
  const u = currentUser(req);
  if (!u) throw new HttpError(401, 'Hãy đăng nhập');
  if (u.role !== 'admin' && ADMIN.some(([m, r]) => (m === '*' || m === req.method) && r.test(req.path))) throw new HttpError(403, 'Chỉ quản trị viên mới làm được việc này');
  return u;
}

// ---------------------------------------------------------------- helpers
export const userOut = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, hasPassword: !!u.pass, lastLogin: u.last_login, createdAt: u.created_at,
});
const normEmail = (e: any) => String(e || '').trim().toLowerCase();
function validEmail(e: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Email không hợp lệ'); return e; }
function validPass(p: any) { const s = String(p || ''); if (s.length < 8) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự'); return s; }
const userCount = () => get<any>('SELECT COUNT(*) n FROM users')?.n || 0;
const activeAdmins = () => get<any>("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0")?.n || 0;
function mustUser(id: string) {
  const u = get<User>('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'Không tìm thấy người dùng');
  return u;
}
const redirect = (res: Res, to: string) => { res.writeHead(302, { location: to }); res.end(); };

// Slow down password guessing: 8 failures per email+IP within 15 minutes locks that pair for the rest of the window.
const fails = new Map<string, { n: number; at: number }>();
function throttle(key: string, failed?: boolean) {
  const f = fails.get(key);
  if (f && Date.now() - f.at > 15 * 60e3) fails.delete(key);
  if (failed === undefined) { if ((fails.get(key)?.n || 0) >= 8) throw new HttpError(429, 'Sai mật khẩu quá nhiều lần, hãy thử lại sau 15 phút'); return; }
  if (failed) fails.set(key, { n: (fails.get(key)?.n || 0) + 1, at: fails.get(key)?.at || Date.now() }); else fails.delete(key);
}

// ---------------------------------------------------------------- routes
export function registerAuth(api: Router) {
  api.get('/api/auth/me', (req, res) => {
    const u = currentUser(req);
    const c = G.oauthConfig();
    json(res, 200, { user: u ? userOut(u) : null, setup: userCount() === 0, setupCode: !!process.env.SETUP_CODE, google: !!(c.clientId && c.clientSecret) });
  });
  // First run only: whoever opens DM Studio first creates the admin account.
  api.post('/api/auth/setup', async (req, res) => {
    if (userCount() > 0) throw new HttpError(409, 'Đã có tài khoản quản trị, hãy đăng nhập');
    const b = await readJson(req);
    // On a public server SETUP_CODE keeps strangers from claiming the admin account before you do.
    const code = process.env.SETUP_CODE || '';
    if (code && !(typeof b.code === 'string' && b.code.length === code.length && crypto.timingSafeEqual(Buffer.from(b.code), Buffer.from(code)))) {
      throw new HttpError(403, 'Mã cài đặt không đúng');
    }
    const email = validEmail(normEmail(b.email)), name = String(b.name || '').trim() || email.split('@')[0];
    const id = uid('u_');
    run('INSERT INTO users(id, email, name, role, pass, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, email, name, 'admin', hashPass(validPass(b.password)), now(), now());
    const u = mustUser(id);
    startSession(req, res, u);
    json(res, 201, { user: userOut(u) });
  });
  api.post('/api/auth/login', async (req, res) => {
    const b = await readJson(req);
    const email = normEmail(b.email), key = `${email}|${req.socket.remoteAddress}`;
    throttle(key);
    const u = get<User>('SELECT * FROM users WHERE email = ?', email);
    const ok = !!u && checkPass(String(b.password || ''), u.pass);
    throttle(key, !ok);
    if (!ok) throw new HttpError(401, u && !u.pass ? 'Tài khoản này đăng nhập bằng Google' : 'Sai email hoặc mật khẩu');
    if (u!.disabled) throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên');
    startSession(req, res, u!);
    json(res, 200, { user: userOut(u!) });
  });
  api.post('/api/auth/logout', (req, res) => {
    const t = cookieToken(req);
    if (t) run('DELETE FROM sessions WHERE id = ?', tokenId(t));
    clearCookie(req, res);
    json(res, 200, { ok: true });
  });
  api.put('/api/auth/password', async (req, res) => {
    const u = currentUser(req);
    if (!u) throw new HttpError(401, 'Hãy đăng nhập');
    const b = await readJson(req);
    if (u.pass && !checkPass(String(b.current || ''), u.pass)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    run('UPDATE users SET pass=?, updated_at=? WHERE id=?', hashPass(validPass(b.next)), now(), u.id);
    // Sign out every other device.
    run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, tokenId(cookieToken(req)));
    json(res, 200, { ok: true });
  });
  api.get('/api/auth/google', (req, res) => redirect(res, G.authUrl(`${publicOrigin(req)}/api/google/callback`, 'signin')));

  // ---------------------------------------------------------------- user management (admin)
  api.get('/api/users', (_q, res) => json(res, 200, all<User>('SELECT * FROM users ORDER BY created_at').map(userOut)));
  api.post('/api/users', async (req, res) => {
    const b = await readJson(req);
    const email = validEmail(normEmail(b.email));
    if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    const role: Role = ROLES.includes(b.role) ? b.role : 'member';
    const pass = b.password ? hashPass(validPass(b.password)) : null;
    const id = uid('u_');
    run('INSERT INTO users(id, email, name, role, pass, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, email, String(b.name || '').trim() || email.split('@')[0], role, pass, now(), now());
    json(res, 201, userOut(mustUser(id)));
  });
  api.put('/api/users/:id', async (req, res) => {
    const u = mustUser(req.params.id), me = currentUser(req)!;
    const b = await readJson(req);
    const role: Role = b.role !== undefined && ROLES.includes(b.role) ? b.role : u.role;
    const disabled = b.disabled !== undefined ? (b.disabled ? 1 : 0) : u.disabled;
    if (u.id === me.id && (role !== 'admin' || disabled)) throw new HttpError(400, 'Bạn không thể tự hạ quyền hoặc khoá chính mình');
    if (u.role === 'admin' && !u.disabled && (role !== 'admin' || disabled) && activeAdmins() <= 1) throw new HttpError(400, 'Cần giữ ít nhất một quản trị viên');
    let email = u.email;
    if (b.email !== undefined && normEmail(b.email) !== u.email) {
      email = validEmail(normEmail(b.email));
      if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    }
    const pass = b.password ? hashPass(validPass(b.password)) : u.pass;
    run('UPDATE users SET email=?, name=?, role=?, disabled=?, pass=?, updated_at=? WHERE id=?',
      email, b.name !== undefined ? String(b.name).trim() || u.name : u.name, role, disabled, pass, now(), u.id);
    // A new password, a lock or a lower role takes effect immediately on every device.
    if (b.password || disabled || role !== u.role) run('DELETE FROM sessions WHERE user_id = ?', u.id);
    json(res, 200, userOut(mustUser(u.id)));
  });
  api.delete('/api/users/:id', (req, res) => {
    const u = mustUser(req.params.id);
    if (u.id === currentUser(req)!.id) throw new HttpError(400, 'Bạn không thể xoá chính mình');
    if (u.role === 'admin' && !u.disabled && activeAdmins() <= 1) throw new HttpError(400, 'Cần giữ ít nhất một quản trị viên');
    run('DELETE FROM users WHERE id = ?', u.id);
    json(res, 200, { ok: true });
  });
}

/** Google sent the user back after "Sign in with Google": start a session if an admin has added that email. */
export function finishGoogleSignin(req: http.IncomingMessage, res: Res, email: string) {
  const u = get<User>('SELECT * FROM users WHERE email = ?', email);
  if (!u) throw new HttpError(403, `${email} chưa được cấp quyền vào DM Studio. Hãy nhờ quản trị viên thêm email này.`);
  if (u.disabled) throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên');
  startSession(req, res, u);
}
