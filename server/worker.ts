/// <reference types="@cloudflare/workers-types" />
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import { handleApi } from './app';
import { initDatabase } from './db';

createServer(handleApi).listen(8787);
const nodeHandler = httpServerHandler({ port: 8787 });
type WorkerRequest = Parameters<NonNullable<typeof nodeHandler.fetch>>[0];

export default {
  async fetch(request: WorkerRequest, env: { ASSETS: Fetcher }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/assets/')) return Response.json({ error: 'Video được lưu trên Google Drive.' }, { status: 404 });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Origin không hợp lệ' }, { status: 403 });
    }
    try { await initDatabase(); }
    catch {
      console.error('Không kết nối được Turso; kiểm tra hai secrets TURSO_DATABASE_URL và TURSO_AUTH_TOKEN.');
      return Response.json({ error: 'Chưa kết nối được database cloud.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    // Set trusted proxy headers from the Worker URL, never from client-supplied headers.
    const headers = new Headers(request.headers);
    headers.set('host', url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    return nodeHandler.fetch!(new Request(request, { headers }) as WorkerRequest, env, ctx);
  },
};
