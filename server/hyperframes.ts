// A video project's HyperFrames project on the Mac (HTML rendered to video, https://hyperframes.heygen.com): a folder per
// project with the request sheet as BRIEF.md and its footage from Drive in assets/. Claude Code builds and renders the
// video there with the HyperFrames CLI (connected through /api/mcp, server/video-mcp.ts); the MP4 it renders comes back
// as one of the project's renders. Everything runs on the Mac, free: no cloud render, no paid API.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router, HttpError, json, readJson } from './http';
import { get, run, uid, now } from './db';
import { ASSET_DIR, CLOUD_STORAGE_ONLY } from './config';
import * as G from './google';
import type { Source } from './sources';

// Worked out when used (always on the Mac): the cloud Worker loads this module too and has no home folder.
const hfRoot = () => path.resolve(process.env.HYPERFRAMES_DIR || path.join(os.homedir(), 'DMI-HyperFrames'));
const MAX_DOWNLOADS = 40;
const SIZE: Record<string, string> = { '16:9': '1920×1080', '9:16': '1080×1920', '1:1': '1080×1080' };
const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'video';
const dirOf = (p: { id: string; title: string }) => path.join(hfRoot(), `${slug(p.title)}-${p.id}`);
const label = (i: number) => `s${i + 1}`;
/** The file name a source gets in assets/: its label first, so the brief and the folder line up. */
function assetName(s: Source, i: number) {
  const ext = path.extname(s.name).toLowerCase() || (s.kind === 'image' ? '.jpg' : '.mp4');
  return `${label(i)}-${slug(path.basename(s.name, path.extname(s.name)))}${ext}`;
}

async function project(id: string) {
  if (CLOUD_STORAGE_ONLY) throw new HttpError(400, 'HyperFrames chỉ chạy trên bản DMI ở máy Mac');
  const p = await get<any>('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw new HttpError(404, 'Không tìm thấy dự án');
  return { ...p, data: JSON.parse(p.data) };
}

/** Runs the HyperFrames CLI in a project folder (npx fetches it the first time). */
async function hyperframes(cwd: string, args: string[], timeout = 180e3) {
  const { spawn } = await import('node:child_process');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'hyperframes', ...args], { cwd, env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1' } });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new HttpError(504, `HyperFrames ${args[0]} quá ${timeout / 1000} giây`)); }, timeout);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => { clearTimeout(timer); reject(new HttpError(500, 'Không chạy được npx hyperframes: ' + e.message)); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new HttpError(500, `HyperFrames ${args[0]}: ${(err || out).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`)); });
  });
}

/** What the project's HyperFrames folder holds, and whether its preview (HyperFrames Studio) is running. */
async function hyperframesState(id: string) {
  const p = await project(id), dir = dirOf(p), has = fs.existsSync(path.join(dir, 'index.html'));
  let preview: { running: boolean; url: string | null } = { running: false, url: null };
  if (has) { try { const r = JSON.parse(await hyperframes(dir, ['preview', '--status', '--json'], 30e3)).result; preview = { running: r.state === 'running', url: r.studioUrl || null }; } catch { /* not running */ } }
  const assets = fs.existsSync(path.join(dir, 'assets')) ? fs.readdirSync(path.join(dir, 'assets')).filter((n) => !n.startsWith('.') && !n.endsWith('.part')) : [];
  return { dir, exists: has, assets, preview, brief: fs.existsSync(path.join(dir, 'BRIEF.md')) };
}

function briefOf(p: any, sources: Source[], files: Map<number, string>) {
  const f = p.data.sheet?.form || {}, rows = f.script || [];
  const cell = (s: any) => String(s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  return [
    `# ${p.title}`, '',
    `Dự án DMI: ${p.id}${p.data.sheet?.link ? ` · Sheet yêu cầu: ${p.data.sheet.link}` : ''}`,
    `Khách hàng: ${f.customer || '—'} · Khung hình: ${p.aspect} (${SIZE[p.aspect] || p.aspect}) · Thời lượng: ${f.seconds ? f.seconds + ' giây' : '—'}${f.deadline ? ` · Hạn: ${f.deadline}` : ''}${f.urgent ? ' · GẤP' : ''}`,
    ...(p.data.note ? ['', '## Ghi chú', p.data.note] : []),
    ...(rows.length ? ['', '## Kịch bản', '', '| Cảnh | Ý nghĩa | Lời đọc | Hình ảnh | Chữ trên màn hình | Nguồn | Thời lượng | Ghi chú |', '|---|---|---|---|---|---|---|---|',
      ...rows.map((r: any) => `| ${cell(r.row)} | ${cell(r.meaning)} | ${cell(r.voice_over)} | ${cell(r.visual)} | ${cell(r.on_screen)} | ${cell(r.source)} | ${cell(r.duration)} | ${cell(r.note)} |`)] : []),
    ...(f.sequence?.length ? ['', '## Thứ tự footage theo sheet', ...f.sequence.map((x: any) => `- ${x.row}: ${x.ref}`)] : []),
    '', '## Footage (Google Drive)', '',
    ...sources.map((s, i) => `- ${label(i)} · ${s.kind === 'video' ? `video${s.duration ? ` ${Math.round(s.duration * 10) / 10}s` : ''}` : 'ảnh'} · ${s.name}${s.row ? ` · cảnh ${s.row}` : ''}${files.has(i) ? ` → assets/${files.get(i)}` : ' (chưa tải)'}`),
    '', 'Dựng theo HyperFrames; render bằng `npx hyperframes render`, rồi gửi file MP4 về dự án bằng công cụ publish_render của DMI.', '',
  ].join('\n');
}

/** Makes the folder (HyperFrames' blank project) if needed, downloads the footage asked for and writes BRIEF.md. */
async function prepareHyperframes(id: string, pick?: string[]) {
  const p = await project(id), dir = dirOf(p), sources: Source[] = p.data.sources || [];
  fs.mkdirSync(hfRoot(), { recursive: true });
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new HttpError(409, `Thư mục ${dir} đã có file nhưng chưa có index.html: dọn thư mục rồi thử lại`);
    await hyperframes(hfRoot(), ['init', path.basename(dir), '--skip-skills', '--non-interactive']);
  }
  const want = pick?.length ? new Set(pick.map((x) => String(x).toLowerCase())) : null;
  const chosen = sources.map((s, i) => ({ s, i })).filter(({ s, i }) => !want || want.has(label(i)) || want.has(s.name.toLowerCase()));
  if (chosen.length > MAX_DOWNLOADS) throw new HttpError(400, `Dự án có ${chosen.length} file: chọn tối đa ${MAX_DOWNLOADS} (theo nhãn s1, s2…)`);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const files = new Map<number, string>(), failed: string[] = [];
  for (const [i, s] of sources.entries()) if (fs.existsSync(path.join(dir, 'assets', assetName(s, i)))) files.set(i, assetName(s, i));
  // Three at a time: Drive is fine with it and the Mac's disk keeps up.
  const queue = chosen.filter(({ i }) => !files.has(i));
  await Promise.all([0, 1, 2].map(async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const name = assetName(job.s, job.i);
      try { await G.downloadFile(job.s.account, job.s.id, path.join(dir, 'assets', name)); files.set(job.i, name); }
      catch (e: any) { failed.push(`${label(job.i)} ${job.s.name}: ${e.message}`); }
    }
  }));
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), briefOf(p, sources, files));
  return { ...(await hyperframesState(id)), downloaded: chosen.filter(({ i }) => files.has(i)).map(({ s, i }) => `${label(i)} → assets/${assetName(s, i)}`), failed };
}

/** A video rendered in the project's folder becomes one of its renders (copied, so the folder can be cleaned later). */
async function publishRender(id: string, file: string) {
  const p = await project(id), dir = dirOf(p);
  const abs = path.resolve(dir, String(file || ''));
  let real: string;
  try { real = fs.realpathSync(abs); } catch { throw new HttpError(404, `Không thấy file ${file}`); }
  if (!real.startsWith(fs.realpathSync(dir) + path.sep)) throw new HttpError(400, 'Chỉ gửi được file nằm trong thư mục HyperFrames của dự án');
  const ext = path.extname(real).toLowerCase(), mime = VIDEO_MIME[ext];
  if (!mime) throw new HttpError(400, 'Chỉ nhận file .mp4, .mov hoặc .webm');
  const bytes = fs.statSync(real).size;
  if (!bytes) throw new HttpError(400, 'File rỗng');
  const assetId = uid('a_'), name = `${assetId}${ext}`, at = now();
  await fs.promises.copyFile(real, path.join(ASSET_DIR, name));
  await run('INSERT INTO assets(id, project_id, kind, mime, file, bytes, source, meta, created_at) VALUES(?,?,?,?,?,?,?,?,?)', assetId, p.id, 'render', mime, name, bytes, 'hyperframes', JSON.stringify({ from: path.relative(dir, real) }), at);
  const renderId = uid('r_');
  await run('INSERT INTO renders(id, project_id, asset_id, status, created_at) VALUES(?,?,?,?,?)', renderId, p.id, assetId, 'ready', at);
  await run('UPDATE projects SET updated_at=? WHERE id=?', at, p.id);
  return { id: renderId, bytes, download: `/api/renders/${renderId}/download` };
}

export function registerHyperframes(api: Router) {
  api.get('/api/projects/:id/hyperframes', async (req, res) => json(res, 200, await hyperframesState(req.params.id)));
  api.post('/api/projects/:id/hyperframes/prepare', async (req, res) => {
    const b = await readJson(req);
    json(res, 200, await prepareHyperframes(req.params.id, Array.isArray(b.sources) ? b.sources.map(String) : undefined));
  });
  // HyperFrames' own preview (its Studio, on 127.0.0.1): started in the background, left running for Claude and the page.
  api.post('/api/projects/:id/hyperframes/preview', async (req, res) => {
    const dir = dirOf(await project(req.params.id));
    if (!fs.existsSync(path.join(dir, 'index.html'))) throw new HttpError(409, 'Chưa có video HyperFrames: nhờ Claude dựng trước');
    const r = JSON.parse((await hyperframes(dir, ['preview', '--background', '--no-open', '--json'], 90e3)).trim().split('\n').pop()!).result;
    json(res, 200, { running: true, url: r.studioUrl || r.serverUrl || null });
  });
  api.post('/api/projects/:id/hyperframes/publish', async (req, res) => json(res, 201, await publishRender(req.params.id, String((await readJson(req)).file || ''))));
}
