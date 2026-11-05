import {customerLevels,requireCustomer} from './customer-access';
// REST API.
import fs from 'node:fs';
import path from 'node:path';
import { Router, HttpError, json, readJson, readBody, sendFile } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { ASSET_DIR, FFMPEG, MAX_UPLOAD, MOCK, CLAUDE_CLI, CLOUD_STORAGE_ONLY } from './config';
import { FOLDER_MIME } from './google';
import { publicCatalog, findProvider, KEY_ENVS, getKey, keySource, setKey, mask, customModels } from './providers/registry';
import { writeStoryboard, ProviderError } from './providers/llm';
import { generatePrompt, refinePrompt, normalizeStoryboard, BRAND_PALETTES } from './storyboard';
import { createJob, publicJob, saveAsset } from './jobs';
import { registerWorkspace, autoLinkCustomer, syncUnlinkedCustomers } from './workspace';
import {registerNotifications} from './notifications';
import {currentUser, registerAuth } from './auth';
import { registerProxies } from './proxies';
import { registerCapcut } from './capcut';
import { registerOutro } from './outro';
import { registerReports } from './reports';
import { registerAdsSummary } from './ads-summary';
import { registerAds } from './ads';
import { registerTasks } from './tasks';
import { registerBoards } from './boards';
import { registerSheets, checkSheet, sheetPrompt, ownBrand, EDIT_SYSTEM, EDIT_SCHEMA } from './sheets';
import { registerSources, driveId, locate, checkSources, sourcePrompt, withSourceLabels, applySources, applyEdit, SOURCE_SCHEMA, FOOTAGE } from './sources';

export const api = new Router();

const projectOut = (r: any, full = true) => {
  const data = JSON.parse(r.data);
  const sb = data.storyboard;
  const out: any = {
    id: r.id, title: r.title, aspect: r.aspect, customerId: r.customer_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    scenes: sb?.scenes?.length || 0, duration: (sb?.scenes || []).reduce((a: number, s: any) => a + (Number(s.duration) || 0), 0),
    palette: sb?.palette,
    // For the project list: first clip's thumbnail, number of clips, and the request sheet the project belongs to.
    thumb: (() => { const m = sb?.scenes?.find((x: any) => x.media)?.media; return m?.provider === 'drive' ? String(m.url).replace('?', '/thumb?') : null; })(),
    clips: (sb?.scenes || []).reduce((a: number, s: any) => a + (s.shots?.length || (s.media ? 1 : 0)), 0),
    sheet: data.sheet ? {
      title: data.sheet.title, link: data.sheet.link, customer: data.sheet.form?.customer || '', tab: data.sheet.tab || '',
      deadline: data.sheet.form?.deadline || '', urgent: !!data.sheet.form?.urgent, missing: (data.sheet.missing || []).length,
      scenes: (data.sheet.form?.script || []).length,
    } : null,
    // For managing the work: where the project stands, whether it has an outro, its last CapCut export.
    status: data.status || '', outro: !!data.outro, exported: (data.exports || [])[0]?.at || null,
  };
  if (full) Object.assign(out, { storyboard: sb, chat: data.chat || [], sources: data.sources || [], sheet: data.sheet || null, outro: data.outro || null, note: data.note || '', exports: data.exports || [], drive: data.drive || null });
  return out;
};
/** A project as its page shows it: with the customer it belongs to (name, folder, link to the folder on Drive). */
async function withCustomer(out: any) {
  const c = out.customerId ? await get<any>('SELECT id, name, folder, gloc FROM customers WHERE id = ?', out.customerId) : null;
  const g = c?.gloc ? JSON.parse(c.gloc) : null;
  out.customer = c ? { id: c.id, name: c.name, label: g?.label || c.folder, driveUrl: g ? `https://drive.google.com/drive/folders/${g.id}` : null } : null;
  return out;
}
const STATUSES = ['todo', 'doing', 'review', 'fix', 'done'];
/** An outro made by /api/projects/:id/outro… for this project, as the editor saves it. */
const checkOutro = (o: any, id: string) => (o && typeof o === 'object' && String(o.media?.url || '').startsWith(`/api/outro/${id}/`)
  ? { media: o.media, logo: String(o.logo || ''), opts: o.opts || {}, aspect: String(o.aspect || ''), removed: String(o.removed || ''), bg: String(o.bg || ''), small: !!o.small, faint: !!o.faint, at: Number(o.at) || now(),
    palette: (Array.isArray(o.palette) ? o.palette : []).filter((c: any) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 4), colors: (Array.isArray(o.colors) ? o.colors : []).filter((c: any) => /^#[0-9a-f]{6}$/.test(c)).slice(0, 2) }
  : null);
const mustProject = async (id: string) => {
  const r = await get<any>('SELECT * FROM projects WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Không tìm thấy dự án');
  return r;
};

// ------------------------------------------------------------------ meta
// `editor`: the sheet-to-timeline editor needs Claude CLI, ffmpeg and a local disk (the Mac server, not the cloud Worker).
api.get('/api/health', (_q, res) => json(res, 200, { ok: true, mock: MOCK, ffmpeg: !!FFMPEG, editor: !CLOUD_STORAGE_ONLY && !!FFMPEG && !!CLAUDE_CLI, version: '2.0.0' }));

// Where the cloud site sends people for the editor: the Mac's internet address, entered by an admin (or EDITOR_URL).
// Signed-in people with the editor page only; the status says whether that Mac answers and can run the editor.
async function macStatus(url: string) {
  if (!url) return 'none';
  try {
    const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(6000), redirect: 'error' });
    const h: any = await r.json().catch(() => null);
    if (r.status === 403 && /Host/.test(h?.error || '')) return 'blocked'; // the Mac does not accept this hostname yet
    return h?.ok ? (h.editor ? 'ready' : 'no-editor') : 'offline';
  } catch { return 'offline'; }
}
api.get('/api/editor-link', async (_q, res) => {
  const url = String(await getSetting('editor_url', '') || process.env.EDITOR_URL || '');
  json(res, 200, { url, status: await macStatus(url) });
});
api.put('/api/settings/editor-link', async (req, res) => {
  const raw = String((await readJson(req)).url || '').trim();
  let url = '';
  if (raw) {
    // An http(s) address (https:// assumed when left out) whose host is a domain, an IP address or localhost.
    let u: URL | null = null;
    if (!/\s/.test(raw) && (/^https?:\/\//i.test(raw) || !raw.includes('://'))) try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { /* below */ }
    if (!u || !/[.:]/.test(u.hostname) && u.hostname !== 'localhost') throw new HttpError(400, 'Địa chỉ không hợp lệ, ví dụ: https://studio.example.com');
    url = u.origin;
  }
  await setSetting('editor_url', url);
  json(res, 200, { url, status: await macStatus(url) });
});
api.get('/api/providers', async (_q, res) => json(res, 200, { providers: await publicCatalog(), defaults: await getSetting('defaults', {}) }));

// ------------------------------------------------------------------ settings
api.get('/api/settings', async (_q, res) => json(res, 200, {
  keys: await Promise.all(KEY_ENVS.map(async (env) => ({ env, source: await keySource(env), masked: mask(await getKey(env)) }))),
  defaults: await getSetting('defaults', {}),
  customModels: await customModels(),
  ffmpeg: !!FFMPEG,
}));
api.put('/api/settings/keys', async (req, res) => {
  const { env, value } = await readJson(req);
  await setKey(env, value || '');
  json(res, 200, { env, source: await keySource(env), masked: mask(await getKey(env)) });
});
api.put('/api/settings/defaults', async (req, res) => {
  const body = await readJson(req);
  const next = { ...await getSetting('defaults', {}), ...body };
  await setSetting('defaults', next);
  json(res, 200, next);
});
api.post('/api/settings/custom-models', async (req, res) => {
  const { provider, model, remove } = await readJson(req);
  if (!findProvider(provider)) throw new HttpError(400, 'Không rõ nhà cung cấp');
  const id = String(model || '').trim();
  if (!id || id.length > 200) throw new HttpError(400, 'Model ID không hợp lệ');
  const all_ = await customModels();
  const list = new Set(all_[provider] || []);
  remove ? list.delete(id) : list.add(id);
  all_[provider] = [...list];
  await setSetting('custom_models', all_);
  json(res, 200, all_);
});

// ------------------------------------------------------------------ projects
api.get('/api/projects', async (req, res) => {
  const levels=await customerLevels((await currentUser(req))!.id);
  // Projects made from a sheet that have no customer yet look for one by name here (no Drive calls), so the overview
  // and the customer pages agree.
  await syncUnlinkedCustomers();
  const names = new Map((await all<any>('SELECT id, name FROM customers')).map((c) => [c.id, c.name]));
  json(res, 200, (await all<any>('SELECT * FROM projects ORDER BY updated_at DESC')).filter(r=>!r.customer_id||levels.has(r.customer_id)).map((r) => ({ ...projectOut(r, false), customerName: names.get(r.customer_id) || null })));
});
api.post('/api/projects', async (req, res) => {
  const b = await readJson(req);
  const id = uid('p_');
  const sb = b.storyboard ? normalizeStoryboard(b.storyboard) : null;
  if(b.customerId)await requireCustomer((await currentUser(req))!.id,String(b.customerId),'normal');
  const customer = b.customerId && await get('SELECT id FROM customers WHERE id = ?', b.customerId) ? b.customerId : null;
  await run('INSERT INTO projects(id, title, aspect, data, customer_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    id, b.title || sb?.title || 'Dự án mới', b.aspect || '16:9', JSON.stringify({ storyboard: sb, chat: b.chat || [], sources: await checkSources(b.sources), sheet: checkSheet(b.sheet) }), customer, now(), now());
  if (!customer && b.sheet) await autoLinkCustomer(id).catch(() => {});
  json(res, 201, await withCustomer(projectOut(await mustProject(id))));
});
api.get('/api/projects/:id', async (req, res) => json(res, 200, await withCustomer(projectOut(await mustProject(req.params.id)))));
api.put('/api/projects/:id', async (req, res) => {
  const cur = await mustProject(req.params.id);
  const b = await readJson(req);
  const data = JSON.parse(cur.data);
  if (b.storyboard !== undefined) data.storyboard = b.storyboard ? normalizeStoryboard(b.storyboard, data.storyboard) : null;
  if (b.chat !== undefined) data.chat = (b.chat || []).slice(-100);
  if (b.sources !== undefined) data.sources = await checkSources(b.sources);
  if (b.sheet !== undefined) data.sheet = checkSheet(b.sheet);
  if (b.outro !== undefined) data.outro = checkOutro(b.outro, cur.id);
  if (b.status !== undefined) data.status = STATUSES.includes(b.status) ? b.status : '';
  if (b.note !== undefined) data.note = String(b.note || '').slice(0, 5000);
  let customer = cur.customer_id;
  if (b.customerId !== undefined) {
    customer = b.customerId || null;
    if(customer)await requireCustomer((await currentUser(req))!.id,String(customer),'normal');
    data.customerManual = true;
    if (customer && !(await get('SELECT id FROM customers WHERE id = ?', customer))) throw new HttpError(404, 'Không tìm thấy khách hàng');
  }
  await run('UPDATE projects SET title=?, aspect=?, data=?, customer_id=?, updated_at=? WHERE id=?',
    b.title ?? cur.title, b.aspect ?? cur.aspect, JSON.stringify(data), customer, now(), cur.id);
  if (!customer && b.customerId === undefined && (b.sheet || b.sources)) await autoLinkCustomer(cur.id).catch(() => {});
  json(res, 200, await withCustomer(projectOut(await mustProject(cur.id))));
});
// The project's own place on Drive (its folder, or the finished video), pasted as a link; empty removes it. A link
// inside a customer's folder also tells which customer the project belongs to, if it has none yet.
api.post('/api/projects/:id/drive', async (req, res) => {
  const cur = await mustProject(req.params.id);
  const link = String((await readJson(req)).link || '').trim();
  const data = JSON.parse(cur.data);
  if (!link) data.drive = null;
  else {
    const id = driveId(link);
    if (!id) throw new HttpError(400, 'Đây không phải link Google Drive');
    const { account, file } = await locate(id);
    const folder = file.mimeType === FOLDER_MIME;
    data.drive = { id: file.id, name: file.name, folder, account, url: folder ? `https://drive.google.com/drive/folders/${file.id}` : `https://drive.google.com/file/d/${file.id}/view` };
  }
  await run('UPDATE projects SET data=?, updated_at=? WHERE id=?', JSON.stringify(data), now(), cur.id);
  if (data.drive) await autoLinkCustomer(cur.id, { force: true }).catch(() => {});
  json(res, 200, await withCustomer(projectOut(await mustProject(cur.id))));
});
// Look for the project's customer now: on Drive (where its link and footage are), then by the sheet's customer name.
api.post('/api/projects/:id/customer/auto', async (req, res) => {
  await autoLinkCustomer((await mustProject(req.params.id)).id, { force: true });
  json(res, 200, await withCustomer(projectOut(await mustProject(req.params.id))));
});
api.post('/api/projects/:id/duplicate', async (req, res) => {
  const cur = await mustProject(req.params.id);
  const id = uid('p_');
  await run('INSERT INTO projects(id, title, aspect, data, customer_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, cur.title + ' (bản sao)', cur.aspect, cur.data, cur.customer_id, now(), now());
  json(res, 201, projectOut(await mustProject(id), false));
});
api.delete('/api/projects/:id', async (req, res) => {
  await mustProject(req.params.id);
  // Duplicates share asset files with the original: hand those over instead of deleting them.
  for (const a of await all<any>('SELECT id, file FROM assets WHERE project_id = ?', req.params.id)) {
    const heir = await get<any>("SELECT id FROM projects WHERE id <> ? AND instr(data, ?) > 0 LIMIT 1", req.params.id, '/assets/' + a.file);
    if (heir) { await run('UPDATE assets SET project_id = ? WHERE id = ?', heir.id, a.id); continue; }
    fs.unlink(path.join(ASSET_DIR, a.file), () => {});
    await run('DELETE FROM assets WHERE id = ?', a.id);
  }
  await run('DELETE FROM renders WHERE project_id = ?', req.params.id);
  await run('DELETE FROM jobs WHERE project_id = ?', req.params.id);
  await run('DELETE FROM projects WHERE id = ?', req.params.id);
  json(res, 200, { ok: true });
});

// ------------------------------------------------------------------ AI script writing
async function logged<T>(o: { projectId?: string; provider: string; model: string; kind: string }, fn: () => Promise<T>) {
  const t0 = now();
  try {
    const r = await fn();
    await run('INSERT INTO ai_calls(project_id, provider, model, kind, ms, ok, created_at) VALUES(?,?,?,?,?,1,?)', o.projectId ?? null, o.provider, o.model, o.kind, now() - t0, now());
    return r;
  } catch (e: any) {
    await run('INSERT INTO ai_calls(project_id, provider, model, kind, ms, ok, error, created_at) VALUES(?,?,?,?,?,0,?,?)', o.projectId ?? null, o.provider, o.model, o.kind, now() - t0, String(e.message).slice(0, 500), now());
    throw e;
  }
}

// With Drive sources the model also sees their thumbnails, keeps only the ones that fit and puts them behind scenes.
async function write(b: any, kind: string, prompt: string) {
  const sources = await checkSources(b.sources);
  // From a request form: an editor's cut list (shots + timed text) over the client's footage, not text-card layouts.
  if (b.edit) {
    const { text, images } = await sourcePrompt(sources, prompt, FOOTAGE);
    const raw = await logged({ ...b, kind }, async () => await writeStoryboard(b.provider, b.model, text, { images, schema: EDIT_SCHEMA, system: EDIT_SYSTEM }));
    const { storyboard, picked } = applyEdit(raw, sources);
    return { raw: storyboard, picked };
  }
  if (!sources.length) return { raw: await logged({ ...b, kind }, async () => await writeStoryboard(b.provider, b.model, prompt)), picked: null };
  const { text, images } = await sourcePrompt(sources, prompt);
  const raw = await logged({ ...b, kind }, async () => await writeStoryboard(b.provider, b.model, text, { images, schema: SOURCE_SCHEMA }));
  return { raw, picked: applySources(raw, sources) };
}
api.post('/api/ai/storyboard', async (req, res) => {
  const b = await readJson(req);
  // A request form replaces the brief (the box then only holds extra instructions) and is the client's, not our brand.
  const sheet = checkSheet(b.sheet);
  if (!b.prompt?.trim() && !sheet) throw new HttpError(400, 'Hãy mô tả video bạn muốn.');
  if (sheet) Object.assign(b, { brand: false, edit: true });
  const prompt = sheet
    ? sheetPrompt(sheet) + (b.prompt?.trim() ? `\n\nExtra notes from the editor: ${b.prompt.trim()}` : '') + '\n\nCut this ad now.'
    : generatePrompt(b);
  const { raw, picked } = await write(b, 'storyboard', prompt);
  const sb = normalizeStoryboard(raw);
  if (b.brand) { sb.font = 'brand'; if (!Object.values(BRAND_PALETTES).some((p) => p.bg1 === sb.palette.bg1?.toLowerCase())) sb.palette = BRAND_PALETTES.night; }
  json(res, 200, { storyboard: sb, picked });
});
api.post('/api/ai/refine', async (req, res) => {
  const b = await readJson(req);
  if (!b.storyboard || !b.instruction?.trim()) throw new HttpError(400, 'Thiếu storyboard hoặc yêu cầu.');
  const sources = await checkSources(b.sources);
  const sheet = checkSheet(b.sheet);
  const edit = b.storyboard.mode === 'edit';
  // A cut is the client's footage; a video made from a form's script keeps our brand kit only when the form is ours.
  if (sheet) b.brand = !edit && ownBrand(sheet);
  const current = sources.length ? withSourceLabels(b.storyboard, sources) : b.storyboard;
  const prompt = edit
    ? `${sheet ? sheetPrompt(sheet) + '\n\n' : ''}Current cut (same JSON shape you answer in):\n${JSON.stringify(current)}\n\nApply this change and return the FULL updated cut; keep everything the request does not touch.\nChange: ${b.instruction}`
    : (sheet ? sheetPrompt(sheet) + '\n\n' : '') + refinePrompt({ ...b, storyboard: current });
  const { raw, picked } = await write({ ...b, sources, edit }, 'refine', prompt);
  json(res, 200, { storyboard: normalizeStoryboard(raw, b.storyboard), picked });
});
api.get('/api/ai/usage', async (_q, res) => json(res, 200, await all(
  'SELECT provider, model, kind, COUNT(*) calls, SUM(ok) ok, ROUND(AVG(ms)) avg_ms FROM ai_calls GROUP BY provider, model, kind ORDER BY calls DESC')));

// ------------------------------------------------------------------ generation jobs
api.post('/api/jobs', async (req, res) => {
  const b = await readJson(req);
  const list = Array.isArray(b.jobs) ? b.jobs : [b];
  const ids: string[] = [];
  for (const j of list) {
    const p = findProvider(j.provider);
    if (!p) throw new HttpError(400, 'Không rõ nhà cung cấp ' + j.provider);
    if (!['video', 'image', 'tts'].includes(j.kind) || p.kind !== j.kind) throw new HttpError(400, `${p.name} không hỗ trợ "${j.kind}"`);
    if (!p.mock && !await getKey(p.keyEnv)) throw new HttpError(400, `Chưa có API key cho ${p.name} (${p.keyEnv}). Mở ⚙︎ Cài đặt.`);
    if (!String(j.prompt || '').trim()) throw new HttpError(400, 'Thiếu prompt / lời thoại.');
    ids.push(await createJob({
      projectId: j.projectId, sceneId: j.sceneId, kind: j.kind, provider: j.provider, model: j.model,
      input: { prompt: j.prompt, aspect: j.aspect, duration: j.duration, voice: j.voice, instructions: j.instructions },
    }));
  }
  const rows = await Promise.all(ids.map(async (id) => publicJob(await get('SELECT * FROM jobs WHERE id = ?', id))));
  json(res, 201, Array.isArray(b.jobs) ? rows : rows[0]);
});
api.get('/api/jobs', async (req, res) => {
  const pid = req.query.get('projectId');
  const rows = pid ? await all('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 200', pid)
    : await all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200');
  json(res, 200, rows.map(publicJob));
});
api.get('/api/jobs/:id', async (req, res) => {
  const j = await get('SELECT * FROM jobs WHERE id = ?', req.params.id);
  if (!j) throw new HttpError(404, 'Không tìm thấy job');
  json(res, 200, publicJob(j));
});
api.post('/api/jobs/:id/cancel', async (req, res) => {
  await run("UPDATE jobs SET status='failed', error='Đã huỷ', updated_at=? WHERE id=? AND status IN ('queued','running')", now(), req.params.id);
  json(res, 200, publicJob(await get('SELECT * FROM jobs WHERE id = ?', req.params.id)));
});

// Template gallery previews: jobs without a project, tagged sceneId "tpl:<templateId>".
api.get('/api/templates/previews', async (_q, res) => json(res, 200,
  (await all("SELECT * FROM jobs WHERE project_id IS NULL AND scene_id LIKE 'tpl:%' ORDER BY created_at DESC LIMIT 500")).map(publicJob)));

// A clip the user made on an AI website (Higgsfield, Kling…) and uploaded as the template's sample.
api.post('/api/templates/:id/preview', async (req, res) => {
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!mime.startsWith('video/')) throw new HttpError(400, 'Chỉ nhận file video');
  const buf = await readBody(req, MAX_UPLOAD);
  if (!buf.length) throw new HttpError(400, 'File rỗng');
  const a = await saveAsset(buf, mime, { kind: 'video', source: 'upload' });
  const source = String(req.query.get('source') || 'Tải lên').slice(0, 60);
  const prompt = String(req.query.get('prompt') || '');
  const id = uid('j_');
  await run('INSERT INTO jobs(id, project_id, scene_id, kind, provider, model, input, status, result, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, null, 'tpl:' + req.params.id, 'video', source, '', JSON.stringify({ prompt }), 'succeeded',
    JSON.stringify({ type: 'video', assetId: a.id, url: a.url, mime, provider: source, prompt }), now(), now());
  json(res, 201, publicJob(await get('SELECT * FROM jobs WHERE id = ?', id)));
});

// ------------------------------------------------------------------ renders (exported videos)
const renderOut = (r: any) => ({
  id: r.id, projectId: r.project_id, status: r.status, createdAt: r.created_at,
  url: `/assets/${r.file}`, download: `/api/renders/${r.id}/download`, mime: r.mime, bytes: r.bytes,
});
api.post('/api/projects/:id/renders', async (req, res) => {
  const p = await mustProject(req.params.id);
  const mime = String(req.headers['content-type'] || 'video/webm').split(';')[0];
  if (!mime.startsWith('video/')) throw new HttpError(400, 'Chỉ nhận file video');
  const buf = await readBody(req, MAX_UPLOAD);
  if (!buf.length) throw new HttpError(400, 'File rỗng');
  const a = await saveAsset(buf, mime, { projectId: p.id, kind: 'render' });
  const id = uid('r_');
  let transcodeJob: string | null = null;
  if (mime !== 'video/mp4' && FFMPEG && req.query.get('mp4') === '1') {
    transcodeJob = await createJob({ projectId: p.id, kind: 'transcode', provider: 'ffmpeg', model: 'libx264', input: { prompt: 'mp4', file: a.file, assetId: a.id } });
  }
  await run('INSERT INTO renders(id, project_id, asset_id, status, created_at) VALUES(?,?,?,?,?)', id, p.id, a.id, transcodeJob ? 'processing' : 'ready', now());
  json(res, 201, { id, transcodeJob });
});
api.get('/api/projects/:id/renders', async (req, res) => {
  // Mark finished transcodes ready.
  await run(`UPDATE renders SET status='ready' WHERE status='processing' AND project_id=? AND asset_id IN (SELECT id FROM assets WHERE mime='video/mp4')`, req.params.id);
  json(res, 200, (await all('SELECT r.*, a.file, a.mime, a.bytes FROM renders r JOIN assets a ON a.id = r.asset_id WHERE r.project_id = ? ORDER BY r.created_at DESC', req.params.id)).map(renderOut));
});
api.get('/api/renders/:id/download', async (req, res) => {
  const r = await get<any>('SELECT r.*, a.file, p.title FROM renders r JOIN assets a ON a.id = r.asset_id JOIN projects p ON p.id = r.project_id WHERE r.id = ?', req.params.id);
  if (!r) throw new HttpError(404, 'Không tìm thấy');
  const slug = String(r.title).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'video';
  if (!sendFile(req, res, ASSET_DIR, r.file, { download: `${slug}.${path.extname(r.file).slice(1)}` })) throw new HttpError(404, 'Mất file');
});
api.delete('/api/renders/:id', async (req, res) => {
  const r = await get<any>('SELECT r.*, a.file FROM renders r JOIN assets a ON a.id = r.asset_id WHERE r.id = ?', req.params.id);
  if (r) {
    fs.unlink(path.join(ASSET_DIR, r.file), () => {});
    await run('DELETE FROM renders WHERE id = ?', r.id); await run('DELETE FROM assets WHERE id = ?', r.asset_id);
  }
  json(res, 200, { ok: true });
});

registerAuth(api);
registerNotifications(api);
registerWorkspace(api);
registerSources(api);
registerSheets(api);
registerProxies(api);
registerCapcut(api);
registerOutro(api);
registerReports(api);
registerAds(api);
registerAdsSummary(api);
registerTasks(api);
registerBoards(api);

export { ProviderError };
