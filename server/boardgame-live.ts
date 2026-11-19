/// <reference types="@cloudflare/workers-types" />
// Ma Sói in 3D (web/public/boardgame/village.js): where everyone stands in the village, live. One Durable Object per
// room code relays each phone's position and facing to the others over a WebSocket, about ten times a second. Nothing
// is stored: the game itself lives in D1 (server/boardgame.ts), and a phone that joins late is sent where everyone is.
// Connections hibernate between messages, so an idle room costs nothing.
import { DurableObject } from 'cloudflare:workers';

const PLAYER = /^[\w-]{8,64}$/;
/** Where a player is: x, z on the ground, r the way they face, t when it was last sent (0: not yet). */
type Spot = { id: string; x: number; z: number; r: number; t: number };
const clamp = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0);

export class BoardgameRoom extends DurableObject {
  async fetch(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket only', { status: 426 });
    const id = new URL(request.url).searchParams.get('pid') || '';
    if (!PLAYER.test(id)) return new Response('Thiếu mã người chơi', { status: 400 });
    // The same player opening the room again (a second tab, a reload) replaces the old connection.
    for (const old of this.ctx.getWebSockets(id)) old.close(4000, 'replaced');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id, x: 0, z: 0, r: 0, t: 0 } satisfies Spot);
    const spots = this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Spot).filter((s) => s && s.id !== id && s.t);
    server.send(JSON.stringify({ type: 'all', spots }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 200) return;
    let m: any;
    try { m = JSON.parse(message); } catch { return; }
    if (m?.type !== 'pos') return;
    const me = ws.deserializeAttachment() as Spot;
    const now = Date.now();
    if (now - me.t < 40) return; // at most about 25 a second from one phone
    const spot: Spot = { id: me.id, x: clamp(m.x, 100), z: clamp(m.z, 100), r: clamp(m.r, 10), t: now };
    ws.serializeAttachment(spot);
    this.send({ type: 'pos', ...spot }, ws);
  }

  async webSocketClose(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Spot | null;
    if (me) this.send({ type: 'leave', id: me.id }, ws);
  }

  /** To everyone in the room but `except`. */
  private send(message: object, except: WebSocket) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== except) try { ws.send(text); } catch { /* closing */ }
    }
  }
}
