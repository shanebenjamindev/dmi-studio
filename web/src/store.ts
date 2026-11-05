// App state + actions. Tiny external store consumed with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { api, auth } from './api';
import { player, type PlayerOpts } from './engine/player';
import { audio } from './engine/audio';
import { exportVideo } from './engine/exporter';
import type { TeamRole, User, Project, Provider, Defaults, Job, Storyboard, Scene, Aspect, ChatMsg, ModelChoice, Kind, Render, Source, Picked, MediaRef, Page, Outro } from './types';

export type Tab = 'scene' | 'global' | 'brand' | 'renders';
// 'templates' and 'analyze' are hidden for now (pages kept in the code, not reachable from the UI).
/** Công việc: personal tasks, both kinds of project and department boards; Drive and the editor stay in projects;
 *  'tools': file conversion, open to everyone (it runs in the browser). */
export type View = 'profile' | 'customers' | 'boards' | 'tasks' | 'projects' | 'workspace' | 'admin' | 'editor' | 'tools' | 'reports' | 'ads' | 'templates' | 'analyze';
export interface ExportState { phase: 'idle' | 'setup' | 'recording' | 'uploading' | 'done' | 'error'; progress: number; text: string; url?: string; download?: string; error?: string }
export interface AppState {
  ready: boolean;
  /** Signed-in DM Workspace account; null shows the sign-in page. */
  user: User | null;
  setup: boolean;
  /** First-run admin creation needs the server's SETUP_CODE (public deploys). */
  setupCode: boolean;
  googleSignin: boolean;
  view: View;
  /** The company's roles (names and colours for the Workspace and Quản trị). */
  roles: TeamRole[];
  tplFocus: string | null;
  analyzeSrc: { url: string; name: string } | null;
  mock: boolean;
  ffmpeg: boolean;
  /** This server can run the editor (Claude CLI + ffmpeg + local disk); false on the cloud Worker. */
  editorAvailable: boolean;
  /** Pages the signed-in account may open (admins: all). */
  pages: Page[];
  /** Bumped when projects are added in the background, so the project list reloads. */
  homeVersion: number;
  providers: Provider[];
  defaults: Defaults;
  project: Project | null;
  sel: number;
  /** Assembly: the selected clip (position on the timeline), shared by the timeline and the properties panel. */
  clip: number | null;
  tab: Tab;
  save: 'saved' | 'saving' | 'dirty' | 'error';
  busy: string | null;
  jobs: Job[];
  renders: Render[];
  undo: string[];
  redo: string[];
  opts: PlayerOpts;
  dialog: null | 'projects' | 'export';
  toast: { text: string; err?: boolean; id: number } | null;
  exp: ExportState;
  brandMode: boolean;
}

let state: AppState = {
  ready: false, user: null, setup: false, setupCode: false, googleSignin: false, view: (location.hash.startsWith('#profile') ? 'profile' : location.hash.startsWith('#customers') ? 'customers' : location.hash.startsWith('#admin') ? 'admin' : location.hash.startsWith('#editor') ? 'editor' : location.hash.startsWith('#drive') ? 'workspace' : location.hash.startsWith('#tools') ? 'tools' : location.hash.startsWith('#ads') ? 'ads' : location.hash.startsWith('#reports') ? 'reports' : location.hash.startsWith('#tasks') ? 'tasks' : location.hash.startsWith('#projects') ? 'projects' : 'boards') as View, roles: [], tplFocus: null, analyzeSrc: null, mock: false, ffmpeg: false, editorAvailable: false, pages: [], homeVersion: 0, providers: [], defaults: {}, project: null, sel: 0, clip: null, tab: 'scene',
  save: 'saved', busy: null, jobs: [], renders: [], undo: [], redo: [],
  opts: { captions: true, logo: true, music: true, voice: true }, dialog: null, toast: null,
  exp: { phase: 'idle', progress: 0, text: '' }, brandMode: true,
};
const subs = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const view = state.view;
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  if (state.view !== view) history.replaceState(null, '', state.view === 'workspace' ? location.pathname : '#' + state.view);
  subs.forEach((f) => f());
}
export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}

// ------------------------------------------------------------------ helpers
const LS_LAST = 'dms.lastProject';
const LS_PREFS = 'dms.prefs';
const sid = () => 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function toast(text: string, err = false) {
  const id = Date.now();
  setState({ toast: { text, err, id } });
  setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }); }, err ? 6500 : 2600);
}

export const providersOf = (kind: Kind) => state.providers.filter((p) => p.kind === kind);
export function choice(kind: Kind): ModelChoice | null {
  const d = (state.defaults as any)[kind] as ModelChoice | undefined;
  const list = providersOf(kind);
  if (d && list.some((p) => p.id === d.provider && p.configured)) return d;
  const p = list.find((x) => x.configured && !x.mock) || list.find((x) => x.configured) || list[0];
  return p ? { provider: p.id, model: p.models[0]?.id || '', voice: p.voices?.[0] } : null;
}
export async function setChoice(kind: Kind, c: ModelChoice) {
  const defaults = { ...state.defaults, [kind]: c };
  setState({ defaults });
  api.setDefaults({ [kind]: c } as Defaults).catch(() => {});
}
export const providerName = (id: string) => state.providers.find((p) => p.id === id)?.name || id;

// ------------------------------------------------------------------ boot
auth.onSignedOut = () => { if (state.user) setState({ user: null }); };
export async function signedIn(user: User) {
  // Signing in starts on all the boards, unless the address names one task or card (a link from a notification).
  if (!/^#(tasks\/tk_|boards\/b_[^/]+\/c\/)/.test(location.hash)) { history.replaceState(null, '', '#boards'); setState({ view: 'boards' }); }
  setState({ user, setup: false });
  await api.me().then((m) => setState({ pages: m.pages || [] })).catch(() => {});
  await loadApp();
}
/** Pages this account can open. On a server that cannot run the editor (the cloud site), its tab says where it runs. */
export function openPages(): View[] {
  const out: View[] = ['boards', 'tasks', 'projects', 'profile'];
  if (state.pages.includes('workspace')) out.push('workspace', 'customers');
  if (state.pages.includes('editor')) out.push('editor');
  // Báo cáo: every client report (made in the editor or here) and, for those allowed, the Meta Ads numbers.
  if (state.pages.includes('ads') || state.pages.includes('editor')) out.push('reports');
  if (state.pages.includes('ads')) out.push('ads');
  out.push('tools');
  if (state.user?.role === 'admin') out.push('admin');
  return out;
}
const HASH: Partial<Record<View, string>> = { profile:'#profile', customers: '#customers', boards: '#boards', tasks: '#tasks', projects: '#projects', workspace: '#drive', editor: '#editor', reports: '#reports', ads: '#ads', tools: '#tools', admin: '#admin' };
/** Open a page (and keep it in the address, so a reload comes back to it). */
export function goto(view: View) {
  setState({ view });
  const h = view === 'editor' && state.project ? `#editor/${state.project.id}` : HASH[view];
  if (h && !location.hash.startsWith(h)) history.replaceState(null, '', h);
}
/** Leave a page this account may not open for the first one it may. */
export function fixView() {
  const ok = openPages();
  if (ok.length && !ok.includes(state.view)) setState({ view: ok[0] });
}
export async function signOut() {
  await api.logout().catch(() => {});
  setState({ user: null, view: 'boards' });
}

export async function init() {
  try {
    const me = await api.me();
    setState({ user: me.user, pages: me.pages || [], setup: me.setup, setupCode: !!me.setupCode, googleSignin: me.google });
    if (me.user) await loadApp();
  } catch (e: any) {
    toast('Không kết nối được server: ' + e.message, true);
  } finally {
    setState({ ready: true });
  }
}
async function loadApp() {
  try {
    const prefs = JSON.parse(ls.get(LS_PREFS) || '{}');
    if (prefs.opts) setState({ opts: { ...state.opts, ...prefs.opts } });
    if (typeof prefs.brandMode === 'boolean') setState({ brandMode: prefs.brandMode });
    player.setOpts(state.opts);
    api.roles().then((roles) => setState({ roles })).catch(() => {});
    const [h, pv] = await Promise.all([api.health(), api.providers()]);
    setState({ mock: h.mock, ffmpeg: h.ffmpeg, editorAvailable: !!h.editor, providers: pv.providers, defaults: pv.defaults });
    fixView();
    // The editor opens on the project list; a reload inside a project (#editor/<id>) reopens that project.
    const id = h.editor ? location.hash.match(/^#editor\/(p_\w+)/)?.[1] : undefined;
    const p = id ? await api.getProject(id).catch(() => null) : null;
    if (p) { loadProject(p); setState({ view: 'editor' }); }
  } catch (e: any) {
    toast('Không kết nối được server: ' + e.message, true);
  }
}
export async function refreshProviders() {
  const pv = await api.providers();
  setState({ providers: pv.providers, defaults: { ...pv.defaults, ...state.defaults } });
}
export function savePrefs() { ls.set(LS_PREFS, JSON.stringify({ opts: state.opts, brandMode: state.brandMode })); }
export function setOpts(o: Partial<PlayerOpts>) { setState({ opts: { ...state.opts, ...o } }); player.setOpts(o); savePrefs(); }

function loadProject(p: Project) {
  player.pause();
  player.time = 0;
  setState({ project: p, sel: 0, clip: null, undo: [], redo: [], save: 'saved', jobs: [], renders: [] });
  player.setStoryboard(p.storyboard);
  ls.set(LS_LAST, p.id);
  pollJobs(true);
  loadRenders();
}
export async function openProject(id: string) { loadProject(await api.getProject(id)); setState({ dialog: null, view: 'editor' }); history.replaceState(null, '', `#editor/${id}`); }
/** Back to the project list. */
export async function closeProject() {
  player.pause();
  await flushSave().catch(() => {});
  player.setStoryboard(null);
  setState({ project: null, sel: 0, undo: [], redo: [] });
  history.replaceState(null, '', '#editor');
}
export async function newProject(customerId?: string, title = 'Dự án mới') {
  const p = await api.createProject({ title, aspect: state.project?.aspect || '16:9', customerId });
  loadProject(p); setState({ dialog: null, view: 'editor' });
  history.replaceState(null, '', `#editor/${p.id}`);
  return p;
}
async function ensureProject() { return state.project || (await newProject()); }

// ------------------------------------------------------------------ persistence
let saveTimer: any;
function scheduleSave() {
  setState({ save: 'dirty' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 700);
}
export async function flushSave() {
  const p = state.project; if (!p) return;
  clearTimeout(saveTimer);
  setState({ save: 'saving' });
  try {
    await api.saveProject(p.id, { title: p.title, aspect: p.aspect, storyboard: p.storyboard, chat: p.chat, outro: p.outro });
    if (state.save === 'saving') setState({ save: 'saved' });
  } catch (e: any) { setState({ save: 'error' }); toast('Lưu thất bại: ' + e.message, true); }
}
window.addEventListener('beforeunload', () => { if (state.save !== 'saved') flushSave(); });

// ------------------------------------------------------------------ editing
let coalesceUntil = 0;
function pushUndo(coalesce: boolean) {
  const p = state.project; if (!p?.storyboard) return;
  if (coalesce && Date.now() < coalesceUntil) { coalesceUntil = Date.now() + 900; return; }
  coalesceUntil = coalesce ? Date.now() + 900 : 0;
  setState({ undo: [...state.undo.slice(-80), JSON.stringify(p.storyboard)], redo: [] });
}
function applyStoryboard(sb: Storyboard | null) {
  const p = state.project!;
  setState({ project: { ...p, storyboard: sb, title: p.title }, sel: Math.min(state.sel, Math.max(0, (sb?.scenes.length || 1) - 1)) });
  player.setStoryboard(sb);
  scheduleSave();
}
export function setStoryboard(sb: Storyboard | null, o: { coalesce?: boolean; undo?: boolean } = {}) {
  if (o.undo !== false) pushUndo(!!o.coalesce);
  applyStoryboard(sb);
}
export function updateSb(fn: (sb: Storyboard) => void, coalesce = false) {
  const p = state.project; if (!p?.storyboard) return;
  const sb = clone(p.storyboard); fn(sb); setStoryboard(sb, { coalesce });
}
export function updateScene(i: number, patch: Partial<Scene>, coalesce = true) {
  updateSb((sb) => { Object.assign(sb.scenes[i], patch); }, coalesce);
}
export function undo(redo = false) {
  const from = redo ? state.redo : state.undo; if (!from.length || !state.project) return;
  const cur = JSON.stringify(state.project.storyboard);
  const prev = from[from.length - 1];
  setState(redo ? { redo: from.slice(0, -1), undo: [...state.undo, cur] } : { undo: from.slice(0, -1), redo: [...state.redo, cur] });
  applyStoryboard(JSON.parse(prev));
}
export function setTitle(title: string) {
  const p = state.project; if (!p) return;
  setState({ project: { ...p, title } }); scheduleSave();
}
export function setAspect(aspect: Aspect) {
  const p = state.project; if (!p) return;
  setState({ project: { ...p, aspect } }); scheduleSave();
}
export function select(i: number, seek = true) {
  setState({ sel: i, tab: 'scene' });
  if (seek && state.project?.storyboard) {
    const scenes = state.project.storyboard.scenes;
    let t = 0; for (let k = 0; k < i; k++) t += scenes[k].duration;
    // While paused, park on a "poster" moment where the scene's text has animated in.
    player.seek(player.playing ? t + 0.01 : t + Math.min(1.8, scenes[i].duration * 0.45));
  }
}
export function sceneOp(op: 'up' | 'down' | 'dup' | 'del' | 'add') {
  const i = state.sel;
  let next = i;
  updateSb((sb) => {
    const s = sb.scenes;
    if (op === 'up' && i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; next = i - 1; }
    if (op === 'down' && i < s.length - 1) { [s[i + 1], s[i]] = [s[i], s[i + 1]]; next = i + 1; }
    if (op === 'dup') { s.splice(i + 1, 0, { ...clone(s[i]), id: sid() }); next = i + 1; }
    if (op === 'del' && s.length > 1) { s.splice(i, 1); next = Math.min(i, s.length - 1); }
    if (op === 'add') {
      s.splice(i + 1, 0, { id: sid(), layout: 'title', icon: '✨', headline: 'Cảnh mới', subtext: '', caption: '', visual_prompt: '', duration: 4, animation: 'fade', background: 'gradient' });
      next = i + 1;
    }
  });
  setState({ sel: Math.max(0, Math.min(next, (state.project?.storyboard?.scenes.length || 1) - 1)) });
}
function addChat(m: Omit<ChatMsg, 'at'>) {
  const p = state.project; if (!p) return;
  setState({ project: { ...p, chat: [...(p.chat || []), { ...m, at: Date.now() }] } });
  scheduleSave();
}

// ------------------------------------------------------------------ AI: script
export async function generate(o: { prompt: string; seconds: number; aspect: Aspect; style: string }) {
  const c = choice('llm'); if (!c) return toast('Chưa có nhà cung cấp kịch bản.', true);
  const p = await ensureProject();
  player.pause();
  setState({ busy: `${providerName(c.provider)} · ${c.model} đang viết kịch bản…` });
  try {
    const sources = state.project?.sources || [];
    const sheet = state.project?.sheet || null;
    if (sources.length) setState({ busy: `Claude đang xem ${sources.length} source và ${sheet ? 'dựng theo form' : 'viết kịch bản'}…` });
    const { storyboard, picked } = await api.storyboard({ ...c, ...o, ...(sheet ? { seconds: sheet.form.seconds, aspect: sheet.form.aspect } : {}), brand: state.brandMode, projectId: p.id, sources, sheet });
    setState({ project: { ...state.project!, aspect: o.aspect, title: storyboard.title }, sel: 0 });
    player.time = 0;
    setStoryboard(storyboard);
    addChat({ who: 'ai', text: `✓ ${providerName(c.provider)} (${c.model}) đã tạo “${storyboard.title}” — ${storyboard.scenes.length} cảnh, ${Math.round(player.total)} giây.${pickedNote(picked, sources.length)}` });
    await flushSave();
    player.play();
  } catch (e: any) {
    toast(e.message, true);
  } finally { setState({ busy: null }); }
}
export async function refine(instruction: string) {
  const p = state.project; const c = choice('llm');
  if (!p?.storyboard) return toast('Hãy tạo video trước đã.', true);
  if (!c) return;
  addChat({ who: 'user', text: instruction });
  player.pause();
  setState({ busy: `${providerName(c.provider)} đang chỉnh sửa…` });
  try {
    const sources = p.sources || [];
    // A cut from a sheet: the logo outro is ours, not the client's footage, so Claude edits the cut without it and it
    // goes back at the end afterwards.
    const assembly = p.storyboard.mode === 'edit';
    const hadOutro = assembly && p.storyboard.scenes.some((sc) => sc.shots?.some((x) => x.media.provider === 'outro'));
    const cut = assembly ? clone(p.storyboard) : p.storyboard;
    if (assembly) placeOutro(cut, null);
    const { storyboard, picked } = await api.refine({ ...c, storyboard: cut, instruction, brand: state.brandMode, projectId: p.id, sources, sheet: p.sheet || null });
    if (hadOutro && p.outro) placeOutro(storyboard, p.outro);
    setStoryboard(storyboard);
    setTitle(storyboard.title);
    const secs = Math.round(storyboard.scenes.reduce((a, sc) => a + (sc.shots ? sc.shots.reduce((t, x) => t + x.dur, 0) : sc.duration || 0), 0));
    addChat({ who: 'ai', text: assembly
      ? `✓ Claude đã sửa bản dựng: ${storyboard.scenes.length} cảnh, khoảng ${secs} giây. ⌘/Ctrl+Z để hoàn tác.`
      : `✓ Đã cập nhật (${storyboard.scenes.length} cảnh). ⌘/Ctrl+Z để hoàn tác.${pickedNote(picked, sources.length)}` });
    player.seek(0); player.play();
  } catch (e: any) { addChat({ who: 'err', text: e.message }); } finally { setState({ busy: null }); }
}

const pickedNote = (picked: Picked[] | null, total: number) =>
  picked ? `\nĐã chọn ${picked.length}/${total} source:${picked.map((x) => `\n• ${x.name}: ${x.reason}`).join('')}` : '';

// ------------------------------------------------------------------ Drive sources
export async function scanSources(link: string) {
  if (/docs\.google\.com\/spreadsheets\//.test(link)) return await buildFromSheet(link);
  setState({ busy: 'Đang quét thư mục Google Drive…' });
  try {
    const r = await api.scanSources(link);
    if (!r.sources.length) return toast('Không có video nào trong link này.', true);
    const p = await ensureProject();
    setState({ project: { ...state.project!, sources: r.sources } });
    await api.saveProject(p.id, { sources: r.sources });
    toast(`Đã quét “${r.folder}”: ${r.sources.length} file${r.total > r.sources.length ? ` (giới hạn ${r.sources.length}/${r.total})` : ''}.`);
  } catch (e: any) { toast(e.message, true); } finally { setState({ busy: null }); }
}
export async function clearSources() {
  const p = state.project; if (!p) return;
  setState({ project: { ...p, sources: [], sheet: null } });
  await api.saveProject(p.id, { sources: [], sheet: null }).catch((e) => toast(e.message, true));
}
/**
 * From a request form in Google Sheets to an assembly: the server reads the form and its source links and lays the
 * videos it lists end to end, in the sheet's order, whole clips. No AI cut; editing is left to the editor.
 * Opens a new project unless the current one is still empty (or `here` asks to rebuild the current one).
 */
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
export async function buildFromSheet(link: string, here = false, tab = here ? state.project?.sheet?.tab : undefined) {
  player.pause();
  setState({ busy: 'Đang đọc sheet…' });
  try {
    const r = await readWithProgress(link, tab);
    // Each sheet (or tab) is its own project: a new one, unless this is "read the sheet again" inside its project.
    const p = here && state.project ? state.project : await newProject(undefined, r.sheet.title);
    setState({ project: { ...state.project!, title: r.sheet.title, sources: r.sources, sheet: r.sheet, aspect: r.sheet.form.aspect }, sel: 0 });
    await api.saveProject(p.id, { title: r.sheet.title, sources: r.sources, sheet: r.sheet, aspect: r.sheet.form.aspect });
    if (r.storyboard) {
      // Reading the sheet again keeps the logo outro at the end (when it was made for this frame shape).
      const o = here ? state.project?.outro : null;
      if (o && o.aspect === r.sheet.form.aspect && r.storyboard.mode === 'edit') placeOutro(r.storyboard, o);
      player.time = 0; setStoryboard(r.storyboard); await flushSave();
    }
    const clips = r.storyboard?.scenes.reduce((a, s) => a + (s.shots?.length || 0), 0) || 0;
    if (r.storyboard && r.storyboard.mode !== 'edit') {
      toast(`Sheet không có video: đã tự tạo video ${r.storyboard.scenes.length} cảnh, ${Math.round(player.total)} giây từ kịch bản.${r.sheet.warning ? ' Claude chưa dùng được nên dựng theo từng hàng.' : ''}`, !!r.sheet.warning);
      player.play();
    } else if (r.sheet.warning) toast(r.sheet.warning, true);
    else if (r.storyboard) toast(`Đã ghép ${clips} clip theo nội dung sheet${r.missing.length ? ` · ${r.missing.length} file không tìm thấy` : ''}.`);
    else toast('Không tìm thấy video nào từ sheet này.', true);
  } catch (e: any) { toast(e.message, true); } finally { setState({ busy: null }); }
}
/**
 * A sheet with several tabs: one project per chosen tab, named after the tab, built one after another while the
 * project list stays open. Returns how many were made.
 */
export async function buildTabs(link: string, tabs: string[]) {
  let made = 0, fallback = false;
  const failed: string[] = [];
  for (const [i, tab] of tabs.entries()) {
    const prefix = `Tab ${i + 1}/${tabs.length} · ${tab} — `;
    setState({ busy: prefix + 'Đang đọc…' });
    try {
      const r = await readWithProgress(link, tab, prefix);
      if (!r.storyboard) { failed.push(tab); continue; }
      if (r.sheet.warning) fallback = true;
      await api.createProject({ title: r.sheet.title, aspect: r.sheet.form.aspect, storyboard: r.storyboard, sources: r.sources, sheet: r.sheet });
      made++;
      setState({ homeVersion: state.homeVersion + 1 }); // show it in the list right away
    } catch { failed.push(tab); }
  }
  setState({ busy: null });
  toast(`Đã tạo ${made} dự án từ ${tabs.length} tab${failed.length ? ` · không ghép được: ${failed.join(', ')}` : ''}${fallback ? ' · Claude chưa dùng được nên đọc theo mẫu form' : ''}.`, (!!failed.length && !made) || fallback);
  return made;
}
/** Read the current project's sheet again (it may have changed) and rebuild the assembly in place. */
export async function rebuildFromSheet() {
  const sheet = state.project?.sheet;
  if (sheet) await buildFromSheet(sheet.link, true, sheet.tab);
}
// ------------------------------------------------------------------ clip timeline (edit mode)
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Re-derive a scene's length and preview media from its shots. */
function fixScene(sc: Scene) {
  sc.duration = r2((sc.shots || []).reduce((a, x) => a + x.dur, 0)) || 1;
  sc.media = sc.shots?.[0]?.media ?? null;
}
/**
 * Trim one clip: `edge` 'end' moves its out-point, 'start' its in-point (the clip shortens from the left).
 * `orig` is the shot as it was when the drag began; `dt` the seconds dragged. Stays inside the source clip.
 */
export function trimShot(si: number, k: number, edge: 'start' | 'end', orig: { from: number; dur: number }, dt: number) {
  updateSb((sb) => {
    const sc = sb.scenes[si], sh = sc?.shots?.[k]; if (!sh) return;
    const len = sh.media.type === 'video' && sh.media.duration ? sh.media.duration : Infinity;
    if (edge === 'end') sh.dur = r2(Math.max(0.3, Math.min(orig.dur + dt, len - orig.from)));
    else {
      const from = Math.max(0, Math.min(orig.from + dt, orig.from + orig.dur - 0.3));
      sh.from = r2(from); sh.dur = r2(orig.dur - (from - orig.from));
    }
    fixScene(sc);
  }, true);
}
/** All shots in play order with the scene they belong to. */
export const flatShots = (sb: Storyboard) => sb.scenes.flatMap((sc, si) => (sc.shots || []).map((sh, k) => ({ si, k, sh })));
function rebuild(sb: Storyboard, flat: { si: number; sh: NonNullable<Scene['shots']>[number] }[]) {
  sb.scenes.forEach((sc) => (sc.shots = []));
  for (const x of flat) sb.scenes[x.si].shots!.push(x.sh);
  sb.scenes = sb.scenes.filter((sc) => sc.shots!.length || sb.scenes.length === 1);
  sb.scenes.forEach(fixScene);
}
/** Move the clip at flat position `from` to position `to`; it joins the row (scene) of the clip it lands after. */
export function moveShot(from: number, to: number) {
  if (from === to) return;
  updateSb((sb) => {
    const flat = flatShots(sb);
    const [it] = flat.splice(from, 1);
    const at = Math.max(0, Math.min(flat.length, to));
    flat.splice(at, 0, { ...it, si: (flat[at - 1] || flat[at + 1] || it).si });
    rebuild(sb, flat);
  });
}
/** Set a clip's in-point and/or length (seconds), kept inside the source clip. */
export function setShot(index: number, patch: { from?: number; dur?: number }) {
  updateSb((sb) => {
    const x = flatShots(sb)[index]; if (!x) return;
    const sh = sb.scenes[x.si].shots![x.k];
    const len = sh.media.type === 'video' && sh.media.duration ? sh.media.duration : Infinity;
    if (patch.from !== undefined) sh.from = r2(Math.max(0, Math.min(patch.from, len - 0.3)));
    if (patch.dur !== undefined || patch.from !== undefined) sh.dur = r2(Math.max(0.3, Math.min(patch.dur ?? sh.dur, len - (sh.from || 0))));
    fixScene(sb.scenes[x.si]);
  });
}
/** Split the clip under `t` (seconds on the timeline) into two at that point, like CapCut's split (⌘B). */
export function splitAt(t: number) {
  const sb = state.project?.storyboard; if (!sb) return -1;
  const flat = flatShots(sb);
  let start = 0, idx = -1;
  for (let i = 0; i < flat.length; i++) { if (t > start && t < start + flat[i].sh.dur) { idx = i; break; } start += flat[i].sh.dur; }
  if (idx < 0) return -1;
  const local = t - start;
  if (local < 0.2 || flat[idx].sh.dur - local < 0.2) return -1;
  updateSb((sb2) => {
    const f = flatShots(sb2);
    const { si, sh } = f[idx];
    f.splice(idx, 1, { si, k: 0, sh: { ...sh, dur: r2(local) } }, { si, k: 0, sh: { ...sh, from: r2((sh.from || 0) + local), dur: r2(sh.dur - local) } });
    rebuild(sb2, f);
  });
  return idx + 1;
}
/** Put a source on the timeline right after the clip under the playhead (5 s from its start, like the assembly). */
export function addSourceAtPlayhead(src: Source) {
  const sb = state.project?.storyboard; if (!sb) return;
  const flat = flatShots(sb);
  let start = 0, at = flat.length;
  for (let i = 0; i < flat.length; i++) { start += flat[i].sh.dur; if (player.time < start) { at = i + 1; break; } }
  const media: MediaRef = { type: src.kind, assetId: src.id, url: src.url, mime: src.mime, provider: 'drive', prompt: src.name, ...(src.duration ? { duration: src.duration } : {}) };
  updateSb((sb2) => {
    const f = flatShots(sb2);
    const si = (f[at - 1] || f[0])?.si ?? 0;
    f.splice(at, 0, { si, k: 0, sh: { media, from: 0, dur: Math.min(5, src.duration || 5), move: 'none' } });
    rebuild(sb2, f);
  });
  player.seek(start + 0.01);
}
export function deleteShot(index: number) {
  updateSb((sb) => {
    const flat = flatShots(sb);
    if (flat.length < 2) return;
    flat.splice(index, 1);
    rebuild(sb, flat);
  });
  setState({ sel: Math.min(state.sel, (state.project?.storyboard?.scenes.length || 1) - 1) });
}

// ------------------------------------------------------------------ logo outro
/** Take the outro clip off the timeline (wherever it was moved to) and, given an outro, put it back at the end. */
function placeOutro(sb: Storyboard, o: Outro | null) {
  sb.scenes = sb.scenes
    .map((sc) => (sc.shots ? { ...sc, shots: sc.shots.filter((x) => x.media.provider !== 'outro') } : sc))
    .filter((sc) => !sc.shots || sc.shots.length);
  sb.scenes.forEach((sc) => sc.shots && fixScene(sc));
  if (!o) return;
  const dur = o.media.duration || 3;
  sb.scenes.push({ id: sid(), layout: 'outro', headline: 'Outro logo', caption: '', duration: dur, animation: 'none', background: '', media: o.media, shots: [{ media: o.media, from: 0, dur, move: 'none' }] });
}
/** Use a new outro (or none): the project keeps it and its clip goes at the end of the timeline (undoable). */
export function setOutro(o: Outro | null) {
  const p = state.project; if (!p?.storyboard) return;
  setState({ project: { ...p, outro: o } });
  updateSb((sb) => placeOutro(sb, o));
}

/** Manually put a source (or nothing) behind scene `i`. */
export function setSceneSource(i: number, s: Source | null) {
  updateScene(i, { media: s ? { type: s.kind, assetId: s.id, url: s.url, mime: s.mime, provider: 'drive', prompt: s.name, ...(s.duration ? { duration: s.duration } : {}) } : null });
}

// ------------------------------------------------------------------ AI: media & voice jobs
export const activeJob = (sceneId: string, kinds: string[]) =>
  state.jobs.find((j) => j.sceneId === sceneId && kinds.includes(j.kind) && (j.status === 'queued' || j.status === 'running'));

export async function cancelJob(id: string) { const j = await api.cancelJob(id); setState({ jobs: state.jobs.map((x) => (x.id === id ? j : x)) }); }

let pollTimer: any;
export async function pollJobs(force = false) {
  clearTimeout(pollTimer);
  const p = state.project; if (!p) return;
  const active = state.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  if (!force && !active) return;
  try {
    const prev = new Map(state.jobs.map((j) => [j.id, j.status]));
    const jobs = await api.jobs(p.id);
    if (state.project?.id !== p.id) return;
    setState({ jobs });
    // apply newly finished results to the editor
    const finished = jobs.filter((j) => j.status === 'succeeded' && prev.get(j.id) && prev.get(j.id) !== 'succeeded');
    const failed = jobs.filter((j) => j.status === 'failed' && prev.get(j.id) && prev.get(j.id) !== 'failed');
    if (finished.some((j) => j.kind !== 'transcode')) {
      updateSb((sb) => {
        for (const j of finished) {
          const s = sb.scenes.find((x) => x.id === j.sceneId); if (!s || !j.result) continue;
          if (j.kind === 'tts') s.voice = j.result; else if (j.kind === 'video' || j.kind === 'image') s.media = j.result;
        }
      });
      for (const j of finished) if (j.kind === 'tts' && j.result) measureVoice(j.sceneId, j.result.url);
    }
    if (finished.some((j) => j.kind === 'transcode')) loadRenders();
    failed.forEach((j) => toast(`${providerName(j.provider)}: ${j.error}`, true));
    if (jobs.some((j) => j.status === 'queued' || j.status === 'running')) pollTimer = setTimeout(() => pollJobs(), 2500);
  } catch { pollTimer = setTimeout(() => pollJobs(), 5000); }
}
async function measureVoice(sceneId: string, url: string) {
  const buf = await audio.loadVoice(url);
  if (!buf) return;
  const i = state.project?.storyboard?.scenes.findIndex((s) => s.id === sceneId) ?? -1;
  if (i < 0) return;
  const s = state.project!.storyboard!.scenes[i];
  if (s.voice) updateScene(i, { voice: { ...s.voice, duration: Math.round(buf.duration * 100) / 100 } }, true);
}

// ------------------------------------------------------------------ export & renders
export async function loadRenders() {
  const p = state.project; if (!p) return;
  try { setState({ renders: await api.renders(p.id) }); } catch { /* ignore */ }
}
let exportSignal = { cancelled: false };
export async function startExport(shortSide: number) {
  const p = state.project; if (!p?.storyboard) return;
  exportSignal = { cancelled: false };
  setState({ exp: { phase: 'recording', progress: 0, text: 'Đang chuẩn bị…' } });
  try {
    const blob = await exportVideo(p.storyboard, p.aspect, shortSide, (t, T) => {
      setState({ exp: { phase: 'recording', progress: t / T, text: `${fmt(t)} / ${fmt(T)}` } });
    }, exportSignal);
    if (!blob) return setState({ exp: { phase: 'setup', progress: 0, text: '' } });
    setState({ exp: { phase: 'uploading', progress: 1, text: 'Đang lưu lên server…' } });
    const r = await api.uploadRender(p.id, blob, state.ffmpeg);
    if (r.transcodeJob) {
      setState({ exp: { phase: 'uploading', progress: 1, text: 'Đang chuyển sang MP4 (ffmpeg)…' } });
      for (let k = 0; k < 600; k++) {
        await new Promise((res) => setTimeout(res, 1000));
        const rs = await api.renders(p.id);
        const it = rs.find((x) => x.id === r.id);
        if (it?.status === 'ready') break;
      }
    }
    await loadRenders();
    const it = state.renders.find((x) => x.id === r.id);
    setState({ exp: { phase: 'done', progress: 1, text: '', url: it?.url, download: it?.download } });
  } catch (e: any) {
    setState({ exp: { phase: 'error', progress: 0, text: '', error: e.message } });
  }
}
export function cancelExport() { exportSignal.cancelled = true; }

export const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
export { sid };

export function openProfile(id:string) {
  history.replaceState(null,'',`#profile/${encodeURIComponent(id)}`);
  setState({view:'profile'});
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
/** Go to an address inside the app (a board, a card, a project, a customer) from any page. */
export function openLink(hash: string) {
  const view = (Object.entries(HASH).find(([, h]) => h && hash.startsWith(h))?.[0] || 'boards') as View;
  setState({ view });
  history.replaceState(null, '', hash);
  setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 0);
}
/** Open a task's own page, also when the task list is already on screen. */
export function openTask(id:string) {
  history.replaceState(null,'',`#tasks/${id}/page`);
  setState({view:'tasks'});
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
