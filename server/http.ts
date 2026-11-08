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

/** The request's path with each part decoded once, as the router hands ids to the handlers: every check here runs on
 *  what the handler will act on (an id written as %63_… is c_…, and is checked as such). */
export function pathOf(req: Req) {
  const r = req as Req & { decodedPath?: string };
  if (r.decodedPath === undefined) {
    try { r.decodedPath = req.path.split('/').map((part) => decodeURIComponent(part)).join('/'); }
    catch { throw new HttpError(400, 'URL không hợp lệ'); }
  }
  return r.decodedPath;
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
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
};

/** Types a file someone uploaded may be shown as in the browser; any other (HTML, SVG, scripts…) is only downloaded. */
const INLINE_SAFE = /^(image\/(png|jpeg|webp|gif|avif|bmp|x-icon)|video\/|audio\/|application\/pdf|text\/(plain|csv))/i;
/** Headers for a file someone uploaded, so it can never run as a page of this site: not sniffed into another type,
 *  downloaded unless it is a picture, video, sound, PDF or plain text, and text opened without scripts. */
export function untrustedHeaders(type: string, name = '') {
  const h: Record<string, string> = { 'x-content-type-options': 'nosniff' };
  if (!INLINE_SAFE.test(type)) h['content-disposition'] = name ? `attachment; filename*=UTF-8''${encodeURIComponent(name)}` : 'attachment';
  else if (/^text\//i.test(type)) h['content-security-policy'] = "sandbox; default-src 'none'";
  return h;
}

/** For files whose name changes with their content (uploads, the UI's hashed build files): kept by browsers for good. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The .br or .gz copy of `file` made at build time that this browser accepts, if there is one. */
function compressedCopy(req: http.IncomingMessage, file: string) {
  const accepts = String(req.headers['accept-encoding'] || '');
  for (const [encoding, ext] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!new RegExp(`\\b${encoding}\\b`).test(accepts)) continue;
    try { const st = fs.statSync(file + ext); if (st.isFile()) return { file: file + ext, size: st.size, encoding }; } catch { /* no copy */ }
  }
  return null;
}

// Serves a file inside `root`; honours Range so <video> can seek, and If-None-Match so an unchanged file is not sent
// again. With `precompressed`, a .br/.gz copy next to the file goes to browsers that accept it. False when not found.
export function sendFile(req: http.IncomingMessage, res: Res, root: string, rel: string, opts: { cache?: string; download?: string; precompressed?: boolean; untrusted?: boolean } = {}) {
  const file = path.join(root, path.normalize('/' + rel).slice(1));
  if (!file.startsWith(root)) return false;
  let st: fs.Stats;
  try { st = fs.statSync(file); if (!st.isFile()) return false; } catch { return false; }
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const validators: Record<string, string> = { etag, 'cache-control': opts.cache || 'no-cache', ...(opts.precompressed ? { vary: 'accept-encoding' } : {}) };
  if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) { res.writeHead(304, validators); res.end(); return true; }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers: Record<string, string | number> = { ...validators, 'content-type': type, 'accept-ranges': 'bytes', ...(opts.untrusted ? untrustedHeaders(type, path.basename(file)) : {}) };
  if (opts.download) headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`;
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    // "bytes=-N" means the last N bytes; a suffix longer than the file covers all of it.
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return true; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    const body = (opts.precompressed && compressedCopy(req, file)) || { file, size: st.size, encoding: '' };
    res.writeHead(200, { ...headers, 'content-length': body.size, ...(body.encoding ? { 'content-encoding': body.encoding } : {}) });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(body.file).on('error', () => res.destroy()).pipe(res);
  }
  return true;
}
