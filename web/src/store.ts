// App state + actions. Tiny external store consumed with useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import { api, auth } from './api';
import { player, type PlayerOpts } from './engine/player';
import { audio } from './engine/audio';
import { exportVideo } from './engine/exporter';
import type { User, Project, Provider, Defaults, Job, Storyboard, Scene, Aspect, ChatMsg, ModelChoice, Kind, Render } from './types';

export type Tab = 'scene' | 'global' | 'brand' | 'renders';
// 'editor', 'templates' and 'analyze' are hidden for now (pages kept in the code, not reachable from the UI).
export type View = 'workspace' | 'users' | 'editor' | 'templates' | 'analyze';
export interface ExportState { phase: 'idle' | 'setup' | 'recording' | 'uploading' | 'done' | 'error'; progress: number; text: string; url?: string; download?: string; error?: string }
export interface AppState {
  ready: boolean;
  /** Signed-in DM Studio account; null shows the sign-in page. */
  user: User | null;
  setup: boolean;
  /** First-run admin creation needs the server's SETUP_CODE (public deploys). */
  setupCode: boolean;
  googleSignin: boolean;
  view: View;
  tplFocus: string | null;
  analyzeSrc: { url: string; name: string } | null;
  mock: boolean;
  ffmpeg: boolean;
  providers: Provider[];
  defaults: Defaults;
  project: Project | null;
  sel: number;
  tab: Tab;
  save: 'saved' | 'saving' | 'dirty' | 'error';
  busy: string | null;
  jobs: Job[];
  renders: Render[];
  undo: string[];
  redo: string[];
  opts: PlayerOpts;
  dialog: null | 'settings' | 'projects' | 'export';
  toast: { text: string; err?: boolean; id: number } | null;
  exp: ExportState;
  brandMode: boolean;
}

let state: AppState = {
  ready: false, user: null, setup: false, setupCode: false, googleSignin: false, view: (location.hash === '#users' ? 'users' : 'workspace') as View, tplFocus: null, analyzeSrc: null, mock: false, ffmpeg: false, providers: [], defaults: {}, project: null, sel: 0, tab: 'scene',
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
  if (d && list.some((p) => p.id === d.provider)) return d;
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
  setState({ user, setup: false });
  await loadApp();
}
export async function signOut() {
  await api.logout().catch(() => {});
  setState({ user: null, view: 'workspace' });
}

export async function init() {
  try {
    const me = await api.me();
    setState({ user: me.user, setup: me.setup, setupCode: !!me.setupCode, googleSignin: me.google });
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
    const [h, pv] = await Promise.all([api.health(), api.providers()]);
    setState({ mock: h.mock, ffmpeg: h.ffmpeg, providers: pv.providers, defaults: pv.defaults });
    const last = ls.get(LS_LAST);
    let p: Project | null = null;
    if (last) p = await api.getProject(last).catch(() => null);
    if (!p) { const list = await api.listProjects(); if (list[0]) p = await api.getProject(list[0].id); }
    if (p) loadProject(p);
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
  setState({ project: p, sel: 0, undo: [], redo: [], save: 'saved', jobs: [], renders: [] });
  player.setStoryboard(p.storyboard);
  ls.set(LS_LAST, p.id);
  pollJobs(true);
  loadRenders();
}
export async function openProject(id: string) { loadProject(await api.getProject(id)); setState({ dialog: null, view: 'editor' }); }
export async function newProject(customerId?: string, title = 'Dự án mới') {
  const p = await api.createProject({ title, aspect: state.project?.aspect || '16:9', customerId });
  loadProject(p); setState({ dialog: null, view: 'editor' });
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
    await api.saveProject(p.id, { title: p.title, aspect: p.aspect, storyboard: p.storyboard, chat: p.chat });
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
    const { storyboard } = await api.storyboard({ ...c, ...o, brand: state.brandMode, projectId: p.id });
    setState({ project: { ...state.project!, aspect: o.aspect, title: storyboard.title }, sel: 0 });
    player.time = 0;
    setStoryboard(storyboard);
    addChat({ who: 'ai', text: `✓ ${providerName(c.provider)} (${c.model}) đã tạo “${storyboard.title}” — ${storyboard.scenes.length} cảnh, ${Math.round(player.total)} giây.` });
    await flushSave();
    player.play();
  } catch (e: any) {
    toast(e.message, true);
    if (/key/i.test(e.message)) setState({ dialog: 'settings' });
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
    const { storyboard } = await api.refine({ ...c, storyboard: p.storyboard, instruction, brand: state.brandMode, projectId: p.id });
    setStoryboard(storyboard);
    setTitle(storyboard.title);
    addChat({ who: 'ai', text: `✓ Đã cập nhật (${storyboard.scenes.length} cảnh). ⌘/Ctrl+Z để hoàn tác.` });
    player.seek(0); player.play();
  } catch (e: any) { addChat({ who: 'err', text: e.message }); } finally { setState({ busy: null }); }
}

// ------------------------------------------------------------------ AI: media & voice jobs
export const activeJob = (sceneId: string, kinds: string[]) =>
  state.jobs.find((j) => j.sceneId === sceneId && kinds.includes(j.kind) && (j.status === 'queued' || j.status === 'running'));

export async function queueMedia(indices: number[], kind: 'video' | 'image') {
  const p = state.project; const c = choice(kind);
  if (!p?.storyboard || !c) return;
  const jobs = indices.map((i) => p.storyboard!.scenes[i]).filter((s) => s.visual_prompt?.trim() && !activeJob(s.id, ['video', 'image']))
    .map((s) => ({ projectId: p.id, sceneId: s.id, kind, provider: c.provider, model: c.model, prompt: s.visual_prompt, aspect: p.aspect, duration: s.duration }));
  if (!jobs.length) return toast('Không có cảnh nào cần tạo (thiếu mô tả hình ảnh hoặc đang chạy).', true);
  await flushSave();
  try {
    const created = await api.createJobs(jobs);
    setState({ jobs: [...created, ...state.jobs] });
    toast(`Đã gửi ${created.length} yêu cầu tới ${providerName(c.provider)}.`);
    pollJobs(true);
  } catch (e: any) { toast(e.message, true); if (/key/i.test(e.message)) setState({ dialog: 'settings' }); }
}
export async function queueVoice(indices: number[]) {
  const p = state.project; const c = choice('tts');
  if (!p?.storyboard || !c) return;
  const jobs = indices.map((i) => p.storyboard!.scenes[i]).filter((s) => s.caption?.trim() && !activeJob(s.id, ['tts']))
    .map((s) => ({ projectId: p.id, sceneId: s.id, kind: 'tts', provider: c.provider, model: c.model, voice: c.voice, prompt: s.caption, instructions: p.storyboard!.voice_style }));
  if (!jobs.length) return toast('Không có lời thoại nào để đọc.', true);
  await flushSave();
  try {
    const created = await api.createJobs(jobs);
    setState({ jobs: [...created, ...state.jobs] });
    pollJobs(true);
  } catch (e: any) { toast(e.message, true); if (/key/i.test(e.message)) setState({ dialog: 'settings' }); }
}
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
export function fitToVoice(indices: number[]) {
  updateSb((sb) => {
    for (const i of indices) {
      const s = sb.scenes[i];
      if (s.voice?.duration) s.duration = Math.min(15, Math.max(2, Math.ceil((s.voice.duration + 0.8) * 2) / 2));
    }
  });
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
