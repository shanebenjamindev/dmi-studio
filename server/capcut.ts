// Export an assembly as a CapCut (9.x desktop) project: the clips in timeline order with their in/out points, plus the
// media they need. Media are the used parts of each Drive source with 2 s of handle on both sides, cut at the original
// resolution (Apple's hardware H.264 encoder), so the editor can still extend every cut a little in CapCut.
// The project layout copies a real CapCut 9.2 draft (server/capcut/template.json, identifiers removed); media paths use
// CapCut's own "draft folder" placeholder, so the project works wherever its folder ends up. It is either zipped for
// download or moved straight into the projects folder of the CapCut installed on this machine (which shows it under the
// CapCut account signed in there; CapCut has no public API for putting a project into an account from outside).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, json, readJson, sendFile } from './http';
import { DATA_DIR, FFMPEG } from './config';
import { get, run } from './db';
import { cutFromDrive } from './localcopy';
import { outroFile, FRAME } from './outro';

const DIR = path.join(DATA_DIR, 'exports');
// Read on first export only (the Cloudflare build has no files on disk and never exports).
let tpl: any = null;
const template = () => (tpl ??= JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'capcut', 'template.json'), 'utf8')));
const PLACEHOLDER = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';
const HANDLE = 2; // seconds kept before and after every cut
const PARALLEL = 2;
const US = 1e6;

/** `to`: a .zip to download, or straight into CapCut on this machine (`folder` is then where the project went). */
export type Job = { id: string; project: string; to: 'zip' | 'capcut'; phase: 'media' | 'pack' | 'done' | 'error'; done: number; total: number; error?: string; zip?: string; folder?: string; name?: string; at: number };
const jobs = new Map<string, Job>();

const uuid = () => crypto.randomUUID().toUpperCase();
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const safe = (s: string) => s.replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'DMI Workspace';
/** Project folder name: the sheet title without the form's generic prefix, e.g. "DYNAMIC M DETAIL CERAMIC COATING". */
const draftName = (title: string) => safe(title.replace(/\[ADS\]\s*/i, '').replace(/FORM YÊU CẦU DỰNG VIDEO\s*\|?/i, ''));
const CANVAS = FRAME;

const CAPCUT_APP = 'com.lemon.lvoverseas'; // CapCut for Mac

/**
 * The folder CapCut on this Mac keeps its projects in: the location chosen in its settings ("currentCustomDraftPath"),
 * else its default. Empty when CapCut is not installed here. CAPCUT_DRAFTS_DIR overrides it (tests).
 */
export function draftsDir() {
  if (process.env.CAPCUT_DRAFTS_DIR) return process.env.CAPCUT_DRAFTS_DIR;
  const data = path.join(os.homedir(), 'Movies/CapCut/User Data');
  let dir = path.join(data, 'Projects/com.lveditor.draft');
  try {
    const set = fs.readFileSync(path.join(data, 'Config/globalSetting'), 'utf8').match(/^currentCustomDraftPath=(.+)$/m)?.[1].trim();
    if (set && fs.existsSync(set)) dir = set;
  } catch { /* never changed: the default location */ }
  return fs.existsSync(dir) ? dir : '';
}

/** `name`, else "name (1)", "name (2)"… the way CapCut names copies, so an existing project is never replaced. */
function freeName(dir: string, name: string) {
  let n = name;
  for (let i = 1; fs.existsSync(path.join(dir, n)); i++) n = `${name} (${i})`;
  return n;
}

/** CapCut's project-list picture: one frame of the first clip. */
function cover(file: string, at: number, out: string) {
  return new Promise<boolean>((resolve) => execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=-2:480', '-q:v', '4', out], (e) => resolve(!e && fs.existsSync(out))));
}

/** Cut [s, e] of a Drive clip to an MP4 at its own resolution (Apple's hardware encoder, software if unavailable). */
async function cut(account: string, id: string, s: number, e: number, out: string) {
  const tail = ['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
  try { await cutFromDrive(account, id, s, e, out, ['-c:v', 'h264_videotoolbox', '-q:v', '70', '-allow_sw', '1', ...tail]); }
  catch { await cutFromDrive(account, id, s, e, out, ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', ...tail]); }
}

/** Duration (s), size and audio of a media file, read from ffmpeg's header dump. */
function probe(file: string) {
  return new Promise<{ dur: number; w: number; h: number; audio: boolean }>((resolve) => {
    execFile(FFMPEG, ['-hide_banner', '-i', file], (_e, _o, err) => {
      const t = String(err).match(/Duration: (\d+):(\d+):([\d.]+)/);
      const v = String(err).match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
      resolve({ dur: t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0, w: v ? +v[1] : 1920, h: v ? +v[2] : 1080, audio: /Audio: /.test(String(err)) });
    });
  });
}

type Shot = { media: { assetId: string; url: string; prompt?: string; duration?: number }; from?: number; dur: number };

export async function build(job: Job, p: any) {
  const sb = JSON.parse(p.data).storyboard;
  const shots: Shot[] = (sb?.scenes || []).flatMap((s: any) => s.shots || []);
  if (!shots.length) throw new Error('Dự án chưa có clip nào');
  const name = draftName(p.title);
  const work = path.join(DIR, job.id), folder = path.join(work, name), mediaDir = path.join(folder, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  // 1. The parts of each source the timeline uses, with handles; overlapping parts become one file. A clip made here
  //    (the logo outro) is a local file that goes in whole.
  const bySource = new Map<string, { account: string; name: string; len: number; ranges: [number, number][] }>();
  const files: { id: string; s: number; e: number; file: string; account: string; local?: string }[] = [];
  for (const sh of shots) {
    const local = outroFile(sh.media.url);
    if (local) {
      if (!files.some((f) => f.id === sh.media.assetId)) files.push({ id: sh.media.assetId, s: 0, e: sh.media.duration || sh.dur, file: `Outro_${path.basename(local)}`, account: '', local });
      continue;
    }
    const q = new URLSearchParams(sh.media.url.split('?')[1] || '');
    const len = sh.media.duration || (sh.from || 0) + sh.dur + HANDLE;
    const src = bySource.get(sh.media.assetId) || { account: q.get('a') || '', name: sh.media.prompt || sh.media.assetId, len, ranges: [] };
    src.ranges.push([Math.max(0, (sh.from || 0) - HANDLE), Math.min(len, (sh.from || 0) + sh.dur + HANDLE)]);
    bySource.set(sh.media.assetId, src);
  }
  for (const [id, src] of bySource) {
    const merged: [number, number][] = [];
    for (const r of src.ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
    }
    for (const [s, e] of merged) {
      const base = safe(src.name.replace(/\.\w{2,4}$/, '')).replace(/\s/g, '_');
      files.push({ id, s: Math.floor(s * 10) / 10, e: Math.ceil(e * 10) / 10, file: `${base}_${Math.floor(s)}-${Math.ceil(e)}s.mp4`, account: src.account });
    }
  }
  job.total = files.length;

  // 2. Cut them (two at a time).
  const info = new Map<string, Awaited<ReturnType<typeof probe>>>();
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let i = next++; i < files.length; i = next++) {
      const f = files[i], out = path.join(mediaDir, f.file);
      if (f.local) fs.copyFileSync(f.local, out);
      // One more try after a pause: a cut has been seen failing once and working right after.
      else await cut(f.account, f.id, f.s, f.e, out).catch(async () => { await new Promise((r) => setTimeout(r, 3000)); await cut(f.account, f.id, f.s, f.e, out); });
      info.set(f.file, await probe(out));
      job.done++;
    }
  }));

  // 3. The CapCut project.
  job.phase = 'pack';
  const TEMPLATE = template();
  const [cw, ch] = CANVAS[p.aspect] || CANVAS['9:16'];
  const draftId = uuid(), timelineId = uuid(), now = Date.now(), nowUs = now * 1000;
  const draft = clone(TEMPLATE.draft);
  Object.assign(draft, { id: timelineId, name: '', create_time: 0, update_time: 0, fps: 30 });
  // Lists of segment ids the template's features applied to belong to the template's own segments.
  if (draft.function_assistant_info) for (const k of Object.keys(draft.function_assistant_info)) if (k.endsWith('segid_list')) draft.function_assistant_info[k] = [];
  draft.canvas_config = { ...draft.canvas_config, width: cw, height: ch, ratio: 'original' };
  const materialOf = new Map<string, any>();
  for (const f of files) {
    const m = info.get(f.file)!;
    const v = clone(TEMPLATE.video);
    // unique_id identifies the file to CapCut: one per media file, never shared.
    Object.assign(v, { id: uuid(), unique_id: crypto.createHash('md5').update(`${draftId}/${f.file}`).digest('hex'), local_material_id: '', path: `${PLACEHOLDER}/media/${f.file}`, media_path: '', material_name: f.file,
      duration: Math.round(m.dur * US), width: m.w, height: m.h, has_audio: m.audio, type: 'video' });
    draft.materials.videos.push(v);
    materialOf.set(f.file, { v, m });
  }
  const track = clone(TEMPLATE.track);
  Object.assign(track, { id: uuid(), segments: [] });
  let at = 0;
  const fileOf = (sh: Shot) => files.find((x) => x.id === sh.media.assetId && (sh.from || 0) >= x.s - 0.05 && (sh.from || 0) + sh.dur <= x.e + 0.05)!;
  for (const sh of shots) {
    const from = sh.from || 0;
    const f = fileOf(sh);
    const { v, m } = materialOf.get(f.file);
    const seg = clone(TEMPLATE.segment);
    const refs: string[] = [];
    for (const ex of TEMPLATE.extras) { const o = clone(ex.o); o.id = uuid(); draft.materials[ex.kind].push(o); refs.push(o.id); }
    // Fill the frame like the preview does (CapCut's scale 1 fits the clip inside the canvas).
    const fit = Math.min(cw / m.w, ch / m.h), cover = Math.max(cw / m.w, ch / m.h);
    const dur = Math.round(sh.dur * US);
    Object.assign(seg, {
      id: uuid(), material_id: v.id, extra_material_refs: refs, raw_segment_id: '',
      source_timerange: { start: Math.max(0, Math.round((from - f.s) * US)), duration: dur },
      target_timerange: { start: at, duration: dur }, render_timerange: { start: 0, duration: 0 },
      clip: { ...seg.clip, scale: { x: cover / fit, y: cover / fit }, transform: { x: 0, y: 0 } },
    });
    track.segments.push(seg);
    at += dur;
  }
  draft.tracks = [track];
  draft.duration = at;

  const meta = clone(TEMPLATE.meta);
  const root = draftsDir();
  if (job.to === 'capcut' && !root) throw new Error('Không thấy CapCut trên máy này');
  const final = job.to === 'capcut' ? freeName(root, name) : name;
  const first = fileOf(shots[0]);
  const pic = await cover(path.join(mediaDir, first.file), Math.max(0, (shots[0].from || 0) - first.s), path.join(folder, 'draft_cover.jpg'));
  Object.assign(meta, {
    draft_id: draftId, draft_name: final, draft_root_path: root, draft_fold_path: root ? path.join(root, final) : '',
    tm_duration: at, tm_draft_create: nowUs, tm_draft_modified: nowUs, draft_cover: pic ? 'draft_cover.jpg' : '',
    draft_timeline_materials_size_: files.reduce((a, f) => a + fs.statSync(path.join(mediaDir, f.file)).size, 0),
  });
  const mats = meta.draft_materials.find((m: any) => m.type === 0);
  if (mats && TEMPLATE.metaMaterial) {
    mats.value = files.map((f) => {
      const m = info.get(f.file)!;
      return { ...clone(TEMPLATE.metaMaterial), id: crypto.randomUUID(), file_Path: `${PLACEHOLDER}/media/${f.file}`, extra_info: f.file,
        duration: Math.round(m.dur * US), width: m.w, height: m.h, metetype: 'video', type: 0, create_time: Math.floor(now / 1000), import_time: Math.floor(now / 1000), import_time_ms: nowUs,
        roughcut_time_range: { start: 0, duration: Math.round(m.dur * US) }, md5: '' };
    });
  }
  const project = clone(TEMPLATE.project);
  Object.assign(project, { id: uuid(), main_timeline_id: timelineId, create_time: nowUs, update_time: nowUs,
    timelines: [{ create_time: nowUs, id: timelineId, is_marked_delete: false, name: 'Timeline 01', update_time: nowUs }] });
  const content = JSON.stringify(draft);
  const put = (rel: string, data: string) => { fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true }); fs.writeFileSync(path.join(folder, rel), data); };
  // The files CapCut 9.2 keeps in its own projects: the timeline (and template-2.tmp, CapCut's copy of it) at the root
  // and in Timelines/<id>, the timeline list and layout, and the generic settings and attachments from the template.
  for (const dir of ['', path.join('Timelines', timelineId)]) {
    put(path.join(dir, 'draft_content.json'), content);
    put(path.join(dir, 'template-2.tmp'), content);
    for (const [rel, data] of Object.entries<string>(TEMPLATE.files.both)) put(path.join(dir, rel), data);
  }
  for (const [rel, data] of Object.entries<string>(TEMPLATE.files.root)) put(rel, data);
  // CapCut for Mac has registered a project it found on disk under draft_info.json (its older file name) although
  // only draft_content.json was there; the timeline is written under both names.
  put('draft_info.json', content);
  put('draft_meta_info.json', JSON.stringify(meta));
  put('Timelines/project.json', JSON.stringify(project));
  put('timeline_layout.json', JSON.stringify({ dockItems: [{ dockIndex: 0, ratio: 1, timelineIds: [timelineId], timelineNames: ['Timeline 01'] }], layoutOrientation: 1 }));
  put('draft_settings', `[General]\ndraft_create_time=${Math.floor(now / 1000)}\ndraft_last_edit_time=${Math.floor(now / 1000)}\nreal_edit_keys=0\nreal_edit_seconds=0\n`);

  // 4a. Straight into CapCut: move the finished folder in (CapCut lists the projects it finds there). From another disk
  //     it is copied under a hidden name first, so CapCut never sees half a project.
  if (job.to === 'capcut') {
    const dest = path.join(root, final);
    try { fs.renameSync(folder, dest); }
    catch {
      const tmp = path.join(root, `.${job.id}.part`);
      try { fs.cpSync(folder, tmp, { recursive: true }); fs.renameSync(tmp, dest); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
    }
    fs.rmSync(work, { recursive: true, force: true });
    Object.assign(job, { phase: 'done', folder: dest, name: final });
    await remember(job);
    return;
  }

  // 4b. Zip it without recompressing the video. macOS's ditto keeps Vietnamese names intact (UTF-8) and handles >4 GB;
  //    Info-ZIP is the fallback elsewhere.
  const zip = path.join(DIR, `${job.id}.zip`);
  const pack = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => execFile(cmd, args, { cwd: work, maxBuffer: 1 << 24 }, (e) => (e ? reject(e) : resolve())));
  await pack('ditto', ['-c', '-k', '--norsrc', '--zlibCompressionLevel', '0', '--keepParent', name, zip]).catch(() => pack('zip', ['-r', '-0', '-q', zip, name]));
  fs.rmSync(work, { recursive: true, force: true });
  Object.assign(job, { phase: 'done', zip, name });
  await remember(job);
}

/** Note the export on the project, newest first, for its page in the work overview. */
async function remember(job: Job) {
  const r = await get<any>('SELECT data FROM projects WHERE id = ?', job.project).catch(() => null);
  if (!r) return;
  const data = JSON.parse(r.data);
  data.exports = [{ at: Date.now(), to: job.to, name: job.name || '' }, ...(data.exports || [])].slice(0, 20);
  await run('UPDATE projects SET data = ? WHERE id = ?', JSON.stringify(data), job.project).catch(() => {});
}

export function registerCapcut(api: Router) {
  api.post('/api/projects/:id/capcut', async (req, res) => {
    if (!FFMPEG) throw new HttpError(400, 'Máy chủ chưa có ffmpeg');
    const to = (await readJson(req)).to === 'capcut' ? 'capcut' : 'zip';
    if (to === 'capcut' && !draftsDir()) throw new HttpError(400, 'Không thấy CapCut trên máy chạy DMI Workspace. Hãy tải file .zip.');
    const p = await get<any>('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Không tìm thấy dự án');
    // Old exports go after a day.
    for (const [k, j] of jobs) if (Date.now() - j.at > 24 * 3600e3) { if (j.zip) fs.rmSync(j.zip, { force: true }); jobs.delete(k); }
    const job: Job = { id: crypto.randomUUID(), project: p.id, to, phase: 'media', done: 0, total: 0, at: Date.now() };
    jobs.set(job.id, job);
    build(job, p).catch((e) => { Object.assign(job, { phase: 'error', error: String(e?.message || e).slice(0, 400) }); fs.rmSync(path.join(DIR, job.id), { recursive: true, force: true }); });
    json(res, 202, { job: job.id });
  });
  // Is CapCut installed on the machine running DMI Workspace (then projects can go straight into it)? Before /:job.
  api.get('/api/capcut/local', async (_req, res) => json(res, 200, { drafts: draftsDir() }));
  api.post('/api/capcut/open', async (_req, res) => {
    if (process.platform !== 'darwin' || !draftsDir()) throw new HttpError(400, 'Không thấy CapCut trên máy này');
    await new Promise<void>((resolve, reject) => execFile('open', ['-b', CAPCUT_APP], (e) => (e ? reject(new HttpError(400, 'Không mở được CapCut')) : resolve())));
    json(res, 200, { ok: true });
  });
  api.get('/api/capcut/:job', async (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j) throw new HttpError(404, 'Không tìm thấy lượt xuất');
    json(res, 200, { phase: j.phase, to: j.to, name: j.name || '', done: j.done, total: j.total, error: j.error || null, bytes: j.zip && fs.existsSync(j.zip) ? fs.statSync(j.zip).size : 0 });
  });
  api.get('/api/capcut/:job/download', async (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j?.zip || !sendFile(req, res, DIR, path.basename(j.zip), { download: `${j.name} (CapCut).zip` })) throw new HttpError(404, 'Chưa có file');
  });
}
