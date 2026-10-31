// REST API.
import fs from 'node:fs';
import path from 'node:path';
import { Router, HttpError, json, readJson, readBody, sendFile } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { ASSET_DIR, FFMPEG, MAX_UPLOAD, MOCK } from './config';
import { publicCatalog, findProvider, KEY_ENVS, getKey, keySource, setKey, mask, customModels } from './providers/registry';
import { writeStoryboard, ProviderError } from './providers/llm';
import { generatePrompt, refinePrompt, normalizeStoryboard, BRAND_PALETTES } from './storyboard';
import { createJob, publicJob, saveAsset } from './jobs';
import { registerWorkspace } from './workspace';
import { registerAuth } from './auth';

export const api = new Router();

const projectOut = (r: any, full = true) => {
  const data = JSON.parse(r.data);
  const sb = data.storyboard;
  const out: any = {
    id: r.id, title: r.title, aspect: r.aspect, customerId: r.customer_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    scenes: sb?.scenes?.length || 0, duration: (sb?.scenes || []).reduce((a: number, s: any) => a + (Number(s.duration) || 0), 0),
    palette: sb?.palette,
  };
  if (full) Object.assign(out, { storyboard: sb, chat: data.chat || [] });
  return out;
};
const mustProject = async (id: string) => {
  const r = await get<any>('SELECT * FROM projects WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Không tìm thấy dự án');
  return r;
};

// ------------------------------------------------------------------ meta
api.get('/api/health', (_q, res) => json(res, 200, { ok: true, mock: MOCK, ffmpeg: !!FFMPEG, version: '2.0.0' }));
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
api.get('/api/projects', async (_q, res) => json(res, 200, (await all('SELECT * FROM projects ORDER BY updated_at DESC')).map((r) => projectOut(r, false))));
api.post('/api/projects', async (req, res) => {
  const b = await readJson(req);
  const id = uid('p_');
  const sb = b.storyboard ? normalizeStoryboard(b.storyboard) : null;
  const customer = b.customerId && await get('SELECT id FROM customers WHERE id = ?', b.customerId) ? b.customerId : null;
  await run('INSERT INTO projects(id, title, aspect, data, customer_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    id, b.title || sb?.title || 'Dự án mới', b.aspect || '16:9', JSON.stringify({ storyboard: sb, chat: b.chat || [] }), customer, now(), now());
  json(res, 201, projectOut(await mustProject(id)));
});
api.get('/api/projects/:id', async (req, res) => json(res, 200, projectOut(await mustProject(req.params.id))));
api.put('/api/projects/:id', async (req, res) => {
  const cur = await mustProject(req.params.id);
  const b = await readJson(req);
  const data = JSON.parse(cur.data);
  if (b.storyboard !== undefined) data.storyboard = b.storyboard ? normalizeStoryboard(b.storyboard, data.storyboard) : null;
  if (b.chat !== undefined) data.chat = (b.chat || []).slice(-100);
  await run('UPDATE projects SET title=?, aspect=?, data=?, updated_at=? WHERE id=?',
    b.title ?? cur.title, b.aspect ?? cur.aspect, JSON.stringify(data), now(), cur.id);
  json(res, 200, projectOut(await mustProject(cur.id)));
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

api.post('/api/ai/storyboard', async (req, res) => {
  const b = await readJson(req);
  if (!b.prompt?.trim()) throw new HttpError(400, 'Hãy mô tả video bạn muốn.');
  const raw = await logged({ ...b, kind: 'storyboard' }, async () => await writeStoryboard(b.provider, b.model, generatePrompt(b)));
  const sb = normalizeStoryboard(raw);
  if (b.brand) { sb.font = 'brand'; if (!Object.values(BRAND_PALETTES).some((p) => p.bg1 === sb.palette.bg1?.toLowerCase())) sb.palette = BRAND_PALETTES.night; }
  json(res, 200, { storyboard: sb });
});
api.post('/api/ai/refine', async (req, res) => {
  const b = await readJson(req);
  if (!b.storyboard || !b.instruction?.trim()) throw new HttpError(400, 'Thiếu storyboard hoặc yêu cầu.');
  const raw = await logged({ ...b, kind: 'refine' }, async () => await writeStoryboard(b.provider, b.model, refinePrompt(b)));
  json(res, 200, { storyboard: normalizeStoryboard(raw, b.storyboard) });
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
registerWorkspace(api);

export { ProviderError };
