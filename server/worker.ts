/// <reference types="@cloudflare/workers-types" />
import { createServer } from 'node:http';
import { httpServerHandler } from 'cloudflare:node';
import {drainNotifications} from './notifications';
import {automationTick} from './automation';
import {remindTasks,settleStages} from './task-flow';
import {normalizeAllBoards} from './board-flow';
import {projectsAsServices} from './project-services';
import { handleApi } from './app';
import { initDatabase, repairData, type D1Binding } from './db';
import { migrateServiceBoards } from './service-boards';
import { useChatBucket } from './chat-files';
import { limited, type Limiters } from './edge-limits';
export { BoardgameRoom } from './boardgame-live';

/** Once per instance after the database is up: the boards from before become their customers' service boards (it does
 *  nothing once done; server/service-boards.ts). */
let migrated: Promise<void> | undefined;
// The database must be up to serve (a failure here is the only 503). The one-time service-board migration is already
// done in production and is idempotent, so a transient failure of it is logged and retried next cold start rather than
// taking the whole site down with it.
const ready = (binding?: D1Binding) => initDatabase(binding).then(() => migrated ||= migrateServiceBoards().catch((e) => { migrated = undefined; console.error('Chưa chạy xong migrate service boards; vẫn phục vụ.', e); }));

createServer(handleApi).listen(8787);
const TOKEN_AUTH = /^\/api\/(mcp|oauth\/(token|register))$/;
const nodeHandler = httpServerHandler({ port: 8787 });
type WorkerRequest = Parameters<NonNullable<typeof nodeHandler.fetch>>[0];

export default {
  async scheduled(event:ScheduledEvent,env:{DB?:D1Binding},ctx:ExecutionContext){
    // Every tenth minute the data repairs run as well (they read whole tables), tasks not yet in the review workflow join
    // it, and the reminders for overdue work and waiting reviews go out.
    ctx.waitUntil((async()=>{await ready(env.DB);if(new Date(event.scheduledTime).getUTCMinutes()%10===0){await repairData();await settleStages();await projectsAsServices();await normalizeAllBoards();await remindTasks();}await drainNotifications();await automationTick().catch(()=>console.error('Chưa chạy được tự động hoá'));})());
  },
  async fetch(request: WorkerRequest, env: { ASSETS: Fetcher; DB?: D1Binding; CHAT_FILES?: R2Bucket; BG_ROOMS?: DurableObjectNamespace } & Limiters, ctx: ExecutionContext): Promise<Response> {
    useChatBucket(env.CHAT_FILES); // files of Tin nhắn (server/chat-files.ts)
    const url = new URL(request.url);
    if (url.hostname === 'dmi-studio.detailersmovement.workers.dev' && !url.pathname.startsWith('/api/google/callback')) {
      url.hostname = 'dmi-workspace.detailersmovement.workers.dev';
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith('/assets/')) return Response.json({ error: 'Video được lưu trên Google Drive.' }, { status: 404 });
    if (!url.pathname.startsWith('/api/') && !/^\/\.well-known\/(oauth-|openid-configuration)/.test(url.pathname)) return env.ASSETS.fetch(request);
    // The Claude connector's own endpoints answer apps, not this site's pages, and need no cookie (server/mcp.ts).
    if (!['GET', 'HEAD'].includes(request.method) && !TOKEN_AUTH.test(url.pathname)) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Origin không hợp lệ' }, { status: 403 });
    }
    const refused = await limited(env, request.method, url.pathname, request.headers.get('cf-connecting-ip') || '', request.headers.get('cookie') || '', request.headers.get('x-bg-player') || '').catch(() => null);
    if (refused) return Response.json({ error: refused }, { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } });
    // Ma Sói in 3D: each room's live positions go to its own Durable Object over a WebSocket (server/boardgame-live.ts).
    const live = url.pathname.match(/^\/api\/boardgame\/rooms\/(\d{4})\/live$/);
    if (live && env.BG_ROOMS) {
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return Response.json({ error: 'Origin không hợp lệ' }, { status: 403 });
      return env.BG_ROOMS.get(env.BG_ROOMS.idFromName(live[1])).fetch(request as unknown as Request);
    }
    try { await ready(env.DB); }
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
