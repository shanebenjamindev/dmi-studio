import {drainNotifications} from './notifications';
import {remindTasks,settleStages} from './task-flow';
import {normalizeAllBoards} from './board-flow';
import {projectsAsServices} from './project-services';
// DMI Workspace server entry.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PORT, HOST, ASSET_DIR, WEB_DIST, FFMPEG, PUBLIC_URL } from './config';
import { HttpError, IMMUTABLE, json, sendFile, type Req } from './http';
import { api } from './routes';
import { guard, type User } from './auth';
import { withTrail, logError } from './audit';
import { cloudDatabase, repairData } from './db';
import './app'; // hands the API entry to the Claude connector (server/mcp.ts), as on the Worker

// Hostnames this server answers to. Checking Host blocks DNS rebinding; checking Origin on writes
// blocks other websites from driving the API (and spending API credit) through the user's browser.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', ...(process.env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)]);
// Deployed: the configured public hostname is trusted too.
if (PUBLIC_URL) ALLOWED_HOSTS.add(new URL(PUBLIC_URL).hostname.toLowerCase());
if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
  const name = os.hostname().toLowerCase();
  ALLOWED_HOSTS.add(name).add(name.replace(/\.local$/, '') + '.local');
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) ALLOWED_HOSTS.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
}
const hostnameOf = (hostPort: string) => hostPort.toLowerCase().replace(/:\d+$/, '');
function trustedRequest(req: http.IncomingMessage) {
  if (!ALLOWED_HOSTS.has(hostnameOf(req.headers.host || ''))) return false;
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, scripts)
  if (/^\/api\/(mcp|oauth\/(token|register))$/.test(new URL(req.url || '/', 'http://local').pathname)) return true; // the Claude connector's token endpoints (server/mcp.ts)
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host).toLowerCase(); } catch { return false; }
}

const server = http.createServer(async (req0, res) => {
  const req = req0 as Req;
  const url = new URL(req.url || '/', 'http://local');
  req.path = url.pathname; req.query = url.searchParams;
  // Mail a change has queued goes out as soon as it is answered; the minute's timer retries what failed.
  if (req.method !== 'GET' && req.path.startsWith('/api/')) res.on('finish', () => { void drainNotifications().catch(() => console.error('Chưa xử lý được hàng đợi email')); });

  if (!trustedRequest(req)) return json(res, 403, { error: 'Yêu cầu bị chặn: Host/Origin không hợp lệ (đặt ALLOWED_HOSTS nếu cần)' });

  let user: User | null = null;
  try {
    const isApi = req.path.startsWith('/api/') || /^\/\.well-known\/(oauth-|openid-configuration)/.test(req.path);
    if (isApi || req.path.startsWith('/assets/')) user = await guard(req);
    if (isApi) {
      const m = api.match(req.method || 'GET', req.path);
      if (!m) throw new HttpError(404, 'Không có API này');
      req.params = m.params;
      return await withTrail(req, res, user, () => m.h(req, res));
    }
    if (req.path.startsWith('/assets/')) {
      if (!sendFile(req, res, ASSET_DIR, req.path.slice(8), { cache: IMMUTABLE, untrusted: true })) json(res, 404, { error: 'Không tìm thấy file' });
      return;
    }
    // Front-end (built by esbuild into web/dist). SPA fallback to index.html.
    if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Giao diện chưa được build. Chạy: npm run build  (hoặc npm run dev)');
    }
    // Built files under /static/ have their content's hash in their name; index.html, which names them, is checked each visit.
    const ui = (rel: string) => sendFile(req, res, WEB_DIST, rel, { cache: rel.startsWith('/static/') ? IMMUTABLE : undefined, precompressed: true });
    if (ui(req.path === '/' ? 'index.html' : req.path)) return;
    ui('index.html');
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) { console.error('✖', req.method, req.path, e); if (req.path.startsWith('/api/')) await logError(req, user, e, status); }
    if (!res.headersSent) json(res, status, { error: e.message || 'Lỗi máy chủ', ...(e instanceof HttpError && e.need ? { need: e.need } : {}) });
    else res.end();
  }
});

// A stray stream error (a dropped Google download, a client gone mid-file) must not take every user offline.
process.on('uncaughtException', (e) => console.error('✖ Lỗi không xử lý (server vẫn chạy):', e?.message || e));
process.on('unhandledRejection', (e: any) => console.error('✖ Promise lỗi (server vẫn chạy):', e?.message || e));

// Large video uploads can take longer than Node's default 5-minute request timeout.
server.requestTimeout = 0;
server.listen(PORT, HOST, () => {
  console.log(`\n  ▶ DMI Workspace  ${PUBLIC_URL || `http://localhost:${PORT}`}`);
  console.log(`    Database: ${cloudDatabase ? 'Cloudflare D1 (dùng chung)' : 'SQLite local'}`);
  console.log(`    ffmpeg: ${FFMPEG ? 'có (trình dựng HyperFrames dùng được)' : 'không có (trình dựng cần ffmpeg)'}\n`);
});

const mailTimer=setInterval(()=>{void drainNotifications().catch(()=>console.error('Chưa xử lý được hàng đợi email'));},60000);
mailTimer.unref();
// As the cloud's cron does: data a change may leave out of step is set right every ten minutes.
const repairTimer=setInterval(()=>{void repairData().catch(()=>console.error('Chưa sửa được dữ liệu lệch'));void settleStages().then(()=>projectsAsServices()).then(()=>normalizeAllBoards()).then(()=>remindTasks()).catch(()=>console.error('Chưa gửi được nhắc việc'));},600000);
repairTimer.unref();
// And once soon after starting: projects become their customers' services, boards follow the workflow.
setTimeout(()=>{void projectsAsServices().then(()=>normalizeAllBoards()).catch(()=>console.error('Chưa chuẩn hoá được dịch vụ và board'));},3000).unref();
