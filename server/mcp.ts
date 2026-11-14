// Claude connector: DMI Workspace as a remote MCP server (Streamable HTTP, stateless JSON answers) at /api/mcp, signed in
// with OAuth on each person's own DMI account. Claude (claude.ai, Desktop, Code) registers itself, the person approves it on
// a DMI page, and every tool runs as an ordinary request of theirs through the API: the same guard, rights and audit log
// as the app, so Claude sees and changes no more than they could. No AI is paid for here: Claude runs on their own plan.
import crypto from 'node:crypto';
import http from 'node:http';
import { Readable } from 'node:stream';
import { HttpError, json, readBody, publicOrigin, type Req, type Res, type Router } from './http';
import { all, get, run, now } from './db';
import { ACTING, USER_SQL, currentUser, type User } from './auth';
import { CLOUD_STORAGE_ONLY } from './config';
import { brief, need, read, seg, str, vn, when, write, type Call, type Tool } from './mcp-kit';
import { VIDEO_TOOLS } from './video-mcp';

const CODE_TTL = 10 * 60e3, ACCESS_TTL = 60 * 60e3, REFRESH_TTL = 60 * 24 * 60 * 60e3;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Where Claude may be sent back with a code: https, or a loopback address (Claude Code and Desktop listen on one).
function redirectOk(u: string) {
  try {
    const x = new URL(u);
    return !x.hash && (x.protocol === 'https:' || x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname));
  } catch { return false; }
}
const mcpUrl = (req: http.IncomingMessage) => publicOrigin(req) + '/api/mcp';

// ---------------------------------------------------------------- OAuth
async function body(req: Req): Promise<Record<string, any>> {
  const raw = (await readBody(req, 64 * 1024)).toString('utf8');
  if (String(req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON không hợp lệ'); } }
  return Object.fromEntries(new URLSearchParams(raw));
}
const oauthError = (res: Res, status: number, error: string, description: string) => json(res, status, { error, error_description: description });

async function issueTokens(clientId: string, userId: string) {
  const access = secret(), refresh = secret(), at = now();
  await run('INSERT INTO mcp_tokens(id,kind,client_id,user_id,expires_at,created_at) VALUES(?,?,?,?,?,?)', hash(access), 'access', clientId, userId, at + ACCESS_TTL, at);
  await run('INSERT INTO mcp_tokens(id,kind,client_id,user_id,expires_at,created_at) VALUES(?,?,?,?,?,?)', hash(refresh), 'refresh', clientId, userId, at + REFRESH_TTL, at);
  await run('DELETE FROM mcp_tokens WHERE expires_at < ?', at);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: 'dmi' };
}

/** The client a token request names, when its secret (if it was given one) matches. */
async function clientOf(req: Req, b: Record<string, any>) {
  let id = String(b.client_id || ''), pass = b.client_secret === undefined ? null : String(b.client_secret);
  const basic = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (basic) { const [u, p] = Buffer.from(basic[1], 'base64').toString().split(':'); id = decodeURIComponent(u || ''); pass = decodeURIComponent(p || ''); }
  const c = id ? await get<any>('SELECT * FROM mcp_clients WHERE id=?', id) : null;
  if (!c || c.secret_hash && !(pass && same(hash(pass), c.secret_hash))) return null;
  return c;
}

// The consent page: who asks, what they get, and two buttons. The form carries a token tied to this sign-in.
function consentPage(res: Res, o: { client: any; user: User; params: URLSearchParams; csrf: string }) {
  const host = new URL(o.params.get('redirect_uri')!).host;
  const fields = [...o.params].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'" });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Claude · DMI Workspace</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#18181b}
main{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid rgba(15,23,42,.09);border-radius:16px;padding:28px;box-shadow:0 4px 14px rgba(15,23,42,.05)}
img{height:28px}h1{font-size:20px;margin:18px 0 6px}p{margin:0 0 12px;color:#52525b}ul{margin:0 0 18px;padding-left:20px;color:#52525b}
.who{padding:10px 12px;border-radius:10px;background:#f4f5f7;font-size:14px;margin-bottom:16px}.row{display:flex;gap:10px;justify-content:flex-end}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:9px 18px;cursor:pointer}.ok{background:#0b7df2;color:#fff}.no{background:#eef0f3;color:#18181b}
@media(prefers-color-scheme:dark){body{background:#0f0f11;color:#f4f4f5}main{background:#18181b;border-color:rgba(255,255,255,.09)}p,ul{color:#c3c2b7}.who{background:#232326}.no{background:#2a2a2e;color:#f4f4f5}}</style></head>
<body><main><img src="/brand/logo.png" alt="Detailers Movement"><h1>Cho phép ${esc(o.client.name || 'Claude')} truy cập DMI Workspace?</h1>
<div class="who">Tài khoản: <b>${esc(o.user.name)}</b> (${esc(o.user.email)})<br>Trả về: ${esc(host)}</div>
<p>Ứng dụng này sẽ làm việc thay bạn, với đúng quyền của tài khoản bạn:</p>
<ul><li>Xem và tìm công việc, dịch vụ, khách hàng bạn được xem</li><li>Tạo, sửa, bình luận và chuyển bước công việc bạn được sửa</li></ul>
<form method="post" action="/api/oauth/authorize">${fields}<input type="hidden" name="csrf" value="${esc(o.csrf)}">
<div class="row"><button class="no" name="decision" value="deny">Từ chối</button><button class="ok" name="decision" value="allow">Cho phép</button></div></form>
<p style="margin:16px 0 0;font-size:12.5px">Chỉ cho phép nếu bạn vừa bấm kết nối DMI từ Claude.</p></main></body></html>`);
}

/** What the authorize request asks, checked: an error to show (not to send back) when the client or address is wrong. */
async function authorizeRequest(p: URLSearchParams) {
  const client = await get<any>('SELECT * FROM mcp_clients WHERE id=?', String(p.get('client_id') || ''));
  if (!client) throw new HttpError(400, 'Ứng dụng chưa đăng ký với DMI Workspace');
  const redirect = String(p.get('redirect_uri') || '');
  if (!(JSON.parse(client.redirect_uris) as string[]).includes(redirect)) throw new HttpError(400, 'Địa chỉ trả về không khớp với ứng dụng');
  return { client, redirect };
}
const back = (redirect: string, q: Record<string, string | null>) => {
  const u = new URL(redirect);
  for (const [k, v] of Object.entries(q)) if (v) u.searchParams.set(k, v);
  return u.toString();
};
const csrfOf = (req: http.IncomingMessage, clientId: string) => hash(`${(req.headers.cookie || '').match(/(?:^|;\s*)dms_sid=([^;]+)/)?.[1] || ''}:${clientId}:mcp`);

export function registerMcp(api: Router) {
  const resource = (req: Req, res: Res) => json(res, 200, { resource: mcpUrl(req), authorization_servers: [publicOrigin(req)], bearer_methods_supported: ['header'], resource_name: 'DMI Workspace' });
  api.get('/.well-known/oauth-protected-resource', resource);
  api.get('/.well-known/oauth-protected-resource/api/mcp', resource);
  // Asked for at the root, after the MCP path (RFC 8414) or as OpenID discovery: some clients only try one of them.
  const server = (req: Req, res: Res) => {
    const o = publicOrigin(req);
    json(res, 200, {
      issuer: o, authorization_endpoint: o + '/api/oauth/authorize', token_endpoint: o + '/api/oauth/token', registration_endpoint: o + '/api/oauth/register',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], scopes_supported: ['dmi'],
    });
  };
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) { api.get(p, server); api.get(p + '/api/mcp', server); }

  // Dynamic client registration (RFC 7591): Claude registers itself the first time it connects.
  api.post('/api/oauth/register', async (req, res) => {
    const b = await body(req);
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(redirectOk)) return oauthError(res, 400, 'invalid_redirect_uri', 'redirect_uris phải là https hoặc localhost');
    const method = ['client_secret_post', 'client_secret_basic'].includes(b.token_endpoint_auth_method) ? b.token_endpoint_auth_method : 'none';
    const id = 'mc_' + crypto.randomBytes(12).toString('hex'), pass = method === 'none' ? null : secret(), at = now();
    const name = String(b.client_name || 'Claude').slice(0, 80);
    await run('INSERT INTO mcp_clients(id,name,redirect_uris,secret_hash,created_at) VALUES(?,?,?,?,?)', id, name, JSON.stringify(uris), pass ? hash(pass) : null, at);
    json(res, 201, { client_id: id, ...(pass ? { client_secret: pass, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(at / 1000), client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method });
  });

  api.get('/api/oauth/authorize', async (req, res) => {
    const p = req.query, { client, redirect } = await authorizeRequest(p);
    if (p.get('response_type') !== 'code') return (res.writeHead(302, { location: back(redirect, { error: 'unsupported_response_type', state: p.get('state') }) }), res.end());
    if (p.get('code_challenge_method') !== 'S256' || !/^[\w-]{43,128}$/.test(p.get('code_challenge') || '')) return (res.writeHead(302, { location: back(redirect, { error: 'invalid_request', error_description: 'PKCE S256 là bắt buộc', state: p.get('state') }) }), res.end());
    const user = await currentUser(req);
    // Not signed in: the app's sign-in page, which comes back here after (see web/src/App.tsx).
    if (!user) return (res.writeHead(302, { location: '/#oauth?' + p.toString(), 'cache-control': 'no-store' }), res.end());
    consentPage(res, { client, user, params: p, csrf: csrfOf(req, client.id) });
  });
  api.post('/api/oauth/authorize', async (req, res) => {
    const b = new URLSearchParams(Object.entries(await body(req)).map(([k, v]) => [k, String(v)]));
    const { client, redirect } = await authorizeRequest(b), user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Hãy đăng nhập DMI Workspace rồi thử lại');
    if (!same(String(b.get('csrf') || ''), csrfOf(req, client.id))) throw new HttpError(403, 'Phiên xác nhận không hợp lệ, hãy thử kết nối lại');
    const state = b.get('state');
    if (b.get('decision') !== 'allow') return (res.writeHead(302, { location: back(redirect, { error: 'access_denied', state }) }), res.end());
    const code = secret();
    await run('INSERT INTO mcp_codes(id,client_id,user_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?,?)', hash(code), client.id, user.id, redirect, String(b.get('code_challenge') || ''), now() + CODE_TTL);
    res.writeHead(302, { location: back(redirect, { code, state, iss: publicOrigin(req) }) });
    res.end();
  });

  api.post('/api/oauth/token', async (req, res) => {
    const b = await body(req), client = await clientOf(req, b);
    if (!client) return oauthError(res, 401, 'invalid_client', 'Ứng dụng không hợp lệ');
    if (b.grant_type === 'authorization_code') {
      const id = hash(String(b.code || '')), c = await get<any>('SELECT * FROM mcp_codes WHERE id=?', id);
      // A code works once: whoever takes it first deletes it.
      if (!c || !(await run('DELETE FROM mcp_codes WHERE id=?', id)).changes || c.expires_at < now() || c.client_id !== client.id || c.redirect_uri !== String(b.redirect_uri || '')) return oauthError(res, 400, 'invalid_grant', 'Mã không hợp lệ hoặc đã hết hạn');
      const verifier = String(b.code_verifier || '');
      if (!/^[\w.~-]{43,128}$/.test(verifier) || !same(crypto.createHash('sha256').update(verifier).digest('base64url'), c.challenge)) return oauthError(res, 400, 'invalid_grant', 'PKCE không khớp');
      return json(res, 200, await issueTokens(client.id, c.user_id));
    }
    if (b.grant_type === 'refresh_token') {
      const id = hash(String(b.refresh_token || '')), t = await get<any>("SELECT * FROM mcp_tokens WHERE id=? AND kind='refresh'", id);
      if (!t || !(await run('DELETE FROM mcp_tokens WHERE id=?', id)).changes || t.expires_at < now() || t.client_id !== client.id) return oauthError(res, 400, 'invalid_grant', 'Hãy kết nối lại');
      if (!await get('SELECT 1 FROM users WHERE id=? AND disabled=0', t.user_id)) return oauthError(res, 400, 'invalid_grant', 'Tài khoản đã bị khoá');
      return json(res, 200, await issueTokens(client.id, t.user_id));
    }
    oauthError(res, 400, 'unsupported_grant_type', 'Chỉ hỗ trợ authorization_code và refresh_token');
  });

  // The Claude apps a person has connected (Hồ sơ › Kết nối Claude), and taking one back: its tokens go at once.
  api.get('/api/mcp/connections', async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Hãy đăng nhập');
    json(res, 200, await all<any>(`SELECT c.id, c.name, MIN(t.created_at) since, MAX(t.created_at) lastSeen FROM mcp_tokens t JOIN mcp_clients c ON c.id = t.client_id
      WHERE t.user_id = ? AND t.expires_at > ? GROUP BY c.id, c.name ORDER BY lastSeen DESC`, user.id, now()));
  });
  api.delete('/api/mcp/connections/:clientId', async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Hãy đăng nhập');
    await run('DELETE FROM mcp_tokens WHERE user_id = ? AND client_id = ?', user.id, req.params.clientId);
    await run('DELETE FROM mcp_codes WHERE user_id = ? AND client_id = ?', user.id, req.params.clientId);
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- MCP
  api.post('/api/mcp', async (req, res) => {
    const token = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1] || '';
    const row = token ? await get<any>("SELECT user_id FROM mcp_tokens WHERE id=? AND kind='access' AND expires_at>?", hash(token), now()) : null;
    const user = row ? await get<User>(`${USER_SQL} WHERE u.id = ? AND u.disabled = 0`, row.user_id) : null;
    if (!user) {
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp"` });
      return res.end(JSON.stringify({ error: 'invalid_token', error_description: 'Hãy kết nối lại với DMI Workspace' }));
    }
    let msg: any;
    try { msg = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8')); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const answers = (await Promise.all((Array.isArray(msg) ? msg : [msg]).map((m) => answer(req, user, m)))).filter(Boolean);
    if (!answers.length) { res.writeHead(202); return res.end(); }
    json(res, 200, Array.isArray(msg) ? answers : answers[0]);
  });
  const noStream = (_req: Req, res: Res) => { res.writeHead(405, { allow: 'POST' }); res.end(); };
  // Opened in a browser, the address says what it is for; Claude asking for a stream gets 405 (none is offered).
  api.get('/api/mcp', (req, res) => {
    if (!String(req.headers.accept || '').includes('text/html')) return noStream(req, res);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connector Claude · DMI Workspace</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#18181b}main{width:min(480px,calc(100% - 32px));background:#fff;border:1px solid rgba(15,23,42,.09);border-radius:16px;padding:28px}code{display:block;margin:8px 0 14px;padding:10px 12px;border-radius:10px;background:#f4f5f7;font-size:13px;overflow-wrap:anywhere}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 10px;color:#52525b}@media(prefers-color-scheme:dark){body{background:#0f0f11;color:#f4f4f5}main{background:#18181b;border-color:rgba(255,255,255,.09)}p{color:#c3c2b7}code{background:#232326}}</style></head>
<body><main><h1>Đây là địa chỉ connector cho Claude</h1><p>Không mở trong trình duyệt. Hãy dán địa chỉ này vào Claude:</p><code>${esc(mcpUrl(req))}</code>
<p><b>claude.ai / app Claude:</b> Settings → Connectors → Add custom connector, dán địa chỉ trên rồi bấm Connect, đăng nhập DMI và bấm Cho phép.</p>
<p><b>Claude Code:</b> claude mcp add --transport http dmi ${esc(mcpUrl(req))}</p></main></body></html>`);
  });
  api.delete('/api/mcp', noStream);
}

async function answer(req: Req, user: User, m: any) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return { jsonrpc: '2.0', id: m?.id ?? null, error: { code: -32600, message: 'Invalid request' } };
  if (m.id === undefined || m.id === null) return null; // a notification: nothing to answer
  const ok = (result: any) => ({ jsonrpc: '2.0', id: m.id, result });
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion || '');
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'dmi-workspace', title: 'DMI Workspace', version: '1.0.0' },
        instructions: 'DMI Workspace của Detailers Movement: khách hàng → dịch vụ → công việc, mỗi công việc đi qua ACCOUNT › EXECUTION › REVIEW › COMPLETED. Mọi thao tác chạy bằng tài khoản và quyền của người đã kết nối. Thời gian theo giờ Việt Nam (UTC+7). Trả lời người dùng bằng tiếng Việt.',
      });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS.map(({ run: _r, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: `Không có công cụ ${m.params?.name}` } };
      try {
        const out = await tool.run(callAs(req, user), m.params?.arguments || {});
        // A tool that shows pictures answers MCP content itself (text and images).
        if (out && Array.isArray(out.content)) return ok({ content: out.content });
        return ok({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1) }] });
      } catch (e: any) {
        return ok({ content: [{ type: 'text', text: e instanceof HttpError ? e.message : 'Không xử lý được yêu cầu, hãy thử lại.' }], isError: true });
      }
    }
    default: return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } };
  }
}

// ---------------------------------------------------------------- tools: API requests made as the connected person
// The API's own entry (server/app.ts hands it over: importing it here would make a cycle, which the Worker bundle can't start).
let handleApi: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>;
export const useApiEntry = (h: typeof handleApi) => { handleApi = h; };
export function callAs(outer: Req, user: User): Call {
  return async (method, path, data) => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]) as any;
    Object.assign(req, {
      method, url: path, [ACTING]: user, socket: outer.socket,
      headers: { host: outer.headers.host, 'x-forwarded-proto': outer.headers['x-forwarded-proto'], 'cf-connecting-ip': outer.headers['cf-connecting-ip'], 'user-agent': 'Claude (MCP)', 'content-type': 'application/json' },
    });
    let status = 200, text = '';
    const res: any = {
      headersSent: false, statusCode: 200, _h: {} as Record<string, any>,
      setHeader(k: string, v: any) { this._h[k.toLowerCase()] = v; }, getHeader(k: string) { return this._h[k.toLowerCase()]; }, removeHeader(k: string) { delete this._h[k.toLowerCase()]; },
      writeHead(s: number) { status = s; this.statusCode = s; this.headersSent = true; return this; },
      write(c: any) { text += typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); return true; },
      end(c?: any) { if (c !== undefined && typeof c !== 'function') this.write(c); this.headersSent = true; return this; },
      on() { return this; }, once() { return this; },
    };
    await handleApi(req, res);
    status = res.statusCode || status;
    let out: any = text;
    try { out = JSON.parse(text); } catch { /* not JSON */ }
    if (status >= 400) throw new HttpError(status, out?.error || `Lỗi ${status}`);
    return out;
  };
}

export const WORK_TOOLS: Tool[] = [
  {
    name: 'whoami', title: 'Tài khoản đang kết nối', description: 'Tên, email, vai trò của tài khoản DMI đang kết nối.', annotations: read,
    inputSchema: { type: 'object', properties: {} },
    run: async (call) => { const r = await call('GET', '/api/auth/me'); return { name: r.user?.name, email: r.user?.email, role: r.user?.role, id: r.user?.id }; },
  },
  {
    name: 'search', title: 'Tìm kiếm', description: 'Tìm khắp DMI Workspace (khách hàng, công việc, dịch vụ, board, thẻ…) theo từ khoá, không cần dấu.', annotations: read,
    inputSchema: { type: 'object', properties: { query: str('Từ khoá'), type: str('Chỉ một loại (tuỳ chọn), như customers, tasks, projects, boards, cards') }, required: ['query'] },
    run: (call, a) => call('GET', `/api/search?q=${encodeURIComponent(need(a.query, 'từ khoá'))}${a.type ? `&type=${encodeURIComponent(a.type)}` : ''}`),
  },
  {
    name: 'list_tasks', title: 'Danh sách công việc', annotations: read,
    description: 'Công việc của tôi (mặc định), của team, hoặc mọi công việc của một dịch vụ. Lọc theo trạng thái và từ khoá. Thời gian theo giờ Việt Nam.',
    inputSchema: {
      type: 'object', properties: {
        scope: { type: 'string', enum: ['mine', 'team', 'all'], description: 'mine: của tôi; team: của team tôi lãnh đạo; all: mọi công việc của service_id' },
        relation: { type: 'string', enum: ['assigned', 'created', 'following'], description: 'Với scope mine: được giao, tôi tạo, hay tôi theo dõi (bỏ trống: cả ba)' },
        state: str('open (chưa xong), done, overdue, todo, doing, cancelled'), query: str('Từ khoá'), service_id: str('Id dịch vụ (từ list_services)'),
        limit: { type: 'number', description: 'Tối đa (mặc định 50, tối đa 200)' },
      },
    },
    run: async (call, a) => {
      const q = new URLSearchParams({ scope: a.scope || 'mine' });
      if (a.relation) q.set('rel', a.relation); if (a.state) q.set('state', a.state); if (a.query) q.set('q', a.query); if (a.service_id) q.set('project', a.service_id);
      const r = await call('GET', `/api/tasks?${q}`), limit = Math.min(Math.max(Number(a.limit) || 50, 1), 200);
      return { total: r.tasks.length, shown: Math.min(limit, r.tasks.length), tasks: r.tasks.slice(0, limit).map(brief) };
    },
  },
  {
    name: 'get_task', title: 'Chi tiết công việc', annotations: read,
    description: 'Một công việc: mô tả, kết quả, việc con, bình luận, lịch sử, bước quy trình và người duyệt.',
    inputSchema: { type: 'object', properties: { task_id: str('Id công việc (tk_…)') }, required: ['task_id'] },
    run: async (call, a) => {
      const t = await call('GET', `/api/tasks/${seg(a.task_id, 'task_id')}`);
      return {
        ...brief(t), description: t.description, result: t.result, canEdit: t.canEdit, statuses: t.statuses, path: (t.path || []).map((p: any) => p.title),
        subtasks: (t.childTasks || []).map(brief), flow: t.flow,
        comments: (t.comments || []).slice(-30).map((c: any) => ({ by: c.userName, at: vn(c.createdAt), text: c.text })),
        activity: (t.activity || []).slice(0, 20).map((x: any) => `${vn(x.at)} ${x.user} ${x.text}`),
      };
    },
  },
  {
    name: 'create_task', title: 'Tạo công việc', annotations: write,
    description: 'Tạo công việc mới. Giao cho người khác bằng assignee_user_id (từ list_users; không tự giao cho mình); để trống thì công việc chờ ở ACCOUNT để giao.',
    inputSchema: {
      type: 'object', properties: {
        title: str('Tên công việc'), service_id: str('Id dịch vụ (từ list_services)'), description: str('Mô tả'),
        due: str('Hạn chót: YYYY-MM-DD (cuối ngày) hoặc ISO 8601'), start: str('Ngày bắt đầu'), assignee_user_id: str('Id tài khoản được giao'),
        reviewer_user_id: str('Id tài khoản người duyệt (tuỳ chọn)'), parent_task_id: str('Id công việc cha, để tạo việc con'),
      }, required: ['title'],
    },
    run: async (call, a) => {
      const r = await call('POST', '/api/tasks', {
        title: need(a.title, 'tên công việc'), projectId: a.service_id || null, description: a.description, dueAt: when(a.due, 'due'), startAt: when(a.start, 'start'),
        parentId: a.parent_task_id || null, reviewerUserId: a.reviewer_user_id || undefined, ...(a.assignee_user_id ? { assigneeUserIds: [String(a.assignee_user_id)] } : {}),
      });
      return { id: r.id, created: true };
    },
  },
  {
    name: 'update_task', title: 'Sửa công việc', annotations: write,
    description: 'Sửa tên, mô tả, kết quả, hạn, ngày bắt đầu, dịch vụ hoặc người được giao của một công việc. Chỉ gửi trường cần đổi. Chuyển bước quy trình thì dùng task_workflow.',
    inputSchema: {
      type: 'object', properties: {
        task_id: str('Id công việc'), title: str('Tên mới'), description: str('Mô tả mới'), result: str('Kết quả công việc (link, ghi chú bàn giao…)'),
        due: str('Hạn chót mới; "" để gỡ'), start: str('Ngày bắt đầu mới; "" để gỡ'), service_id: str('Id dịch vụ mới'), assignee_user_id: str('Id tài khoản được giao (thay người cũ)'),
      }, required: ['task_id'],
    },
    run: async (call, a) => {
      const b: any = {};
      for (const [k, f] of [['title', 'title'], ['description', 'description'], ['result', 'result'], ['service_id', 'projectId']] as const) if (a[k] !== undefined) b[f] = a[k];
      if (a.due !== undefined) b.dueAt = when(a.due, 'due');
      if (a.start !== undefined) b.startAt = when(a.start, 'start');
      if (a.assignee_user_id !== undefined) b.assigneeUserIds = a.assignee_user_id ? [String(a.assignee_user_id)] : [];
      if (!Object.keys(b).length) throw new HttpError(400, 'Không có gì để sửa');
      await call('PUT', `/api/tasks/${seg(a.task_id, 'task_id')}`, b);
      return { updated: true };
    },
  },
  {
    name: 'comment_task', title: 'Bình luận công việc', annotations: write,
    description: 'Viết bình luận vào một công việc (hiện cả trên thẻ board nếu có).',
    inputSchema: { type: 'object', properties: { task_id: str('Id công việc'), text: str('Nội dung bình luận') }, required: ['task_id', 'text'] },
    run: async (call, a) => { const r = await call('POST', `/api/tasks/${seg(a.task_id, 'task_id')}/comments`, { text: need(a.text, 'nội dung') }); return { id: r.id, posted: true }; },
  },
  {
    name: 'task_workflow', title: 'Chuyển bước quy trình', annotations: write,
    description: 'Đưa công việc qua quy trình ACCOUNT › EXECUTION › REVIEW › COMPLETED: start (giao việc, sang EXECUTION), submit (nộp duyệt), pass / redo / fail (người duyệt chấm, redo và fail cần feedback), reopen (mở lại, cần reason), back (lùi một bước).',
    inputSchema: {
      type: 'object', properties: {
        task_id: str('Id công việc'), action: { type: 'string', enum: ['start', 'submit', 'pass', 'redo', 'fail', 'reopen', 'back'] },
        note: str('Ghi chú khi giao hoặc nộp'), feedback: str('Nhận xét khi redo/fail'), reason: str('Lý do khi mở lại'),
      }, required: ['task_id', 'action'],
    },
    run: async (call, a) => { await call('POST', `/api/tasks/${seg(a.task_id, 'task_id')}/flow`, { action: a.action, note: a.note, feedback: a.feedback, reason: a.reason }); return { done: a.action }; },
  },
  {
    name: 'list_services', title: 'Danh sách dịch vụ', annotations: read,
    description: 'Các dịch vụ (của khách hàng) bạn được xem, với số công việc, số đã xong và quá hạn. Lọc theo tên dịch vụ hoặc khách hàng.',
    inputSchema: { type: 'object', properties: { query: str('Tên dịch vụ hoặc khách hàng') } },
    run: async (call, a) => {
      const m = await call('GET', '/api/tasks/meta'), q = String(a.query || '').toLowerCase();
      return m.projects.filter((p: any) => !q || `${p.name} ${p.customerName || ''}`.toLowerCase().includes(q))
        .map((p: any) => ({ id: p.id, name: p.name, customer: p.customerName, customerId: p.customerId, stage: p.stage, tasks: p.tasks, completed: p.completed, overdue: p.overdue }));
    },
  },
  {
    name: 'list_users', title: 'Danh sách nhân sự', annotations: read,
    description: 'Tài khoản đang hoạt động (id, tên, email) để giao việc hoặc chọn người duyệt.',
    inputSchema: { type: 'object', properties: { query: str('Tên hoặc email') } },
    run: async (call, a) => { const m = await call('GET', '/api/tasks/meta'), q = String(a.query || '').toLowerCase(); return m.users.filter((u: any) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q)).map((u: any) => ({ id: u.id, name: u.name, email: u.email })); },
  },
  {
    name: 'list_customers', title: 'Danh sách khách hàng', annotations: read,
    description: 'Khách hàng bạn được xem: trạng thái, phân loại, người phụ trách, số dịch vụ và công việc. Lọc theo tên.',
    inputSchema: { type: 'object', properties: { query: str('Tên khách hàng') } },
    run: async (call, a) => {
      const rows = await call('GET', '/api/customers/directory'), q = String(a.query || '').toLowerCase();
      return rows.filter((c: any) => !q || String(c.name).toLowerCase().includes(q)).map((c: any) => ({
        id: c.id, name: c.name, status: c.status, category: c.category?.name || null, source: c.source?.name || null, manager: c.manager?.name || null, owner: c.owner?.name || null,
        contact: c.contact || null, phone: c.phone || null, email: c.email || null, services: c.projects, tasks: c.tasks, completed: c.completed,
      }));
    },
  },
  {
    name: 'get_customer', title: 'Chi tiết khách hàng', annotations: read,
    description: 'Hồ sơ một khách hàng (liên hệ, ghi chú, phân loại) và các công việc của khách.',
    inputSchema: { type: 'object', properties: { customer_id: str('Id khách hàng (c_… hoặc cust_…)') }, required: ['customer_id'] },
    run: async (call, a) => {
      const id = seg(a.customer_id, 'customer_id');
      const [record, tasks] = await Promise.all([call('GET', `/api/customers/${id}/record`), call('GET', `/api/customers/${id}/tasks`)]);
      return { ...record, tasks: (tasks || []).map(brief) };
    },
  },
];
// The video editor's tools need the Mac's disk, ffmpeg and HyperFrames: not on the cloud Worker.
const TOOLS = CLOUD_STORAGE_ONLY ? WORK_TOOLS : [...WORK_TOOLS, ...VIDEO_TOOLS];
