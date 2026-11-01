// Edit proxies on the client: asks the server for a light copy of every Drive clip part an assembly uses
// (timeline order, the ones near the playhead first), tracks which are ready, and tells the player what to play.
import type { Storyboard, Shot, MediaRef } from '../types';

const BLOCK = 5; // seconds; must match the server's proxy blocks
type Listener = () => void;

/** The proxy covering a shot: whole 5 s blocks of its clip around [from, from + dur]. */
export function proxyOf(sh: Shot) {
  const m = sh.media;
  if (m.provider !== 'drive' || m.type !== 'video') return null;
  const from = sh.from || 0;
  const s = Math.floor(from / BLOCK) * BLOCK;
  let e = Math.ceil((from + sh.dur) / BLOCK) * BLOCK;
  if (m.duration) e = Math.min(e, Math.ceil(m.duration));
  if (e <= s) e = s + 1;
  const q = new URLSearchParams(m.url.split('?')[1] || '');
  return { key: `${m.assetId}_${s}_${e}`, s, e, item: { id: m.assetId, a: q.get('a'), sig: q.get('sig'), s, e } };
}

class Proxies {
  private state = new Map<string, 'ready' | 'pending' | 'failed'>();
  private keys: string[] = [];
  private items = new Map<string, any>(); // key → what to send to queue it again
  private listeners = new Set<Listener>();
  private timer: any = 0;
  private lastBump = 0;
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  /** What to play for a shot: its proxy (and where the shot starts inside it) once ready, else null. */
  playable(sh: Shot): { media: MediaRef; offset: number } | null {
    const p = proxyOf(sh);
    if (!p || this.state.get(p.key) !== 'ready') return null;
    return { media: { type: 'video', url: `/api/proxies/file/${p.key}`, assetId: p.key }, offset: (sh.from || 0) - p.s };
  }
  progress() { return { ready: this.keys.filter((k) => this.state.get(k) === 'ready').length, total: this.keys.length }; }

  /** Make sure every shot of the assembly has (or will get) a proxy. */
  async sync(sb: Storyboard | null) {
    if (sb?.mode !== 'edit') { this.keys = []; this.emit(); return; }
    const all = sb.scenes.flatMap((s) => s.shots || []).map(proxyOf).filter(Boolean) as NonNullable<ReturnType<typeof proxyOf>>[];
    const uniq = [...new Map(all.map((p) => [p.key, p])).values()];
    this.keys = uniq.map((p) => p.key);
    for (const p of uniq) this.items.set(p.key, p.item);
    const unknown = uniq.filter((p) => !this.state.has(p.key));
    if (unknown.length) {
      // Ask which already exist, queue the rest in timeline order.
      const st = await this.status(unknown.map((p) => p.key));
      const todo = unknown.filter((p) => st[p.key] !== 'ready');
      for (let i = 0; i < todo.length; i += 400) await this.post(todo.slice(i, i + 400).map((p) => p.item), false);
    }
    this.emit();
    this.poll();
  }
  /** Move the shots about to play to the front of the server's queue (at most every 3 s). */
  bump(shots: Shot[]) {
    const now = Date.now();
    if (now - this.lastBump < 3000) return;
    const items = shots.map(proxyOf).filter((p) => p && this.state.get(p.key) === 'pending').map((p) => p!.item);
    if (!items.length) return;
    this.lastBump = now;
    this.post(items, true).catch(() => {});
  }

  private async post(items: any[], front: boolean) {
    const r = await fetch('/api/proxies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items, front }) });
    if (!r.ok) return;
    for (const it of items) if (this.state.get(`${it.id}_${it.s}_${it.e}`) !== 'ready') this.state.set(`${it.id}_${it.s}_${it.e}`, 'pending');
  }
  private async status(keys: string[]) {
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += 500) {
      const r = await fetch('/api/proxies/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: keys.slice(i, i + 500) }) });
      if (!r.ok) continue;
      Object.assign(out, await r.json());
    }
    for (const [k, v] of Object.entries(out)) {
      if (v === 'ready') this.state.set(k, 'ready');
      else if (v.startsWith('failed')) this.state.set(k, 'failed');
      else if (v === 'pending') this.state.set(k, 'pending');
    }
    return out;
  }
  private poll() {
    clearTimeout(this.timer);
    const pending = this.keys.filter((k) => this.state.get(k) === 'pending');
    if (!pending.length) return;
    this.timer = setTimeout(async () => {
      const before = this.progress().ready;
      const st = await this.status(pending).catch(() => ({} as Record<string, string>));
      // The server forgot them (it restarted and its queue lived in memory): queue them again.
      const lost = pending.filter((k) => st[k] === 'none' && this.items.has(k));
      if (lost.length) await this.post(lost.map((k) => this.items.get(k)), false).catch(() => {});
      if (this.progress().ready !== before) this.emit();
      this.poll();
    }, 2000);
  }
}

export const proxies = new Proxies();
