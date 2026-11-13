/// <reference types="@cloudflare/workers-types" />
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import {drainNotifications} from './notifications';
import {remindTasks,settleStages} from './task-flow';
import {normalizeAllBoards} from './board-flow';
import {projectsAsServices} from './project-services';
import { handleApi } from './app';
import { initDatabase, repairData, type D1Binding } from './db';

createServer(handleApi).listen(8787);
const nodeHandler = httpServerHandler({ port: 8787 });
type WorkerRequest = Parameters<NonNullable<typeof nodeHandler.fetch>>[0];

export default {
  async scheduled(event:ScheduledEvent,env:{DB?:D1Binding},ctx:ExecutionContext){
    // Every tenth minute the data repairs run as well (they read whole tables), tasks not yet in the review workflow join
    // it, and the reminders for overdue work and waiting reviews go out.
    ctx.waitUntil((async()=>{await initDatabase(env.DB);if(new Date(event.scheduledTime).getUTCMinutes()%10===0){await repairData();await settleStages();await projectsAsServices();await normalizeAllBoards();await remindTasks();}await drainNotifications();})());
  },
  async fetch(request: WorkerRequest, env: { ASSETS: Fetcher; DB?: D1Binding }, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === 'dmi-studio.detailersmovement.workers.dev' && !url.pathname.startsWith('/api/google/callback')) {
      url.hostname = 'dmi-workspace.detailersmovement.workers.dev';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/assets/')) return Response.json({ error: 'Video được lưu trên Google Drive.' }, { status: 404 });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Origin không hợp lệ' }, { status: 403 });
    }
    try { await initDatabase(env.DB); }
    catch {
      console.error('Không kết nối được Cloudflare D1; kiểm tra binding DB.');
      return Response.json({ error: 'Chưa kết nối được database cloud.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    // Set trusted proxy headers from the Worker URL, never from client-supplied headers.
    const headers = new Headers(request.headers);
    headers.set('host', url.host);
    headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
    const res = await nodeHandler.fetch!(new Request(request, { headers }) as WorkerRequest, env, ctx);
    // Mail a change has queued goes out right after it, in the background; the minute's run retries what failed.
    if (request.method !== 'GET') ctx.waitUntil(drainNotifications().then(() => {}, () => console.error('Chưa xử lý được hàng đợi email')));
    return res;
  },
};
