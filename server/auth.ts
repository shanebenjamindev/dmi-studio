import {requireProject} from './project-access';
import {customerLevel,requireCustomer} from './customer-access';
// DM Workspace accounts: email + password (or "Sign in with Google" for an email an admin has added),
// cookie sessions, and admin-only user management. The first visitor creates the admin account.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type http from 'node:http';
import { Router, HttpError, json, readJson, publicOrigin, type Req, type Res } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import * as G from './google';
import { turnstileConfig, verifyTurnstile } from './turnstile';

export type Role = 'admin' | 'member';
/** `team_role`: the person's department (phòng ban); `dept_role`: their role in it, whose level (`dept_level`) says what
 *  they may do in the department: 'admin' (manage its boards and Drive), 'normal' (edit) or 'observer' (view). */
export interface User {
  id: string; email: string; name: string; role: Role; disabled: number; pass: string | null; last_login: number | null; created_at: number;
  team_role: string | null; dept_role?: string | null; dept_level?: Level | null; dept_role_name?: string | null;
}
/** What someone may do: on a board, in a workspace, or in their department. */
export type Level = 'admin' | 'normal' | 'observer';
/** A person's level in their department (no role chosen yet: member). Company admins are above all of this. */
export const deptLevel = (u: Pick<User, 'dept_level'>): Level => u.dept_level || 'normal';
/** Users with their department role's name and level. */
export const USER_SQL = 'SELECT u.*, d.level dept_level, d.name dept_role_name FROM users u LEFT JOIN dept_roles d ON d.id = u.dept_role AND d.team_role_id = u.team_role';

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
  const u = await get<User>('SELECT u.*, d.level dept_level, d.name dept_role_name FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN dept_roles d ON d.id = u.dept_role AND d.team_role_id = u.team_role WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0', tokenId(t), now());
  return u || null;
}

// ---------------------------------------------------------------- access rules
const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/google\/callback$/];
// Settings that affect everyone (company admins only): who can sign in, departments and their roles, which Google
// accounts and root folder the workspace uses, AI keys.
const ADMIN: [string, RegExp][] = [
  ['*', /^\/api\/users/], ['PUT', /^\/api\/access$/], ['POST', /^\/api\/roles/], ['PUT', /^\/api\/roles\//], ['DELETE', /^\/api\/roles\//], ['*', /^\/api\/positions\//],
  ['PUT', /^\/api\/google\/config$/], ['GET', /^\/api\/google\/login$/], ['DELETE', /^\/api\/google\/accounts\//],
  ['PUT', /^\/api\/workspace$/], ['PUT', /^\/api\/settings\//], ['POST', /^\/api\/settings\//],
];
// Members browse, upload and keep links/notes; creating, renaming and deleting folders, customers and files is for
// company admins and the admins of a department (a role at the 'admin' level).
const MANAGE: [string, RegExp][] = [
['DELETE', /^\/api\/customers\/[^/]+$/], ['PUT', /^\/api\/customers\/[^/]+\/folder$/],
  ['POST', /^\/api\/customers\/[^/]+\/folders$/], ['PUT', /^\/api\/customers\/[^/]+\/folders\//], ['DELETE', /^\/api\/customers\/[^/]+\/folders\//],
  ['DELETE', /^\/api\/customers\/[^/]+\/(videos|files)\//], ['POST', /^\/api\/workspace\/folders$/],
];
// A view-only role changes nothing in the tool pages (looking through folders to pick one is not a change).
const VIEW_ONLY_OK = /^\/api\/workspace\/browse$/;
const matches = (list: [string, RegExp][], req: Req) => list.some(([m, r]) => (m === '*' || m === req.method) && r.test(req.path));
// ---------------------------------------------------------------- pages each role may open
// Admins always reach every page. A member with a company role (Media Execute…) opens the pages of that role; one
// without opens the pages set for members. Set in Quản trị and enforced on the API as well. The Workspace boards are
// open to everyone.
export type Page = 'workspace' | 'editor' | 'ads';
export const PAGES: Page[] = ['workspace', 'editor', 'ads'];
export async function pageAccess(): Promise<Record<Role, Page[]>> {
  const v = await getSetting<{ member?: Page[] } | null>('page_access', null);
  // Ads numbers (clients' spend) are opened only where an admin allows them.
  const member = Array.isArray(v?.member) ? v!.member.filter((p) => PAGES.includes(p)) : PAGES.filter((p) => p !== 'ads');
  return { admin: PAGES, member };
}
/** The pages this account may open: its department's (a view-only role does not edit videos, so no Trình dựng). */
export async function pagesOf(u: User): Promise<Page[]> {
  if (u.role === 'admin') return PAGES;
  const r = u.team_role ? await get<any>('SELECT pages FROM team_roles WHERE id = ?', u.team_role) : null;
  const pages = r ? (JSON.parse(r.pages || '[]') as Page[]).filter((p) => PAGES.includes(p)) : (await pageAccess()).member;
  return deptLevel(u) === 'observer' ? pages.filter((p) => p !== 'editor') : pages;
}
/** The pages an API belongs to (opening any one of them is enough): client reports are made in the editor and in Báo cáo. */
const PAGE_OF: [RegExp, Page[]][] = [
  [/^\/api\/(customers|workspace|customer-tasks)(\/|$)/, ['workspace']],
  [/^\/api\/reports(\/|$)/, ['editor', 'ads']],
  [/^\/api\/(projects|sheets|sources|proxies|capcut|outro|ai|jobs|renders|templates|editor-link)(\/|$)/, ['editor']],
  [/^\/api\/ads\//, ['ads']],
];

/** Throws unless the request may proceed; returns the signed-in user (null for public endpoints). */
export async function guard(req: Req): Promise<User | null> {
  if (PUBLIC.some((r) => r.test(req.path))) return await currentUser(req);
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Hãy đăng nhập');
  const customerMatch=req.path.match(/^\/api\/customers\/(c_[^/]+)(?:\/|$)/);
  let scopedCustomer:string|null=customerMatch?decodeURIComponent(customerMatch[1]):null;
  const reportMatch=req.path.match(/^\/api\/reports\/(r_[^/]+)(?:\/|$)/);
  const projectMatch=req.path.match(/^\/api\/(?:projects|task-projects)\/([^/]+)(?:\/|$)/);
  const taskMatch=req.path.match(/^\/api\/tasks\/(tk_[^/]+)(?:\/|$)/);
  if(reportMatch)scopedCustomer=(await get<any>('SELECT customer_id FROM reports WHERE id=?',reportMatch[1]))?.customer_id||null;
  if(projectMatch){const table=req.path.startsWith('/api/task-projects/')?'task_projects':'projects';scopedCustomer=(await get<any>(`SELECT customer_id FROM ${table} WHERE id=?`,projectMatch[1]))?.customer_id||null;}
  if(taskMatch)scopedCustomer=(await get<any>('SELECT p.customer_id FROM tasks t JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskMatch[1]))?.customer_id||null;
  if(req.path.startsWith('/api/task-projects/')&&projectMatch)await requireProject(u.id,projectMatch[1],req.method==='GET'?'observer':'normal');
  if(taskMatch){const task=await get<any>('SELECT project_id FROM tasks WHERE id=?',taskMatch[1]);if(task?.project_id)await requireProject(u.id,task.project_id,req.method==='GET'||req.path.endsWith('/reveal')?'observer':'normal');}
  if(taskMatch){
    const linked=await get<any>('SELECT b.created_by,b.id board_id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN boards b ON b.id=c.board_id WHERE l.task_id=?',taskMatch[1]);
    if(linked&&linked.created_by!==u.id&&!await get('SELECT 1 FROM board_members WHERE board_id=? AND user_id=?',linked.board_id,u.id)){
      const own=await get('SELECT 1 FROM task_people p WHERE p.user_id=? AND (p.id IN(SELECT person_id FROM task_assignees WHERE task_id=?) OR p.id=(SELECT created_by FROM tasks WHERE id=?))',u.id,taskMatch[1],taskMatch[1])||req.method==='GET'&&await get('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?',taskMatch[1],u.id);
      if(!own)throw new HttpError(404,'Không tìm thấy công việc');
    }
  }
  if(scopedCustomer){
    const need=req.method==='GET'||req.path.endsWith('/reveal')?'observer':'normal';
    const level=await requireCustomer(u.id,scopedCustomer,need);
    if(customerMatch&&matches(MANAGE,req)&&level!=='admin')throw new HttpError(403,'Chỉ chủ hoặc người quản lý khách hàng được thao tác');
  }
  if (u.role === 'admin') return u;
  if (matches(ADMIN, req)) throw new HttpError(403, 'Chỉ quản trị viên mới làm được việc này');
  const page = PAGE_OF.find(([r]) => r.test(req.path))?.[1];
  if (page) { const mine = await pagesOf(u); if (!page.some((p) => mine.includes(p))) throw new HttpError(403, 'Tài khoản của bạn chưa được cấp quyền vào trang này'); }
  if (matches(MANAGE, req) && !(scopedCustomer&&await customerLevel(u.id,scopedCustomer)==='admin') && deptLevel(u) !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên hoặc admin của phòng mới làm được việc này');
  if (page && req.method !== 'GET' && deptLevel(u) === 'observer' && !VIEW_ONLY_OK.test(req.path)) throw new HttpError(403, 'Role của bạn trong phòng chỉ được xem');
  return u;
}

// ---------------------------------------------------------------- helpers
export const userOut = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, hasPassword: !!u.pass, lastLogin: u.last_login, createdAt: u.created_at,
  teamRole: u.team_role || null, deptRole: u.team_role && u.dept_level ? u.dept_role || null : null, deptRoleName: u.dept_role_name || null,
  level: u.role === 'admin' ? 'admin' : deptLevel(u),
});
/** A department id from a request (null to clear); it must exist. */
async function teamRoleOf(x: any) {
  if (!x) return null;
  if (!(await get('SELECT id FROM team_roles WHERE id = ?', String(x)))) throw new HttpError(404, 'Không tìm thấy phòng ban');
  return String(x);
}
/** A role of department `team` from a request; with none given (or a new department), the department's first member role. */
async function deptRoleOf(team: string | null, x: any) {
  if (!team) return null;
  if (x) {
    if (!(await get('SELECT id FROM dept_roles WHERE id = ? AND team_role_id = ?', String(x), team))) throw new HttpError(404, 'Không tìm thấy role này trong phòng ban');
    return String(x);
  }
  return (await get<any>("SELECT id FROM dept_roles WHERE team_role_id = ? ORDER BY level = 'normal' DESC, pos LIMIT 1", team))?.id || null;
}
const normEmail = (e: any) => String(e || '').trim().toLowerCase();
function validEmail(e: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Email không hợp lệ'); return e; }
/** The email an admin sets for someone's notifications is theirs at once (no code to confirm); empty stops the mail. */
async function setNotifyEmail(userId: string, value: unknown) {
  if (value === undefined) return;
  const email = normEmail(value);
  if (!email) { await run('UPDATE notification_preferences SET email = NULL, verified_at = NULL, enabled = 0, updated_at = ? WHERE user_id = ?', now(), userId); return; }
  await run(`INSERT INTO notification_preferences(user_id, enabled, updated_at, email, verified_at) VALUES(?,1,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at, enabled = 1, pending_email = NULL, verification_hash = NULL, updated_at = excluded.updated_at`,
    userId, now(), validEmail(email), now());
}
const notifyEmails = async () => new Map((await all<any>('SELECT user_id, email FROM notification_preferences WHERE email IS NOT NULL AND verified_at IS NOT NULL')).map((r) => [r.user_id, r.email as string]));
function validPass(p: any) { const s = String(p || ''); if (s.length < 8) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự'); return s; }
const userCount = async () => (await get<any>('SELECT COUNT(*) n FROM users'))?.n || 0;
const activeAdmins = async () => (await get<any>("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0"))?.n || 0;
async function mustUser(id: string) {
  const u = await get<User>(`${USER_SQL} WHERE u.id = ?`, id);
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
    json(res, 200, { user: u ? userOut(u) : null, pages: u ? await pagesOf(u) : [], setup: await userCount() === 0, setupCode: !!process.env.SETUP_CODE, google: !!(c.clientId && c.clientSecret) });
  });
  api.get('/api/profiles/:id',async(req,res)=>{
    const viewer=(await currentUser(req))!;
    const user=await mustUser(req.params.id);
    if(user.disabled&&viewer.role!=='admin')throw new HttpError(404,'Không tìm thấy người dùng');
    const department=user.team_role?await get<any>('SELECT id,name,color FROM team_roles WHERE id=?',user.team_role):null;
    const own=viewer.id===user.id;
    json(res,200,{id:user.id,name:user.name,department:department||null,position:user.dept_role_name||null,canEdit:own,...(own?{email:user.email,role:user.role,level:user.role==='admin'?'admin':deptLevel(user),createdAt:user.created_at}:{})});
  });
  api.put('/api/auth/profile', async (req,res) => {
    const user=await currentUser(req);
    if(!user) throw new HttpError(401,'Hãy đăng nhập để sửa thông tin cá nhân');
    const body=await readJson(req);
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name||name.length>120) throw new HttpError(400,'Họ tên cần từ 1 đến 120 ký tự');
    await run('UPDATE users SET name=?, updated_at=? WHERE id=?',name,now(),user.id);
    json(res,200,userOut(await mustUser(user.id)));
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
  // First run only: whoever opens DM Workspace first creates the admin account.
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
    const u = await get<User>(`${USER_SQL} WHERE u.email = ?`, email);
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
  api.get('/api/users', async (_q, res) => { const mail = await notifyEmails(); json(res, 200, (await all<User>(`${USER_SQL} ORDER BY u.created_at`)).map((u) => ({ ...userOut(u), notifyEmail: mail.get(u.id) || null }))); });
  api.post('/api/users', async (req, res) => {
    const b = await readJson(req);
    const email = validEmail(normEmail(b.email));
    if (await get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email này đã có tài khoản');
    const role: Role = ROLES.includes(b.role) ? b.role : 'member';
    const pass = b.password ? await hashPass(validPass(b.password)) : null;
    const id = uid('u_'), team = await teamRoleOf(b.teamRole);
    await run('INSERT INTO users(id, email, name, role, pass, team_role, dept_role, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, email, String(b.name || '').trim() || email.split('@')[0], role, pass, team, await deptRoleOf(team, b.deptRole), now(), now());
    await setNotifyEmail(id, b.notifyEmail);
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
    const team = b.teamRole !== undefined ? await teamRoleOf(b.teamRole) : u.team_role;
    // Another department: its role is reset unless one is given; the same department keeps the role unless changed.
    const dept = b.deptRole !== undefined || team !== u.team_role ? await deptRoleOf(team, b.deptRole) : u.dept_role || null;
    await run('UPDATE users SET email=?, name=?, role=?, disabled=?, pass=?, team_role=?, dept_role=?, updated_at=? WHERE id=?',
      email, b.name !== undefined ? String(b.name).trim() || u.name : u.name, role, disabled, pass, team, dept, now(), u.id);
    // A new password, a lock or a lower role takes effect immediately on every device.
    if (b.password || disabled || role !== u.role) await run('DELETE FROM sessions WHERE user_id = ?', u.id);
    await setNotifyEmail(u.id, b.notifyEmail);
    json(res, 200, { ...userOut(await mustUser(u.id)), notifyEmail: (await notifyEmails()).get(u.id) || null });
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
  const u = await get<User>(`${USER_SQL} WHERE u.email = ?`, email);
  if (!u) throw new HttpError(403, `${email} chưa được cấp quyền vào DM Workspace. Hãy nhờ quản trị viên thêm email này.`);
  if (u.disabled) throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên');
  await startSession(req, res, u);
}
