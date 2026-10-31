import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, json, type Req } from './http';
import { api, ProviderError } from './routes';
import { guard } from './auth';

export async function handleApi(req0: IncomingMessage, res: ServerResponse) {
  const req = req0 as Req;
  try {
    const url = new URL(req.url || '/', 'http://local');
    req.path = url.pathname;
    req.query = url.searchParams;
    await guard(req);
    const route = api.match(req.method || 'GET', req.path);
    if (!route) throw new HttpError(404, 'Không có API này');
    req.params = route.params;
    await route.h(req, res);
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : e instanceof ProviderError ? (e.status >= 400 && e.status < 600 ? e.status : 502) : 500;
    if (status >= 500) console.error('API error:', req.method, req.path);
    if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Không xử lý được yêu cầu, hãy thử lại.' : e.message });
    else res.end();
  }
}
