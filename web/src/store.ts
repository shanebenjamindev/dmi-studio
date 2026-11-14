// App state + actions. Tiny external store consumed with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { api, auth } from './api';
import { adoptPrefs } from './prefs';
import { applyTheme } from './theme';
import { langPref } from './i18n';
import type { AdminAccess, TeamRole, User, Project, Page } from './types';

/** Công việc: personal tasks, both kinds of project and department boards; Drive and the editor stay in projects;
 *  'tools': file conversion, open to everyone (it runs in the browser). */
export type View = 'profile' | 'customers' | 'boards' | 'tasks' | 'projects' | 'workspace' | 'admin' | 'editor' | 'tools' | 'reports' | 'ads';
export interface AppState {
  ready: boolean;
  /** Signed-in DMI Workspace account; null shows the sign-in page. */
  user: User | null;
  setup: boolean;
  /** First-run admin creation needs the server's SETUP_CODE (public deploys). */
  setupCode: boolean;
  googleSignin: boolean;
  /** The notice while the website is locked (null: open). */
  siteLock: string | null;
  view: View;
  /** The company's roles (names and colours for the Workspace and Quản trị). */
  roles: TeamRole[];
  ffmpeg: boolean;
  /** This server can run the editor (ffmpeg and a local disk for HyperFrames); false on the cloud Worker. */
  editorAvailable: boolean;
  /** Pages the signed-in account may open (admins: all). */
  pages: Page[];
  /** What the account may do in Quản trị (null: nothing there). */
  admin: AdminAccess | null;
  /** Bumped when projects are added in the background, so the project list reloads. */
  homeVersion: number;
  project: Project | null;
  busy: string | null;
  toast: { text: string; err?: boolean; id: number } | null;
}

export const HASH: Partial<Record<View, string>> = { profile:'#profile', customers: '#customers', boards: '#boards', tasks: '#tasks', projects: '#projects', workspace: '#drive', editor: '#editor', reports: '#reports', ads: '#ads', tools: '#tools', admin: '#admin' };
/** The page an address opens (the reverse of HASH); any other address opens the boards. */
const viewOfHash = (hash: string) => (Object.keys(HASH) as View[]).find((v) => hash.startsWith(HASH[v]!)) ?? 'boards';

let state: AppState = {
  ready: false, user: null, siteLock: null, setup: false, setupCode: false, googleSignin: false, view: viewOfHash(location.hash), roles: [], ffmpeg: false, editorAvailable: false, pages: [], admin: null, homeVersion: 0, project: null,
  busy: null, toast: null,
};
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const view = state.view;
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  // Another page is a step the browser's Back returns from; an address that already names it stays as it is.
  if (state.view !== view && viewOfHash(location.hash) !== state.view) history.pushState(null, '', HASH[state.view] || '#' + state.view);
  subs.forEach((f) => f());
}
// Back, Forward, a pasted link or an edited address: the page follows the address (each page reads the rest of it).
const follow = () => { const view = viewOfHash(location.hash); if (view !== state.view) setState({ view }); };
window.addEventListener('hashchange', follow);
window.addEventListener('popstate', follow);
export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}

// ------------------------------------------------------------------ helpers
const LS_LAST = 'dms.lastProject';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function toast(text: string, err = false) {
  const id = Date.now();
  setState({ toast: { text, err, id } });
  setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, err ? 6500 : 2600);
}

// ------------------------------------------------------------------ boot
auth.onSignedOut = () => { if (state.user) setState({ user: null }); };
auth.onLocked = (message) => { if (state.siteLock !== message) setState({ siteLock: message }); };
export async function signedIn(user: User) {
  // Signing in starts on all the boards, unless the address names one task or card (a link from a notification).
  if (!/^#(tasks\/tk_|boards\/b_[^/]+\/c\/)/.test(location.hash)) { history.replaceState(null, '', '#boards'); setState({ view: 'boards' }); }
  const m = await api.me().catch(() => null);
  if (accountPrefs(user.id, m?.prefs)) return;
  applyFlowColors(m?.flowColors);
  setState({ user, setup: false, ...(m ? { pages: m.pages || [], admin: m.admin || null, siteLock: m.siteLock?.message || null } : {}) });
  await loadApp();
}
/** Each workflow stage's badge colour (set in Quản trị), as CSS variables every stage badge reads (--stage-account…). */
export function applyFlowColors(colors: Record<string, string> | null | undefined) {
  for (const [stage, color] of Object.entries(colors || {})) document.documentElement.style.setProperty(`--stage-${stage}`, color);
}
/** Puts the account's own theme, language and board layout in place; true when the page reloads to show its language. */
function accountPrefs(userId: string, saved: Record<string, string> | null | undefined) {
  adoptPrefs(userId, saved);
  applyTheme();
  if (langPref() === document.documentElement.lang) return false;
  location.reload();
  return true;
}
/** Does the account hold this permission of Quản trị (shared/permissions.ts), at any scope? */
export const canDo = (perm: string) => !!state.admin?.perms[perm];
/** Who may add customers: those given Drive who are not view-only, or given "Tạo khách hàng" in Phân quyền (the
 *  server's rule in auth.ts). */
export const mayAddCustomer = () =>
  state.user?.role === 'admin' || (state.pages.includes('workspace') && state.user?.level !== 'observer') || canDo('customers.create');
/** Pages this account can open. On a server that cannot run the editor (the cloud site), its tab says where it runs. */
export function openPages(): View[] {
  // Khách hàng: everyone sees the customers they work on; Drive (their folders) only those given it.
  const out: View[] = ['boards', 'tasks', 'projects', 'customers', 'profile'];
  if (state.pages.includes('workspace')) out.push('workspace');
  if (state.pages.includes('editor')) out.push('editor');
  // Báo cáo: every client report (made in the editor or here) and, for those allowed, the Meta Ads numbers.
  out.push('reports');
  if (state.pages.includes('ads') || state.user?.role === 'admin') out.push('ads');
  out.push('tools');
  // Quản trị: company admins, and whoever a role gives any of its permissions (each page inside checks its own).
  if (state.user?.role === 'admin' || Object.keys(state.admin?.perms || {}).length) out.push('admin');
  return out;
}
/** Open a page (and keep it in the address, so a reload comes back to it). */
export function goto(view: View) {
  const h = view === 'editor' && state.project ? `#editor/${state.project.id}` : HASH[view];
  if (h && !location.hash.startsWith(h)) history.pushState(null, '', h);
  setState({ view });
}
/** Leave a page this account may not open for the first one it may (in place: Back does not return to it). */
export function fixView() {
  const ok = openPages();
  if (ok.length && !ok.includes(state.view)) { history.replaceState(null, '', HASH[ok[0]] || '#' + ok[0]); setState({ view: ok[0] }); }
}
export async function signOut() {
  await api.logout().catch(() => {});
  setState({ user: null, view: 'boards' });
}

export async function init() {
  // What the server can do is public: ask for it alongside the session, not after it.
  const health = api.health();
  health.catch(() => {});
  try {
    const me = await api.me();
    if (me.user && accountPrefs(me.user.id, me.prefs)) return;
    applyFlowColors(me.flowColors);
    setState({ user: me.user, siteLock: me.siteLock?.message || null, pages: me.pages || [], admin: me.admin || null, setup: me.setup, setupCode: !!me.setupCode, googleSignin: me.google, ready: true });
    if (me.user) void loadApp(health);
  } catch (e: any) {
    toast('Không kết nối được server: ' + e.message, true);
  } finally {
    setState({ ready: true });
  }
}
async function loadApp(health = api.health()) {
  try {
    // Roles fill in after the first screen: only the admin forms use them.
    api.roles().then((roles) => setState({ roles })).catch(() => {});
    const h = await health;
    setState({ ffmpeg: h.ffmpeg, editorAvailable: !!h.editor });
    fixView();
    // The editor opens on the project list; a reload inside a project (#editor/<id>) reopens that project.
    const id = h.editor ? location.hash.match(/^#editor\/(p_\w+)/)?.[1] : undefined;
    const p = id ? await api.getProject(id).catch(() => null) : null;
    if (p) { loadProject(p); setState({ view: 'editor' }); }
  } catch (e: any) {
    toast('Không kết nối được server: ' + e.message, true);
  }
}
function loadProject(p: Project) {
  setState({ project: p });
  ls.set(LS_LAST, p.id);
}
export async function openProject(id: string) { loadProject(await api.getProject(id)); setState({ view: 'editor' }); history.replaceState(null, '', `#editor/${id}`); }
/** Back to the project list. */
export async function closeProject() {
  setState({ project: null });
  history.replaceState(null, '', '#editor');
}
export async function newProject(customerId?: string, title = 'Dự án mới') {
  const p = await api.createProject({ title, aspect: state.project?.aspect || '16:9', customerId });
  loadProject(p); setState({ view: 'editor' });
  history.replaceState(null, '', `#editor/${p.id}`);
  return p;
}
/** Read one tab of a sheet on the server, showing its current step (prefixed) as the busy text; it takes a minute or two. */
async function readWithProgress(link: string, tab: string | undefined, prefix = '') {
  const token = crypto.randomUUID();
  let polling = true;
  (async () => {
    while (polling) {
      await new Promise((r) => setTimeout(r, 1200));
      const t = polling && await api.sheetProgress(token).then((x) => x.text, () => '');
      if (polling && t) setState({ busy: prefix + t });
    }
  })();
  try { return await api.readSheet(link, token, tab); } finally { polling = false; }
}
/**
 * From a request form in Google Sheets to a project: the server reads the form's script and the footage it links; Claude
 * Code builds the video. A new project, unless `here` asks to read the current one's sheet again.
 */
export async function buildFromSheet(link: string, here = false, tab = here ? state.project?.sheet?.tab : undefined) {
  setState({ busy: 'Đang đọc sheet…' });
  try {
    const r = await readWithProgress(link, tab);
    // Each sheet (or tab) is its own project: a new one, unless this is "read the sheet again" inside its project.
    const p = here && state.project ? state.project : await newProject(undefined, r.sheet.title);
    setState({ project: { ...state.project!, title: r.sheet.title, sources: r.sources, sheet: r.sheet, aspect: r.sheet.form.aspect } });
    await api.saveProject(p.id, { title: r.sheet.title, sources: r.sources, sheet: r.sheet, aspect: r.sheet.form.aspect });
    toast(`Đã đọc sheet: ${r.sheet.form.script?.length || 0} cảnh, ${r.sources.length} footage${r.missing.length ? ` · ${r.missing.length} file không tìm thấy` : ''}. Dựng video ở tab “Làm với Claude”.`, !!r.sheet.warning || !!r.missing.length);
  } catch (e: any) { toast(e.message, true); } finally { setState({ busy: null }); }
}
/**
 * A sheet with several tabs: one project per chosen tab, named after the tab, built one after another while the
 * project list stays open. Returns how many were made.
 */
export async function buildTabs(link: string, tabs: string[]) {
  let made = 0;
  const failed: string[] = [];
  for (const [i, tab] of tabs.entries()) {
    const prefix = `Tab ${i + 1}/${tabs.length} · ${tab} — `;
    setState({ busy: prefix + 'Đang đọc…' });
    try {
      const r = await readWithProgress(link, tab, prefix);
      await api.createProject({ title: r.sheet.title, aspect: r.sheet.form.aspect, sources: r.sources, sheet: r.sheet });
      made++;
      setState({ homeVersion: state.homeVersion + 1 }); // show it in the list right away
    } catch { failed.push(tab); }
  }
  setState({ busy: null });
  toast(`Đã tạo ${made} dự án từ ${tabs.length} tab${failed.length ? ` · không đọc được: ${failed.join(', ')}` : ''}.`, !!failed.length && !made);
  return made;
}
/** Read the current project's sheet again (it may have changed): its script and footage. */
export async function rebuildFromSheet() {
  const sheet = state.project?.sheet;
  if (sheet) await buildFromSheet(sheet.link, true, sheet.tab);
}
export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** A step to another address inside the app, which Back returns from (none when it is the address already). */
const step = (hash: string) => { if (location.hash !== hash) history.pushState(null, '', hash); };
// The address first: the page then opens on it as it is.
export function openProfile(id:string) {
  step(`#profile/${encodeURIComponent(id)}`);
  setState({view:'profile'});
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
/** Go to an address inside the app (a board, a card, a project, a customer) from any page. */
export function openLink(hash: string) {
  step(hash);
  setState({ view: viewOfHash(hash) });
  setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 0);
}
/** Open a card on its board. */
export const openCard = (boardId: string, cardId: string) => openLink(`#boards/${boardId}/c/${cardId}`);
/** Open a task's own page, also when the task list is already on screen. */
export function openTask(id:string) {
  step(`#tasks/${id}/page`);
  setState({view:'tasks'});
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
