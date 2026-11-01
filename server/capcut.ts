// Export an assembly as a CapCut (9.x desktop) project in a .zip: the clips in timeline order with their in/out points,
// plus the media they need. Media are the used parts of each Drive source with 2 s of handle on both sides, cut at the
// original resolution (Apple's hardware H.264 encoder), so the editor can still extend every cut a little in CapCut.
// The project layout copies a real CapCut 9.2 draft (server/capcut/template.json, identifiers removed); media paths use
// CapCut's own "draft folder" placeholder, so the project works wherever its folder is unzipped.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, json, sendFile } from './http';
import { DATA_DIR, FFMPEG } from './config';
import { get } from './db';
import { cutFromDrive } from './localcopy';

const DIR = path.join(DATA_DIR, 'exports');
// Read on first export only (the Cloudflare build has no files on disk and never exports).
let tpl: any = null;
const template = () => (tpl ??= JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'capcut', 'template.json'), 'utf8')));
const PLACEHOLDER = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##';
const HANDLE = 2; // seconds kept before and after every cut
const PARALLEL = 2;
const US = 1e6;

export type Job = { id: string; project: string; phase: 'media' | 'pack' | 'done' | 'error'; done: number; total: number; error?: string; zip?: string; name?: string; at: number };
const jobs = new Map<string, Job>();

const uuid = () => crypto.randomUUID().toUpperCase();
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const safe = (s: string) => s.replace(/[\/\\:*?"<>|\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'DM Studio';
/** Project folder name: the sheet title without the form's generic prefix, e.g. "DYNAMIC M DETAIL CERAMIC COATING". */
const draftName = (title: string) => safe(title.replace(/\[ADS\]\s*/i, '').replace(/FORM YÊU CẦU DỰNG VIDEO\s*\|?/i, ''));
const CANVAS: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };

/** Where CapCut on this Mac keeps its drafts (from its own index), so draft_meta_info points at the usual place. */
function draftsRoot() {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Movies/CapCut/User Data/Projects/com.lveditor.draft/root_meta_info.json'), 'utf8'));
    return String(idx.all_draft_store?.[0]?.draft_root_path || '');
  } catch { return ''; }
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

  // 1. The parts of each source the timeline uses, with handles; overlapping parts become one file.
  const bySource = new Map<string, { account: string; name: string; len: number; ranges: [number, number][] }>();
  for (const sh of shots) {
    const q = new URLSearchParams(sh.media.url.split('?')[1] || '');
    const len = sh.media.duration || (sh.from || 0) + sh.dur + HANDLE;
    const src = bySource.get(sh.media.assetId) || { account: q.get('a') || '', name: sh.media.prompt || sh.media.assetId, len, ranges: [] };
    src.ranges.push([Math.max(0, (sh.from || 0) - HANDLE), Math.min(len, (sh.from || 0) + sh.dur + HANDLE)]);
    bySource.set(sh.media.assetId, src);
  }
  const files: { id: string; s: number; e: number; file: string; account: string }[] = [];
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
      await cut(f.account, f.id, f.s, f.e, out);
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
  for (const sh of shots) {
    const from = sh.from || 0;
    const f = files.find((x) => x.id === sh.media.assetId && from >= x.s - 0.05 && from + sh.dur <= x.e + 0.05)!;
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
  const root = draftsRoot();
  Object.assign(meta, {
    draft_id: draftId, draft_name: name, draft_root_path: root, draft_fold_path: root ? path.join(root, name) : '',
    tm_duration: at, tm_draft_create: nowUs, tm_draft_modified: nowUs, draft_cover: '',
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
  fs.writeFileSync(path.join(folder, 'draft_content.json'), content);
  fs.writeFileSync(path.join(folder, 'draft_meta_info.json'), JSON.stringify(meta));
  fs.mkdirSync(path.join(folder, 'Timelines', timelineId), { recursive: true });
  fs.writeFileSync(path.join(folder, 'Timelines', 'project.json'), JSON.stringify(project));
  fs.writeFileSync(path.join(folder, 'Timelines', timelineId, 'draft_content.json'), content);
  fs.writeFileSync(path.join(folder, 'draft_settings'), `[General]\ndraft_create_time=${Math.floor(now / 1000)}\ndraft_last_edit_time=${Math.floor(now / 1000)}\n`);

  // 4. Zip it without recompressing the video. macOS's ditto keeps Vietnamese names intact (UTF-8) and handles >4 GB;
  //    Info-ZIP is the fallback elsewhere.
  const zip = path.join(DIR, `${job.id}.zip`);
  const pack = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => execFile(cmd, args, { cwd: work, maxBuffer: 1 << 24 }, (e) => (e ? reject(e) : resolve())));
  await pack('ditto', ['-c', '-k', '--norsrc', '--zlibCompressionLevel', '0', '--keepParent', name, zip]).catch(() => pack('zip', ['-r', '-0', '-q', zip, name]));
  fs.rmSync(work, { recursive: true, force: true });
  Object.assign(job, { phase: 'done', zip, name });
}

export function registerCapcut(api: Router) {
  api.post('/api/projects/:id/capcut', async (req, res) => {
    if (!FFMPEG) throw new HttpError(400, 'Máy chủ chưa có ffmpeg');
    const p = await get<any>('SELECT * FROM projects WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Không tìm thấy dự án');
    // Old exports go after a day.
    for (const [k, j] of jobs) if (Date.now() - j.at > 24 * 3600e3) { if (j.zip) fs.rmSync(j.zip, { force: true }); jobs.delete(k); }
    const job: Job = { id: crypto.randomUUID(), project: p.id, phase: 'media', done: 0, total: 0, at: Date.now() };
    jobs.set(job.id, job);
    build(job, p).catch((e) => { Object.assign(job, { phase: 'error', error: String(e?.message || e).slice(0, 400) }); fs.rmSync(path.join(DIR, job.id), { recursive: true, force: true }); });
    json(res, 202, { job: job.id });
  });
  api.get('/api/capcut/:job', async (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j) throw new HttpError(404, 'Không tìm thấy lượt xuất');
    json(res, 200, { phase: j.phase, done: j.done, total: j.total, error: j.error || null, bytes: j.zip && fs.existsSync(j.zip) ? fs.statSync(j.zip).size : 0 });
  });
  api.get('/api/capcut/:job/download', async (req, res) => {
    const j = jobs.get(req.params.job);
    if (!j?.zip || !sendFile(req, res, DIR, path.basename(j.zip), { download: `${j.name} (CapCut).zip` })) throw new HttpError(404, 'Chưa có file');
  });
}
