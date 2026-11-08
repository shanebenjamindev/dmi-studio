// `npm run -s dms -- <lệnh>`: sửa dự án DMI Studio từ terminal (và để Claude Code sửa giúp).
// Chỉ gọi REST API của server đang chạy, nên mọi kiểm tra quyền và chuẩn hoá storyboard vẫn do server làm.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

const BASE = (process.env.DMS_URL || `http://localhost:${process.env.PORT || 5173}`).replace(/\/+$/, '');
const HOME = path.join(os.homedir(), '.dms');
const SESSION_FILE = path.join(HOME, 'session.json');
const BACKUP_DIR = path.join(HOME, 'backups');

const HELP = `DMI Studio CLI — server: ${BASE} (đổi bằng DMS_URL)

  login [email]                       Đăng nhập (mật khẩu lấy từ DMS_PASSWORD hoặc hỏi)
  logout
  projects                            Danh sách dự án (số thứ tự dùng thay cho id)
  show <dự án>                        Bảng cảnh: bố cục, thời lượng, chữ, media, giọng
  get <dự án> [--out file.json]       Storyboard đầy đủ dạng JSON
  put <dự án> <file.json | ->         Ghi đè storyboard từ JSON (giữ media của cảnh còn id cũ)
  set <dự án> [cảnh] k=v ...          Sửa nhanh. Có [cảnh]: headline, subtext, caption, visual_prompt,
                                      duration, layout, animation, background, icon, stat_value,
                                      stat_label, bullets="a|b|c", media=null, voice=null.
                                      Không có [cảnh]: title, aspect, font, voice_style,
                                      music.mood, music.bpm, palette.bg1|bg2|accent|text
  add <dự án> [sau cảnh] [k=v ...]    Thêm cảnh mới
  rm <dự án> <cảnh>                   Xoá cảnh
  mv <dự án> <từ> <đến>               Đổi vị trí cảnh
  dup <dự án> <cảnh>                  Nhân đôi cảnh
  refine <dự án> "yêu cầu"            Claude CLI sửa kịch bản theo câu lệnh
  create <file.json | -> [--aspect 16:9|9:16|1:1]
                                      Tạo dự án mới từ storyboard JSON có sẵn (không gọi AI)
  new ["ý tưởng"] [--seconds 30] [--aspect 16:9|9:16|1:1] [--style "..."] [--drive <link>] [--sheet <link>]
                                      --drive: Claude xem thumbnail mọi video/ảnh trong thư mục Drive,
                                      chỉ giữ source khớp ý tưởng và đặt làm nền cho từng cảnh
                                      --sheet: đọc form yêu cầu trên Google Sheets, tìm footage được nhắc tới
                                      trên Drive và dựng theo bảng kịch bản của form
  drive <dự án> <link | none>         Gắn (hoặc bỏ) thư mục source Google Drive cho dự án; refine sẽ lọc lại theo yêu cầu
                                      Claude CLI viết kịch bản và tạo dự án mới
  undo <dự án>                        Khôi phục storyboard trước lần ghi gần nhất của CLI

  <dự án> = số thứ tự trong "projects", id (p_…) hoặc một phần tên.
  [cảnh]  = 3 | 1,4 | 2-5 | all  (đánh số từ 1).
  Tuỳ chọn chung: --json (in JSON), --no-brand (bỏ bộ nhận diện khi dùng AI),
                  --model sonnet|opus|haiku (model Claude cho refine/new).
  Lưu ý: hãy đóng dự án trên trình duyệt khi sửa bằng CLI, vì trình soạn thảo tự lưu sẽ ghi đè.`;

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const flags: Record<string, string | boolean> = {};
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { args.push(a); continue; }
  const [k, v] = a.slice(2).split(/=(.*)/s);
  if (v !== undefined) flags[k] = v;
  else if (['out', 'seconds', 'aspect', 'style', 'provider', 'model', 'drive', 'sheet'].includes(k)) flags[k] = argv[++i] ?? '';
  else flags[k] = true;
}
const str = (k: string) => (typeof flags[k] === 'string' ? flags[k] as string : undefined);

class CliError extends Error {}
const fail = (msg: string): never => { throw new CliError(msg); };

// ------------------------------------------------------------------ http
function loadSessions(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return {}; }
}
function saveSession(cookie: string | null) {
  const all = loadSessions();
  if (cookie) all[BASE] = cookie; else delete all[BASE];
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

async function call<T = any>(method: string, url: string, body?: any): Promise<T> {
  const cookie = process.env.DMS_COOKIE || loadSessions()[BASE];
  let res: Response;
  try {
    res = await fetch(BASE + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { return fail(`Không kết nối được ${BASE}. Server đã chạy chưa? (npm start)`); }
  const data = await res.json().catch(() => ({ error: `Lỗi ${res.status}` }));
  if (res.status === 401 && !url.startsWith('/api/auth/')) fail('Chưa đăng nhập. Chạy: npm run -s dms -- login');
  if (!res.ok) fail(data.error || `Lỗi ${res.status}`);
  if (url === '/api/auth/login') saveSession(res.headers.get('set-cookie')?.split(';')[0] || null);
  return data as T;
}

// ------------------------------------------------------------------ lookups
async function project(ref?: string) {
  if (!ref) fail('Thiếu <dự án>. Xem: npm run -s dms -- projects');
  if (/^p_/.test(ref!)) return await call('GET', `/api/projects/${encodeURIComponent(ref!)}`);
  const list = await call<any[]>('GET', '/api/projects');
  const n = /^\d+$/.test(ref!) ? list[Number(ref) - 1] : undefined;
  const hits = n ? [n] : list.filter((p) => fold(p.title).includes(fold(ref!)));
  if (!hits.length) fail(`Không thấy dự án "${ref}"`);
  if (hits.length > 1) fail(`"${ref}" khớp nhiều dự án:\n${hits.map((p) => `  ${p.id}  ${p.title}`).join('\n')}`);
  const p = await call('GET', `/api/projects/${hits[0].id}`);
  if (!p.storyboard && !['set', 'put'].includes(args[0])) fail(`Dự án "${p.title}" chưa có kịch bản.`);
  return p;
}
const fold = (s: string) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** "3", "1,4", "2-5", "all" → 0-based indexes. */
function scenes(sel: string | undefined, count: number) {
  if (!sel || sel === 'all') return [...Array(count).keys()];
  const out = new Set<number>();
  for (const part of sel.split(',')) {
    const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) fail(`Cảnh không hợp lệ: "${part}"`);
    const a = Number(m![1]), b = Number(m![2] || m![1]);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (i < 1 || i > count) fail(`Không có cảnh ${i} (dự án có ${count} cảnh)`);
      out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}
const isSceneSel = (s?: string) => !!s && (s === 'all' || /^[\d,\s-]+$/.test(s));

async function choice() {
  const { providers, defaults } = await call('GET', '/api/providers');
  const list = providers.filter((p: any) => p.kind === 'llm');
  const wanted = str('provider');
  const p = wanted ? list.find((x: any) => x.id === wanted) || fail(`Không có nhà cung cấp "${wanted}". Có: ${list.map((x: any) => x.id).join(', ')}`)
    : list.find((x: any) => x.id === defaults?.llm?.provider && x.configured) || list.find((x: any) => x.configured) || fail('Server không tìm thấy lệnh claude.');
  const model = str('model') || (defaults?.llm?.provider === p.id ? defaults.llm.model : '') || p.models[0]?.id || '';
  return { provider: p.id, model };
}

// ------------------------------------------------------------------ writes (with backup for undo)
function backup(p: any) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(BACKUP_DIR, `${p.id}-${Date.now()}.json`), JSON.stringify({ title: p.title, aspect: p.aspect, storyboard: p.storyboard }));
  // Keep the 30 most recent per project.
  const mine = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(p.id + '-')).sort();
  for (const f of mine.slice(0, -30)) fs.unlinkSync(path.join(BACKUP_DIR, f));
}
async function save(p: any, patch: { title?: string; aspect?: string; storyboard?: any }) {
  backup(p);
  return await call('PUT', `/api/projects/${p.id}`, patch);
}

// ------------------------------------------------------------------ output
const out = (v: any) => process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n');
const cut = (s: any, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const secs = (sb: any) => (sb?.scenes || []).reduce((a: number, s: any) => a + (Number(s.duration) || 0), 0);

function printProject(p: any) {
  if (flags.json) return out(p);
  const sb = p.storyboard;
  out(`${p.title}  ·  ${p.id}  ·  ${p.aspect}  ·  ${sb?.scenes.length || 0} cảnh  ·  ${secs(sb).toFixed(1)}s`);
  if (!sb) return;
  out(`font ${sb.font} · nhạc ${sb.music?.mood}/${sb.music?.bpm}bpm · màu ${sb.palette?.bg1} ${sb.palette?.bg2} ${sb.palette?.accent}`);
  sb.scenes.forEach((s: any, i: number) => {
    const media = s.media ? (s.media.type === 'video' ? '🎬' : '🖼') : '·';
    const src = s.media?.provider === 'drive' ? `      source:  ${s.media.prompt}` : '';
    const voice = s.voice ? '🔊' : '·';
    out(`\n${String(i + 1).padStart(2)}. [${s.layout}] ${s.duration}s ${s.animation}/${s.background} ${media}${voice} ${s.icon || ''}  ${s.headline}`);
    if (s.subtext) out(`      sub:     ${cut(s.subtext, 90)}`);
    if (s.bullets?.length) out(`      bullets: ${s.bullets.join(' | ')}`);
    if (s.stat_value) out(`      stat:    ${s.stat_value} ${s.stat_label || ''}`);
    if (src) out(src);
    if (s.caption) out(`      lời:     ${cut(s.caption, 90)}`);
    if (s.visual_prompt) out(`      hình:    ${cut(s.visual_prompt, 90)}`);
  });
}

function readStoryboard(src?: string) {
  if (!src) fail('Thiếu file JSON (hoặc "-" để đọc stdin)');
  let sb: any;
  try { sb = JSON.parse(src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src!, 'utf8')); } catch (e: any) { fail(`JSON không đọc được: ${e.message}`); }
  if (!Array.isArray(sb?.scenes) || !sb.scenes.length) fail('Storyboard cần có mảng "scenes"');
  return sb;
}

// ------------------------------------------------------------------ set k=v
const SCENE_KEYS = ['headline', 'subtext', 'caption', 'visual_prompt', 'duration', 'layout', 'animation', 'background', 'icon', 'stat_value', 'stat_label', 'bullets', 'media', 'voice'];
const ENUMS: Record<string, string[]> = {
  layout: ['title', 'bullets', 'stat', 'quote', 'split', 'outro'],
  animation: ['fade', 'slide-up', 'zoom', 'typewriter', 'pop'],
  background: ['gradient', 'particles', 'grid', 'waves', 'blobs', 'solid'],
  font: ['brand', 'sans', 'serif', 'mono', 'display'],
  'music.mood': ['calm', 'upbeat', 'epic', 'none'],
  aspect: ['16:9', '9:16', '1:1'],
};
function pairs(list: string[]) {
  return list.map((a) => {
    const m = a.match(/^([\w.]+)=(.*)$/s) || fail(`Cần dạng khoá=giá trị: "${a}"`);
    const [, k, v] = m!;
    if (ENUMS[k] && !ENUMS[k].includes(v)) fail(`${k} phải là một trong: ${ENUMS[k].join(', ')}`);
    return [k, v] as const;
  });
}
function sceneValue(k: string, v: string) {
  if (!SCENE_KEYS.includes(k)) fail(`Cảnh không có trường "${k}". Có: ${SCENE_KEYS.join(', ')}`);
  if (k === 'duration') { const n = Number(v); if (!(n > 0)) fail('duration phải là số giây'); return n; }
  if (k === 'bullets') return v.split('|').map((x) => x.trim()).filter(Boolean);
  if (k === 'media' || k === 'voice') { if (v !== 'null') fail(`${k} chỉ nhận "null" (xoá)`); return null; }
  return v;
}

// ------------------------------------------------------------------ commands
const commands: Record<string, () => Promise<any>> = {
  async help() { out(HELP); },

  async login() {
    const email = args[1] || process.env.DMS_EMAIL || await ask('Email: ');
    const password = process.env.DMS_PASSWORD || await ask('Mật khẩu: ', true);
    const { user } = await call('POST', '/api/auth/login', { email, password });
    out(`✓ Đã đăng nhập ${user.email} (${user.role}) vào ${BASE}`);
  },
  async logout() {
    await call('POST', '/api/auth/logout').catch(() => {});
    saveSession(null);
    out('✓ Đã đăng xuất');
  },

  async projects() {
    const list = await call<any[]>('GET', '/api/projects');
    if (flags.json) return out(list);
    if (!list.length) return out('Chưa có dự án nào.');
    list.forEach((p, i) => out(`${String(i + 1).padStart(3)}. ${p.id}  ${p.aspect.padEnd(4)} ${String(p.scenes).padStart(2)} cảnh ${p.duration.toFixed(0).padStart(3)}s  ${p.title}`));
  },

  async show() { printProject(await project(args[1])); },

  async get() {
    const p = await project(args[1]);
    const file = str('out');
    if (!file) return out(p.storyboard);
    fs.writeFileSync(file, JSON.stringify(p.storyboard, null, 2) + '\n');
    out(`✓ Đã ghi ${file}`);
  },

  async put() {
    const p = await project(args[1]);
    const sb = readStoryboard(args[2]);
    printProject(await save(p, { storyboard: sb, title: sb.title || undefined }));
  },

  async create() {
    const sb = readStoryboard(args[1]);
    const aspect = str('aspect') || '16:9';
    if (!ENUMS.aspect.includes(aspect)) fail(`--aspect phải là ${ENUMS.aspect.join(', ')}`);
    printProject(await call('POST', '/api/projects', { title: sb.title, aspect, storyboard: sb }));
  },

  async set() {
    const p = await project(args[1]);
    const sb = p.storyboard;
    if (isSceneSel(args[2])) {
      if (!sb) fail('Dự án chưa có kịch bản.');
      const idx = scenes(args[2], sb.scenes.length);
      const kv = pairs(args.slice(3));
      if (!kv.length) fail('Thiếu khoá=giá trị');
      for (const i of idx) for (const [k, v] of kv) sb.scenes[i][k] = sceneValue(k, v);
      return printProject(await save(p, { storyboard: sb }));
    }
    const kv = pairs(args.slice(2));
    if (!kv.length) fail('Thiếu khoá=giá trị');
    const patch: any = {};
    for (const [k, v] of kv) {
      if (k === 'aspect') { patch.aspect = v; continue; }
      if (k === 'title') { patch.title = v; if (sb) sb.title = v; continue; }
      if (!sb) fail('Dự án chưa có kịch bản.');
      if (k === 'font' || k === 'voice_style') sb[k] = v;
      else if (k === 'music.mood') sb.music.mood = v;
      else if (k === 'music.bpm') sb.music.bpm = Number(v) || fail('music.bpm phải là số');
      else if (/^palette\.(bg1|bg2|accent|text)$/.test(k)) {
        if (!/^#[0-9a-f]{3,8}$/i.test(v)) fail(`${k} phải là mã màu hex, vd. #16c3f6`);
        sb.palette[k.split('.')[1]] = v;
      } else fail(`Không sửa được "${k}". Muốn sửa cảnh thì thêm số cảnh: set <dự án> 2 ${k}=…`);
    }
    if (sb) patch.storyboard = sb;
    printProject(await save(p, patch));
  },

  async add() {
    const p = await project(args[1]);
    const sb = p.storyboard;
    const after = isSceneSel(args[2]) ? scenes(args[2], sb.scenes.length).at(-1)! + 1 : sb.scenes.length;
    const scene: any = { layout: 'title', icon: '✨', headline: 'Cảnh mới', subtext: '', caption: '', visual_prompt: '', duration: 4, animation: 'fade', background: 'gradient' };
    for (const [k, v] of pairs(args.slice(isSceneSel(args[2]) ? 3 : 2))) scene[k] = sceneValue(k, v);
    sb.scenes.splice(after, 0, scene);
    printProject(await save(p, { storyboard: sb }));
  },
  async rm() {
    const p = await project(args[1]);
    const sb = p.storyboard;
    const idx = scenes(args[2] || fail('Thiếu số cảnh'), sb.scenes.length);
    if (idx.length >= sb.scenes.length) fail('Phải giữ lại ít nhất một cảnh');
    sb.scenes = sb.scenes.filter((_: any, i: number) => !idx.includes(i));
    printProject(await save(p, { storyboard: sb }));
  },
  async mv() {
    const p = await project(args[1]);
    const sb = p.storyboard;
    const [from] = scenes(args[2] || fail('Thiếu cảnh nguồn'), sb.scenes.length);
    const [to] = scenes(args[3] || fail('Thiếu vị trí đích'), sb.scenes.length);
    sb.scenes.splice(to, 0, ...sb.scenes.splice(from, 1));
    printProject(await save(p, { storyboard: sb }));
  },
  async dup() {
    const p = await project(args[1]);
    const sb = p.storyboard;
    const [i] = scenes(args[2] || fail('Thiếu số cảnh'), sb.scenes.length);
    const { id, ...copy } = sb.scenes[i];
    sb.scenes.splice(i + 1, 0, copy);
    printProject(await save(p, { storyboard: sb }));
  },

  async refine() {
    const p = await project(args[1]);
    const instruction = args.slice(2).join(' ').trim() || fail('Thiếu yêu cầu chỉnh sửa');
    const c = await choice();
    process.stderr.write(`… ${c.provider} · ${c.model} đang chỉnh sửa\n`);
    const { storyboard, picked } = await call('POST', '/api/ai/refine', { ...c, storyboard: p.storyboard, instruction, brand: !flags['no-brand'], projectId: p.id, sources: p.sources, sheet: p.sheet });
    printPicked(picked, p.sources?.length);
    const chat = [...(p.chat || []), { who: 'user', text: instruction, at: Date.now() }, { who: 'ai', text: `✓ Đã cập nhật qua CLI (${storyboard.scenes.length} cảnh).`, at: Date.now() }];
    backup(p);
    printProject(await call('PUT', `/api/projects/${p.id}`, { storyboard, title: storyboard.title, chat }));
  },

  async new() {
    let sheet: any = null, sources: any[] = [];
    if (str('sheet')) {
      process.stderr.write('… đang đọc form và tìm source trên Drive\n');
      const r = await call('POST', '/api/sheets/read', { link: str('sheet') });
      ({ sheet, sources } = r);
      process.stderr.write(`  "${sheet.title}": ${sheet.form.customer}, ${sheet.form.aspect}, ~${sheet.form.seconds}s, ${r.links} ô có link, ${sources.length} source\n`);
      if (r.missing.length) process.stderr.write(`  không tìm thấy: ${r.missing.join(', ')}\n`);
      if (sheet.form.ignored_rows) process.stderr.write(`  bỏ qua: ${sheet.form.ignored_rows}\n`);
    }
    const prompt = args.slice(1).join(' ').trim() || (sheet ? '' : fail('Thiếu ý tưởng video'));
    const aspect = str('aspect') || sheet?.form.aspect || '16:9';
    if (!ENUMS.aspect.includes(aspect)) fail(`--aspect phải là ${ENUMS.aspect.join(', ')}`);
    const c = await choice();
    if (str('drive')) sources = [...sources, ...(await scanDrive(str('drive')!)).sources];
    process.stderr.write(`… ${c.provider} · ${c.model} đang viết kịch bản${sources.length ? ` từ ${sources.length} source` : ''}\n`);
    const { storyboard, picked } = await call('POST', '/api/ai/storyboard', {
      ...c, prompt, seconds: Number(str('seconds')) || sheet?.form.seconds || 30, aspect, style: str('style') || '', brand: !flags['no-brand'], sources, sheet,
    });
    printPicked(picked, sources.length);
    printProject(await call('POST', '/api/projects', { title: storyboard.title, aspect, storyboard, sources, sheet, chat: [{ who: 'user', text: prompt || `📄 ${sheet?.title}`, at: Date.now() }] }));
  },

  async drive() {
    const p = await project(args[1]);
    const link = args[2] || fail('Thiếu link Google Drive (hoặc "none" để bỏ)');
    const sources = link === 'none' ? [] : (await scanDrive(link)).sources;
    await call('PUT', `/api/projects/${p.id}`, { sources });
    out(sources.length ? `✓ Đã gắn ${sources.length} source. Dùng refine để Claude lọc và đặt source vào cảnh.` : '✓ Đã bỏ source');
  },

  async undo() {
    const p = await project(args[1]);
    const files = fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(p.id + '-')).sort() : [];
    const last = files.at(-1) || fail('Không có bản lưu nào để hoàn tác cho dự án này.');
    const prev = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, last), 'utf8'));
    const r = await call('PUT', `/api/projects/${p.id}`, prev);
    fs.unlinkSync(path.join(BACKUP_DIR, last));
    printProject(r);
  },
};

async function scanDrive(link: string) {
  process.stderr.write('… đang quét Google Drive\n');
  const r = await call('POST', '/api/sources/scan', { link });
  process.stderr.write(`  "${r.folder}": ${r.sources.length} file${r.total > r.sources.length ? ` (giới hạn, tổng ${r.total})` : ''}\n`);
  if (!r.sources.length) fail('Không có video nào trong link này.');
  return r;
}
function printPicked(picked: any[] | null, total?: number) {
  if (!picked || flags.json) return;
  out(`Đã chọn ${picked.length}/${total} source:`);
  for (const x of picked) out(`  • ${x.name}: ${x.reason}`);
  out('');
}

async function ask(q: string, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) (rl as any)._writeToOutput = (s: string) => { if (s.startsWith(q)) process.stdout.write(q); };
  try { return (await rl.question(q)).trim(); } finally { rl.close(); if (hidden) process.stdout.write('\n'); }
}

// `dms show 1 | head` closes the pipe early; that is not an error.
process.stdout.on('error', (e: any) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const cmd = commands[args[0] || 'help'] || (args[0] === '-h' || flags.help ? commands.help : null);
if (!cmd) { console.error(`Không có lệnh "${args[0]}".\n`); out(HELP); process.exit(1); }
cmd().catch((e) => {
  console.error('✖ ' + (e instanceof CliError ? e.message : e?.stack || e));
  process.exit(1);
});
