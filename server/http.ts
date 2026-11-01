// Tiny HTTP toolkit: router with :params, JSON helpers, static files with Range support.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

export type Req = http.IncomingMessage & { params: Record<string, string>; query: URLSearchParams; path: string };
export type Res = http.ServerResponse;
type Handler = (req: Req, res: Res) => any;

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export class Router {
  private routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  on(method: string, pattern: string, h: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, h });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  put(p: string, h: Handler) { return this.on('PUT', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }
  match(method: string, p: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = p.match(r.re);
      if (!m) continue;
      try { return { h: r.h, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
      catch { throw new HttpError(400, 'URL không hợp lệ'); }
    }
    return null;
  }
}

/** Origin the browser sees: PUBLIC_URL when set, else the proxy's forwarded scheme (https on cloud hosts) + Host. */
export function publicOrigin(req: http.IncomingMessage) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}

export function json(res: Res, status: number, body: any) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Dữ liệu quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson<T = any>(req: http.IncomingMessage): Promise<T> {
  const buf = await readBody(req, 5 * 1024 * 1024);
  if (!buf.length) return {} as T;
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON không hợp lệ'); }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.map': 'application/json', '.woff2': 'font/woff2',
};

// Serves a file inside `root`; honours Range so <video> can seek. Returns false when not found.
export function sendFile(req: http.IncomingMessage, res: Res, root: string, rel: string, opts: { cache?: string; download?: string } = {}) {
  const file = path.join(root, path.normalize('/' + rel).slice(1));
  if (!file.startsWith(root)) return false;
  let st: fs.Stats;
  try { st = fs.statSync(file); if (!st.isFile()) return false; } catch { return false; }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers: Record<string, string | number> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': opts.cache || 'no-cache' };
  if (opts.download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    // "bytes=-N" means the last N bytes; a suffix longer than the file covers all of it.
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'content-length': st.size });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  }
  return true;
}
