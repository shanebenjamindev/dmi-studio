import {customerLevels,requireCustomer} from './customer-access';
// REST API.
import fs from 'node:fs';
import path from 'node:path';
import { Router, HttpError, json, readJson, sendFile } from './http';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { ASSET_DIR, FFMPEG, CLOUD_STORAGE_ONLY } from './config';
import { FOLDER_MIME } from './google';
import { registerWorkspace, autoLinkCustomer, syncUnlinkedCustomers } from './workspace';
import {registerNotifications} from './notifications';
import {currentUser, registerAuth } from './auth';
import { registerReports } from './reports';
import { registerAdsSummary } from './ads-summary';
import { registerAds } from './ads';
import { registerTasks } from './tasks';
import { registerBoards } from './boards';
import { registerAdmin } from './admin';
import { registerCustomerTabs } from './customer-tabs';
import { registerQuickNotes } from './quick-notes';
import { registerSearch } from './search';
import { registerSupport } from './support';
import { registerMcp } from './mcp';
import { registerHyperframes } from './hyperframes';
import { registerSheets, checkSheet } from './sheets';
import { registerSources, driveId, locate, checkSources } from './sources';

export const api = new Router();

const projectOut = (r: any, full = true) => {
  const data = JSON.parse(r.data);
  const out: any = {
    id: r.id, title: r.title, aspect: r.aspect, customerId: r.customer_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
    // For the project list: its first footage's thumbnail, how much footage, and the request sheet it belongs to.
    thumb: data.sources?.[0]?.thumb || null, footage: (data.sources || []).length,
    sheet: data.sheet ? {
      title: data.sheet.title, link: data.sheet.link, customer: data.sheet.form?.customer || '', tab: data.sheet.tab || '',
      deadline: data.sheet.form?.deadline || '', urgent: !!data.sheet.form?.urgent, missing: (data.sheet.missing || []).length,
      scenes: (data.sheet.form?.script || []).length,
    } : null,
    status: data.status || '',
  };
  if (full) Object.assign(out, { sources: data.sources || [], sheet: data.sheet || null, note: data.note || '', drive: data.drive || null });
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
const mustProject = async (id: string) => {
  const r = await get<any>('SELECT * FROM projects WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Không tìm thấy dự án');
  return r;
};

// ------------------------------------------------------------------ meta
// `editor`: the editor needs ffmpeg and a local disk for HyperFrames (the Mac server, not the cloud Worker).
api.get('/api/health', (_q, res) => json(res, 200, { ok: true, ffmpeg: !!FFMPEG, editor: !CLOUD_STORAGE_ONLY && !!FFMPEG, version: '2.0.0' }));

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
  if(b.customerId)await requireCustomer((await currentUser(req))!.id,String(b.customerId),'normal');
  const customer = b.customerId && await get('SELECT id FROM customers WHERE id = ?', b.customerId) ? b.customerId : null;
  await run('INSERT INTO projects(id, title, aspect, data, customer_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
    id, b.title || 'Dự án mới', b.aspect || '16:9', JSON.stringify({ sources: await checkSources(b.sources), sheet: checkSheet(b.sheet) }), customer, now(), now());
  if (!customer && b.sheet) await autoLinkCustomer(id).catch(() => {});
  json(res, 201, await withCustomer(projectOut(await mustProject(id))));
});
api.get('/api/projects/:id', async (req, res) => json(res, 200, await withCustomer(projectOut(await mustProject(req.params.id)))));
api.put('/api/projects/:id', async (req, res) => {
  const cur = await mustProject(req.params.id);
  const b = await readJson(req);
  const data = JSON.parse(cur.data);
  if (b.sources !== undefined) data.sources = await checkSources(b.sources);
  if (b.sheet !== undefined) data.sheet = checkSheet(b.sheet);
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

// ------------------------------------------------------------------ renders (exported videos)
const renderOut = (r: any) => ({
  id: r.id, projectId: r.project_id, status: r.status, createdAt: r.created_at,
  url: `/assets/${r.file}`, download: `/api/renders/${r.id}/download`, mime: r.mime, bytes: r.bytes,
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
registerReports(api);
registerAds(api);
registerAdsSummary(api);
registerTasks(api);
registerBoards(api);
registerAdmin(api);
registerCustomerTabs(api);
registerQuickNotes(api);
registerSearch(api);
registerSupport(api);
registerMcp(api);
registerHyperframes(api);

