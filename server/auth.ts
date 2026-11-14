import {requireProject} from './project-access';
import {customerLevel,requireCustomer} from './customer-access';
// DMI Workspace accounts: email + password (or "Sign in with Google" for an email an admin has added),
// cookie sessions, and admin-only user management. The first visitor creates the admin account.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type http from 'node:http';
import { Router, HttpError, json, readJson, publicOrigin, pathOf, type Req, type Res } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import * as G from './google';
import { turnstileConfig, verifyTurnstile } from './turnstile';
import { ACCOUNT_PREFS } from '../shared/account-prefs';
import { accessOf, accessOut, syncSuperAdmin } from './rbac';
import { audit, logLogin, clientIp, clientAgent } from './audit';
import { assertSiteOpen, siteLock } from './site-lock';
import { flowColors } from '../shared/task-flow';

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
export async function hashPass(pw: string) {
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
  await run('INSERT INTO sessions(id, user_id, created_at, expires_at, ip, agent) VALUES(?,?,?,?,?,?)', tokenId(token), u.id, now(), now() + TTL, clientIp(req), clientAgent(req));
  await run('UPDATE users SET last_login=? WHERE id=?', now(), u.id);
  await run('DELETE FROM sessions WHERE expires_at < ?', now());
  res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure(req)}`);
}
const clearCookie = (req: http.IncomingMessage, res: Res) => res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req)}`);
const cookieToken = (req: http.IncomingMessage) => (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';

// A request asks who is signed in from several places (the guard, the route, its helpers); a GET changes nobody, so it
// reads them once. Other requests may change the account mid-way and read it afresh.
const asked = new WeakMap<http.IncomingMessage, Promise<User | null>>();
export function currentUser(req: http.IncomingMessage): Promise<User | null> {
  if (req.method !== 'GET') return readUser(req);
  let u = asked.get(req);
  if (!u) asked.set(req, u = readUser(req));
  return u;
}
/** Set (in process only) on a request the Claude connector makes for the person who connected it (server/mcp.ts). */
export const ACTING = Symbol('acting');
async function readUser(req: http.IncomingMessage): Promise<User | null> {
  const acting = (req as any)[ACTING] as User | undefined;
  if (acting) return acting;
  const t = cookieToken(req);
  if (!t) return null;
  const u = await get<User>('SELECT u.*, d.level dept_level, d.name dept_role_name FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN dept_roles d ON d.id = u.dept_role AND d.team_role_id = u.team_role WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0', tokenId(t), now());
  return u || null;
}

// ---------------------------------------------------------------- access rules
// The Claude connector checks its own tokens (server/mcp.ts).
const PUBLIC = [/^\/api\/auth\//, /^\/api\/health$/, /^\/api\/google\/callback$/, /^\/api\/oauth\//, /^\/api\/mcp$/, /^\/\.well-known\/(oauth-|openid-configuration)/];
/** What someone already signed in can still reach while the site is locked: enough to see the notice and sign out. */
const LOCK_OPEN = /^\/api\/(auth\/(me|config|login|logout|google|setup|forgot|reset)|health|google\/callback)$/;
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
['DELETE', /^\/api\/customers\/[^/]+$/], ['PUT', /^\/api\/customers\/[^/]+\/folder$/], ['DELETE', /^\/api\/customers\/[^/]+\/folder$/],
  ['POST', /^\/api\/customers\/[^/]+\/folders$/], ['PUT', /^\/api\/customers\/[^/]+\/folders\//], ['DELETE', /^\/api\/customers\/[^/]+\/folders\//],
  ['DELETE', /^\/api\/customers\/[^/]+\/(videos|files)\//], ['POST', /^\/api\/workspace\/folders$/],
];
// A view-only role changes nothing in the tool pages (looking through folders to pick one is not a change).
const VIEW_ONLY_OK = /^\/api\/workspace\/browse$/;
const matches = (list: [string, RegExp][], req: Req) => list.some(([m, r]) => (m === '*' || m === req.method) && r.test(pathOf(req)));
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
/** The pages this account may open: its department's ('editor' is the old key of Báo cáo, kept so roles keep their
 *  access; a view-only role does not get it). */
export async function pagesOf(u: User): Promise<Page[]> {
  if (u.role === 'admin') return PAGES;
  const r = u.team_role ? await get<any>('SELECT pages FROM team_roles WHERE id = ?', u.team_role) : null;
  const pages = r ? (JSON.parse(r.pages || '[]') as Page[]).filter((p) => PAGES.includes(p)) : (await pageAccess()).member;
  return deptLevel(u) === 'observer' ? pages.filter((p) => p !== 'editor') : pages;
}
/** The pages an API belongs to (opening any one of them is enough): client reports belong to Báo cáo ('editor') and Ads. */
const PAGE_OF: [RegExp, Page[]][] = [
  [/^\/api\/(customers|workspace|customer-tasks)(\/|$)/, ['workspace']],
  [/^\/api\/reports(\/|$)/, ['editor', 'ads']],
  [/^\/api\/ads\//, ['ads']],
];
/** The Khách hàng page's own records (list, record, members, projects, tasks, history) need no page: everyone sees the
 *  customers they work on (someone given a task of a customer finds it there), each as far as its own access goes. Its
 *  Drive folder and files, and adding or importing customers, stay with Drive. */
const CRM: [string, RegExp][] = [
  ['*', /^\/api\/customers\/(directory|all|statuses|classifications|sources|managers|bulk-delete)$/],
  ['*', /^\/api\/customers\/[^/]+\/(record|members|projects|tasks|history)(\/|$)/], ['DELETE', /^\/api\/customers\/[^/]+$/],
];

/** Company-admin endpoints that a role may also be given (Phân quyền): departments and their positions (org.*), and
 *  the pages people in no department open (settings.update). The rest stay with Super Admins (company admins). */
const DELEGATED: [RegExp, Record<string, string>][] = [
  [/^\/api\/(roles|positions)(\/|$)/, { POST: 'org.create', PUT: 'org.update', DELETE: 'org.delete' }],
  [/^\/api\/access$/, { PUT: 'settings.update' }],
];
async function delegated(req: Req, u: User) {
  const perm = DELEGATED.find(([r]) => r.test(pathOf(req)))?.[1][req.method || ''];
  return !!perm && (await accessOf(u)).perms.has(perm);
}

/** Throws unless the request may proceed; returns the signed-in user (null for public endpoints). */
export async function guard(req: Req): Promise<User | null> {
  const u = await currentUser(req);
  if (u && !LOCK_OPEN.test(pathOf(req))) await assertSiteOpen(u);
  if (PUBLIC.some((r) => r.test(pathOf(req)))) return u;
  if (!u) throw new HttpError(401, 'Hãy đăng nhập');
  // Customers made from a card on a board have ids starting cust_.
  const customerMatch=pathOf(req).match(/^\/api\/customers\/((?:c|cust)_[^/]+)(?:\/|$)/);
  let scopedCustomer:string|null=customerMatch?decodeURIComponent(customerMatch[1]):null;
  const reportMatch=pathOf(req).match(/^\/api\/reports\/(r_[^/]+)(?:\/|$)/);
  const projectMatch=pathOf(req).match(/^\/api\/(?:projects|task-projects)\/([^/]+)(?:\/|$)/);
  // Not project ids: routes under the path that check access themselves (for-service checks the customer).
  const actualProjectMatch=projectMatch&&!['bulk-delete','for-service'].includes(projectMatch[1])?projectMatch:null;
  const taskMatch=pathOf(req).match(/^\/api\/tasks\/(tk_[^/]+)(?:\/|$)/);
  if(reportMatch)scopedCustomer=(await get<any>('SELECT customer_id FROM reports WHERE id=?',reportMatch[1]))?.customer_id||null;
  if(actualProjectMatch){const table=pathOf(req).startsWith('/api/task-projects/')?'task_projects':'projects';scopedCustomer=(await get<any>(`SELECT customer_id FROM ${table} WHERE id=?`,actualProjectMatch[1]))?.customer_id||null;}
  if(taskMatch)scopedCustomer=(await get<any>('SELECT p.customer_id FROM tasks t JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',taskMatch[1]))?.customer_id||null;
  if(pathOf(req).startsWith('/api/task-projects/')&&actualProjectMatch)await requireProject(u.id,actualProjectMatch[1],req.method==='GET'?'observer':'normal');
  const taskRow=taskMatch?await get<any>('SELECT project_id FROM tasks WHERE id=?',taskMatch[1]):null;
  if(taskRow?.project_id)await requireProject(u.id,taskRow.project_id,req.method==='GET'||pathOf(req).endsWith('/reveal')?'observer':'normal');
  // A task of a project is the project's people's (checked above), wherever its card is; a task of no project linked to
  // a card on someone's board is for that board's people and the task's own.
  if(taskMatch&&!taskRow?.project_id){
    const linked=await get<any>('SELECT b.created_by,b.id board_id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN boards b ON b.id=c.board_id WHERE l.task_id=?',taskMatch[1]);
    if(linked&&linked.created_by!==u.id&&!await get('SELECT 1 FROM board_members WHERE board_id=? AND user_id=?',linked.board_id,u.id)){
      const own=await get('SELECT 1 FROM task_people p WHERE p.user_id=? AND (p.id IN(SELECT person_id FROM task_assignees WHERE task_id=?) OR p.id=(SELECT created_by FROM tasks WHERE id=?))',u.id,taskMatch[1],taskMatch[1])||req.method==='GET'&&await get('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?',taskMatch[1],u.id);
      if(!own)throw new HttpError(404,'Không tìm thấy công việc');
    }
  }
  if(scopedCustomer){
    const need=req.method==='GET'||pathOf(req).endsWith('/reveal')?'observer':'normal';
    const level=await requireCustomer(u.id,scopedCustomer,need);
    if(customerMatch&&matches(MANAGE,req)&&level!=='admin')throw new HttpError(403,'Chỉ chủ hoặc người quản lý khách hàng được thao tác');
  }
  if (u.role === 'admin') return u;
  if (matches(ADMIN, req) && !await delegated(req, u)) throw new HttpError(403, 'Chỉ quản trị viên mới làm được việc này');
  const crm = matches(CRM, req), page = crm ? undefined : PAGE_OF.find(([r]) => r.test(pathOf(req)))?.[1];
  // Adding a customer is also for those given customers.create in Phân quyền, without Drive (its folder stays with Drive:
  // the route asks for Drive when a folder is made or linked).
  const addsCustomer = req.method === 'POST' && pathOf(req) === '/api/customers' && (await accessOf(u)).perms.has('customers.create');
  if (page && !addsCustomer) { const mine = await pagesOf(u); if (!page.some((p) => mine.includes(p))) throw new HttpError(403, 'Tài khoản của bạn chưa được cấp quyền vào trang này'); }
  if (matches(MANAGE, req) && !(scopedCustomer&&await customerLevel(u.id,scopedCustomer)==='admin') && deptLevel(u) !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên hoặc admin của phòng mới làm được việc này');
  if ((page || crm) && req.method !== 'GET' && deptLevel(u) === 'observer' && !VIEW_ONLY_OK.test(pathOf(req)) && !addsCustomer) throw new HttpError(403, 'Role của bạn trong phòng chỉ được xem');
  return u;
}

// ---------------------------------------------------------------- helpers
export const userOut = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, disabled: !!u.disabled, hasPassword: !!u.pass, lastLogin: u.last_login, createdAt: u.created_at,
  teamRole: u.team_role || null, deptRole: u.team_role && u.dept_level ? u.dept_role || null : null, deptRoleName: u.dept_role_name || null,
  level: u.role === 'admin' ? 'admin' : deptLevel(u),
  phone: (u as any).phone || '', avatarAt: (u as any).avatar_at || null,
});
/** A department id from a request (null to clear); it must exist. */
export async function teamRoleOf(x: any) {
  if (!x) return null;
  if (!(await get('SELECT id FROM team_roles WHERE id = ?', String(x)))) throw new HttpError(404, 'Không tìm thấy phòng ban');
  return String(x);
}
/** A role of department `team` from a request; with none given (or a new department), the department's first member role. */
export async function deptRoleOf(team: string | null, x: any) {
  if (!team) return null;
  if (x) {
    if (!(await get('SELECT id FROM dept_roles WHERE id = ? AND team_role_id = ?', String(x), team))) throw new HttpError(404, 'Không tìm thấy role này trong phòng ban');
    return String(x);
  }
  return (await get<any>("SELECT id FROM dept_roles WHERE team_role_id = ? ORDER BY level = 'normal' DESC, pos LIMIT 1", team))?.id || null;
}
export const normEmail = (e: any) => String(e || '').trim().toLowerCase();
export function validEmail(e: string) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new HttpError(400, 'Email không hợp lệ'); return e; }
/** The email an admin sets for someone's notifications is theirs at once (no code to confirm); empty stops the mail. */
export async function setNotifyEmail(userId: string, value: unknown) {
  if (value === undefined) return;
  const email = normEmail(value);
  if (!email) { await run('UPDATE notification_preferences SET email = NULL, verified_at = NULL, enabled = 0, updated_at = ? WHERE user_id = ?', now(), userId); return; }
  await run(`INSERT INTO notification_preferences(user_id, enabled, updated_at, email, verified_at) VALUES(?,1,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at, enabled = 1, pending_email = NULL, verification_hash = NULL, updated_at = excluded.updated_at`,
    userId, now(), validEmail(email), now());
}
/** The account's saved interface choices, or null before it has any. */
async function prefsOf(userId: string): Promise<Record<string, string> | null> {
  const row = await get<any>('SELECT data FROM user_prefs WHERE user_id = ?', userId);
  try { return row ? JSON.parse(row.data) : null; } catch { return null; }
}
export const notifyEmails = async () => new Map((await all<any>('SELECT user_id, email FROM notification_preferences WHERE email IS NOT NULL AND verified_at IS NOT NULL')).map((r) => [r.user_id, r.email as string]));
const resetId = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
export function validPass(p: any) { const s = String(p || ''); if (s.length < 8) throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự'); return s; }
const userCount = async () => (await get<any>('SELECT COUNT(*) n FROM users'))?.n || 0;
const activeAdmins = async () => (await get<any>("SELECT COUNT(*) n FROM users WHERE role='admin' AND disabled=0"))?.n || 0;
export async function mustUser(id: string) {
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
    const c = await G.oauthConfig(), lock = await siteLock();
    json(res, 200, { siteLock: lock.on ? { message: lock.message } : null, user: u ? userOut(u) : null, pages: u ? await pagesOf(u) : [], admin: u ? accessOut(await accessOf(u)) : null, prefs: u ? await prefsOf(u.id) : null, flowColors: u ? flowColors(await (await import('./task-flow')).flowSettings()) : null, setup: await userCount() === 0, setupCode: !!process.env.SETUP_CODE, google: !!(c.clientId && c.clientSecret) });
  });
  // Merges into the account's interface choices; null forgets one.
  api.put('/api/auth/prefs', async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Hãy đăng nhập lại');
    const body = await readJson(req), prefs = await prefsOf(user.id) || {};
    for (const [k, v] of Object.entries(body)) {
      // A choice no longer kept with the account (an older page still open sends it) is left out.
      if (!ACCOUNT_PREFS.includes(k)) { delete prefs[k]; continue; }
      if (v !== null && (typeof v !== 'string' || v.length > 20000)) throw new HttpError(400, 'Tuỳ chọn giao diện không hợp lệ');
      if (v === null) delete prefs[k]; else prefs[k] = v;
    }
    await run('INSERT INTO user_prefs(user_id, data) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data', user.id, JSON.stringify(prefs));
    json(res, 200, { ok: true });
  });
  api.get('/api/profiles/:id',async(req,res)=>{
    const viewer=(await currentUser(req))!;
    const user=await mustUser(req.params.id);
    if(user.disabled&&viewer.role!=='admin')throw new HttpError(404,'Không tìm thấy người dùng');
    const department=user.team_role?await get<any>('SELECT id,name,color FROM team_roles WHERE id=?',user.team_role):null;
    const own=viewer.id===user.id;
    json(res,200,{id:user.id,name:user.name,avatarAt:(user as any).avatar_at||null,phone:(user as any).phone||'',department:department||null,position:user.dept_role_name||null,canEdit:own,...(own?{email:user.email,role:user.role,level:user.role==='admin'?'admin':deptLevel(user),createdAt:user.created_at}:{})});
  });
  api.put('/api/auth/profile', async (req,res) => {
    const user=await currentUser(req);
    if(!user) throw new HttpError(401,'Hãy đăng nhập để sửa thông tin cá nhân');
    const body=await readJson(req);
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name||name.length>120) throw new HttpError(400,'Họ tên cần từ 1 đến 120 ký tự');
    if(body.phone!==undefined){
      const phone=typeof body.phone==='string'?body.phone.trim():'';
      if(phone.length>40||(phone&&!/^[+\d][\d\s().-]*$/.test(phone))) throw new HttpError(400,'Số điện thoại không hợp lệ');
      await run('UPDATE users SET phone=? WHERE id=?',phone||null,user.id);
    }
    await run('UPDATE users SET name=?, updated_at=? WHERE id=?',name,now(),user.id);
    json(res,200,userOut(await mustUser(user.id)));
  });
  // Everyone sets their own picture (PNG, JPEG, WebP or GIF, up to 300 KB, kept in the database).
  api.put('/api/auth/avatar', async (req,res) => {
    const user=await currentUser(req);
    if(!user) throw new HttpError(401,'Hãy đăng nhập để đổi ảnh đại diện');
    const m=String((await readJson(req)).dataUrl||'').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if(!m) throw new HttpError(400,'Ảnh đại diện phải là PNG, JPEG, WebP hoặc GIF');
    if(Buffer.from(m[2],'base64').length>300*1024) throw new HttpError(413,'Ảnh đại diện tối đa 300 KB');
    const at=now();
    await run('INSERT INTO user_avatars(user_id, mime, data, updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at',user.id,m[1],m[2],at);
    await run('UPDATE users SET avatar_at=? WHERE id=?',at,user.id);
    json(res,200,userOut(await mustUser(user.id)));
  });
  api.delete('/api/auth/avatar', async (req,res) => {
    const user=await currentUser(req);
    if(!user) throw new HttpError(401,'Hãy đăng nhập để xoá ảnh đại diện');
    await run('DELETE FROM user_avatars WHERE user_id=?',user.id);
    await run('UPDATE users SET avatar_at=NULL WHERE id=?',user.id);
    json(res,200,userOut(await mustUser(user.id)));
  });
  // Who has a picture (and since when), so every avatar in the app can show it.
  api.get('/api/avatars', async (req,res) => {
    if(!await currentUser(req)) throw new HttpError(401,'Hãy đăng nhập');
    const rows=await all<any>('SELECT id, avatar_at FROM users WHERE avatar_at IS NOT NULL');
    json(res,200,Object.fromEntries(rows.map(r=>[r.id,r.avatar_at])));
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
  // First run only: whoever opens DMI Workspace first creates the admin account.
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
    await syncSuperAdmin(u.id, true, null);
    await logLogin(req, { user: u, email, ok: true, method: 'setup' });
    await startSession(req, res, u);
    json(res, 201, { user: userOut(u) });
  });
  api.post('/api/auth/login', async (req, res) => {
    const b = await readJson(req);
    await verifyTurnstile(req, b.turnstileToken, 'login');
    const email = normEmail(b.email), key = `${email}|${req.socket.remoteAddress}`;
    try { await throttle(key); }
    catch (e) { await logLogin(req, { email, ok: false, method: 'password', reason: 'Tạm khoá do sai nhiều lần' }); throw e; }
    const u = await get<User>(`${USER_SQL} WHERE u.email = ?`, email);
    const ok = !!u && await checkPass(String(b.password || ''), u.pass);
    await throttle(key, !ok);
    if (!ok) { await logLogin(req, { user: u, email, ok: false, method: 'password', reason: !u ? 'Email chưa có tài khoản' : !u.pass ? 'Tài khoản đăng nhập bằng Google' : 'Sai mật khẩu' }); throw new HttpError(401, u && !u.pass ? 'Tài khoản này đăng nhập bằng Google' : 'Sai email hoặc mật khẩu'); }
    if (u!.disabled) { await logLogin(req, { user: u, email, ok: false, method: 'password', reason: 'Tài khoản đã bị khoá' }); throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên'); }
    await assertSiteOpen(u!).catch(async (e) => { await logLogin(req, { user: u, email, ok: false, method: 'password', reason: 'Website đang tạm khoá' }); throw e; });
    await logLogin(req, { user: u, email, ok: true, method: 'password' });
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
  // Forgotten password: a link to the account's sign-in email, good once for 30 minutes. The answer is the same, and
  // takes about as long, whether or not the email has an account, so it tells nobody which emails do; one link every
  // two minutes per account at most.
  api.post('/api/auth/forgot', async (req, res) => {
    const started = Date.now(), b = await readJson(req);
    await verifyTurnstile(req, b.turnstileToken, 'login'); // the sign-in page's widget
    const email = normEmail(b.email);
    const u = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? await get<any>('SELECT id, email, name FROM users WHERE email = ? AND disabled = 0', email) : null;
    if (u && !await get('SELECT 1 FROM password_resets WHERE user_id = ? AND created_at > ?', u.id, now() - 120e3)) {
      const token = crypto.randomBytes(32).toString('base64url');
      await run('DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL', now());
      await run('INSERT INTO password_resets(id, user_id, expires_at, created_at) VALUES(?,?,?,?)', resetId(token), u.id, now() + 30 * 60e3, now());
      await G.sendNotificationMail(u.email, 'DMI Workspace · Đặt lại mật khẩu',
        `Xin chào ${u.name},\n\nBấm link dưới đây để đặt mật khẩu mới. Link dùng được một lần, trong 30 phút:\n${publicOrigin(req)}/#reset/${token}\n\nNếu bạn không yêu cầu, hãy bỏ qua email này; mật khẩu hiện tại vẫn dùng được.`)
        .catch(() => console.error('Không gửi được email đặt lại mật khẩu'));
    }
    await new Promise((ok) => setTimeout(ok, Math.max(0, 1500 - (Date.now() - started))));
    json(res, 200, { ok: true });
  });
  api.post('/api/auth/reset', async (req, res) => {
    const b = await readJson(req), token = String(b.token || ''), id = resetId(token);
    const bad = () => new HttpError(400, 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Hãy yêu cầu link mới.');
    const r = token.length >= 20 && token.length <= 100 ? await get<any>('SELECT user_id FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?', id, now()) : null;
    if (!r) throw bad();
    const pass = await hashPass(validPass(b.password));
    // Spent before the password changes, so the same link never sets it twice.
    if (!(await run('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL', now(), id)).changes) throw bad();
    await run('UPDATE users SET pass=?, updated_at=? WHERE id=?', pass, now(), r.user_id);
    // Signed out everywhere, and the account's other links no longer work.
    await run('DELETE FROM sessions WHERE user_id = ?', r.user_id);
    await run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', r.user_id);
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
    if (role === 'admin') {
      const me = (await currentUser(req))!;
      await syncSuperAdmin(id, true, me.id);
      await audit({ kind: 'permission', action: 'Cấp vai trò Super Admin', user: me, req, entityType: 'user', entityId: id, entityLabel: email, after: { roles: ['Super Admin'] } });
    }
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
    if (role !== u.role) {
      await syncSuperAdmin(u.id, role === 'admin', me.id);
      await audit({ kind: 'permission', action: role === 'admin' ? 'Cấp vai trò Super Admin' : 'Thu hồi vai trò Super Admin', user: me, req, entityType: 'user', entityId: u.id, entityLabel: u.name, before: { role: u.role }, after: { role } });
    }
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
    for (const t of ['user_prefs', 'board_backgrounds']) await run(`DELETE FROM ${t} WHERE user_id = ?`, u.id);
    json(res, 200, { ok: true });
  });
}

/** Google sent the user back after "Sign in with Google": start a session if an admin has added that email. */
export async function finishGoogleSignin(req: http.IncomingMessage, res: Res, email: string) {
  const u = await get<User>(`${USER_SQL} WHERE u.email = ?`, email);
  if (!u) { await logLogin(req, { email, ok: false, method: 'google', reason: 'Email chưa có tài khoản' }); throw new HttpError(403, `${email} chưa được cấp quyền vào DMI Workspace. Hãy nhờ quản trị viên thêm email này.`); }
  if (u.disabled) { await logLogin(req, { user: u, email, ok: false, method: 'google', reason: 'Tài khoản đã bị khoá' }); throw new HttpError(403, 'Tài khoản đã bị khoá, hãy liên hệ quản trị viên'); }
  await assertSiteOpen(u).catch(async (e) => { await logLogin(req, { user: u, email, ok: false, method: 'google', reason: 'Website đang tạm khoá' }); throw e; });
  await logLogin(req, { user: u, email, ok: true, method: 'google' });
  await startSession(req, res, u);
}
