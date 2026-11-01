// DM Studio server entry.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PORT, HOST, ASSET_DIR, WEB_DIST, MOCK, FFMPEG, PUBLIC_URL } from './config';
import { HttpError, json, sendFile, type Req } from './http';
import { api, ProviderError } from './routes';
import { startWorker } from './jobs';
import { publicCatalog } from './providers/registry';
import { guard } from './auth';
import { cloudDatabase } from './db';

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
  try { return new URL(origin).host.toLowerCase() === String(req.headers.host).toLowerCase(); } catch { return false; }
}

const server = http.createServer(async (req0, res) => {
  const req = req0 as Req;
  const url = new URL(req.url || '/', 'http://local');
  req.path = url.pathname; req.query = url.searchParams;

  if (!trustedRequest(req)) return json(res, 403, { error: 'Yêu cầu bị chặn: Host/Origin không hợp lệ (đặt ALLOWED_HOSTS nếu cần)' });

  try {
    if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) await guard(req);
    if (req.path.startsWith('/api/')) {
      const m = api.match(req.method || 'GET', req.path);
      if (!m) throw new HttpError(404, 'Không có API này');
      req.params = m.params;
      return await m.h(req, res);
    }
    if (req.path.startsWith('/assets/')) {
      if (!sendFile(req, res, ASSET_DIR, req.path.slice(8), { cache: 'public, max-age=31536000, immutable' })) json(res, 404, { error: 'Không tìm thấy file' });
      return;
    }
    // Front-end (built by esbuild into web/dist). SPA fallback to index.html.
    if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Giao diện chưa được build. Chạy: npm run build  (hoặc npm run dev)');
    }
    if (sendFile(req, res, WEB_DIST, req.path === '/' ? 'index.html' : req.path)) return;
    sendFile(req, res, WEB_DIST, 'index.html');
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : e instanceof ProviderError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 500;
    if (status >= 500) console.error('✖', req.method, req.path, e);
    if (!res.headersSent) json(res, status, { error: e.message || 'Lỗi máy chủ' });
    else res.end();
  }
});

// Large video uploads can take longer than Node's default 5-minute request timeout.
server.requestTimeout = 0;
await startWorker();
const ready = (await publicCatalog()).filter((p) => p.configured && !p.mock).map((p) => p.name);
server.listen(PORT, HOST, () => {
  console.log(`\n  ▶ DM Studio  ${PUBLIC_URL || `http://localhost:${PORT}`}`);
  console.log(`    Database: ${cloudDatabase ? 'Cloudflare D1 (dùng chung)' : 'SQLite local'}`);
  console.log(`    Nền tảng đã có key: ${ready.length ? [...new Set(ready)].join(', ') : 'chưa có — thêm trong ⚙︎ Cài đặt hoặc file .env'}`);
  console.log(`    ffmpeg: ${FFMPEG ? 'có (xuất MP4)' : 'không có (xuất WebM/MP4 tuỳ trình duyệt)'}${MOCK ? '   · CHẾ ĐỘ DEMO' : ''}\n`);
});
