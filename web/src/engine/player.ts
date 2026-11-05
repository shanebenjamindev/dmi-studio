// Playback controller: owns the clock, keeps AI video clips in sync, draws frames.
import type { Storyboard, Scene, MediaRef } from '../types';
import { renderFrame, timeline, totalDuration, shotAt, XF, type RenderOpts, type Segment } from './renderer';
import { audio } from './audio';
import { proxies } from './proxies';

type Listener = () => void;
export interface PlayerOpts { captions: boolean; logo: boolean; music: boolean; voice: boolean }

const brand = (() => {
  const mk = (src: string) => { const i = new Image(); i.src = src; i.onload = () => player.draw(); return i; };
  return { full: mk('/brand/logo.png'), white: mk('/brand/logo-white.png'), mark: mk('/brand/mark.png') };
})();

class MediaCache {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  get(scene: Scene) { return scene.media?.url ? this.ref(scene.media) : null; }
  ref(m: MediaRef): HTMLVideoElement | HTMLImageElement | null {
    if (!m?.url) return null;
    if (m.type === 'video') {
      const v = this.videoEl(m.url);
      return v.readyState >= 2 ? v : null;
    }
    let i = this.images.get(m.url);
    if (!i) { i = new Image(); i.src = m.url; i.onload = () => player.draw(); this.images.set(m.url, i); }
    return i.complete && i.naturalWidth ? i : null;
  }
  private videoEl(url: string) {
    let v = this.videos.get(url);
    if (!v) {
      v = document.createElement('video');
      v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.addEventListener('loadeddata', () => player.draw());
      v.addEventListener('seeked', () => { if (!player.playing) player.draw(); });
      this.videos.set(url, v);
    }
    return v;
  }
  video(scene: Scene) { return scene.media?.type === 'video' ? this.videoEl(scene.media.url) : undefined; }
  /** Drive sources have a thumbnail next to the clip (same signed query); shown until the clip can play. */
  thumb(m: MediaRef) {
    if (m.provider !== 'drive' || m.type !== 'video') return null;
    return this.ref({ type: 'image', url: m.url.replace('?', '/thumb?'), assetId: m.assetId + ':thumb' });
  }
  /**
   * Edit mode keeps only the clips around the playhead loaded: a browser opens ~6 connections per server, and
   * dozens of half-buffered Drive clips would starve the one that has to play next.
   */
  keepOnly(urls: Set<string>) {
    for (const [url, v] of this.videos) {
      if (urls.has(url)) continue;
      v.pause(); v.removeAttribute('src'); v.load();
      this.videos.delete(url);
    }
  }
  /** Start loading a clip and park it on its in-point so it can show its first frame at once. */
  prime(m: MediaRef, from: number) {
    const v = this.videoOf(m); if (!v) return;
    if (v.paused && v.readyState >= 1 && Math.abs(v.currentTime - from) > 0.3) v.currentTime = from;
  }
  videoOf(m: MediaRef) { return m.type === 'video' ? this.videoEl(m.url) : undefined; }
  pauseAll(except: Set<HTMLVideoElement> = new Set()) { this.videos.forEach((v) => { if (!except.has(v) && !v.paused) v.pause(); }); }
  /** Waits (up to 8 s each) until every clip, photo and the logo used by the storyboard can be drawn. */
  async ready(sb: Storyboard) {
    const refs = new Map<string, MediaRef>();
    // An assembly can hold a hundred clips: only its first few are waited for, the rest load as playback reaches them.
    const shots = sb.mode === 'edit' ? sb.scenes.flatMap((s) => s.shots || []).slice(0, 3).map((x) => x.media) : sb.scenes.map((s) => s.media);
    for (const m of shots) if (m?.url) refs.set(m.url, m);
    if (sb.logo?.url) refs.set(sb.logo.url, sb.logo);
    await Promise.all([...refs.values()].map((m) => new Promise<void>((res) => {
      this.ref(m);
      const el: any = m.type === 'video' ? this.videos.get(m.url) : this.images.get(m.url);
      if (!el || (m.type === 'video' ? el.readyState >= 2 : el.complete)) return res();
      const done = () => res();
      el.addEventListener(m.type === 'video' ? 'loadeddata' : 'load', done, { once: true });
      el.addEventListener('error', done, { once: true });
      setTimeout(done, 8000);
    })));
  }
}

class Player {
  canvas: HTMLCanvasElement | null = null;
  sb: Storyboard | null = null;
  time = 0;
  playing = false;
  opts: PlayerOpts = { captions: true, logo: true, music: true, voice: true };
  media = new MediaCache();
  private startPerf = 0;
  private startOffset = 0;
  private listeners = new Set<Listener>();
  private raf = 0;
  externalClock: (() => number) | null = null; // used by exporter
  /** Edit mode: the clip under the playhead can't play yet, so the clock waits for it instead of running ahead. */
  waiting = false;
  private proxyTimer: any = 0;
  /** What actually plays for a shot: its light proxy once the server made it, otherwise the original Drive clip. */
  playable(shot: NonNullable<Scene['shots']>[number]) { return proxies.playable(shot) || { media: shot.media, offset: shot.from || 0 }; }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  attach(c: HTMLCanvasElement | null) { this.canvas = c; this.draw(); }
  setStoryboard(sb: Storyboard | null) {
    this.sb = sb;
    clearTimeout(this.proxyTimer);
    this.proxyTimer = setTimeout(() => proxies.sync(this.sb).catch(() => {}), 400); // after trims settle
    const T = totalDuration(sb);
    if (this.time > T) this.time = T;
    if (this.playing) this.restartAudio();
    this.draw();
  }
  setOpts(o: Partial<PlayerOpts>) {
    const audioChanged = ('music' in o && o.music !== this.opts.music) || ('voice' in o && o.voice !== this.opts.voice);
    this.opts = { ...this.opts, ...o };
    if (audioChanged && this.playing) this.restartAudio();
    this.draw();
  }
  get total() { return totalDuration(this.sb); }
  sceneIndexAt(t: number) { const tl = timeline(this.sb); const s = tl.find((x) => t >= x.start && t < x.end); return s ? s.i : Math.max(0, tl.length - 1); }

  renderOpts(): RenderOpts {
    return { captions: this.opts.captions, logo: this.opts.logo && this.sb?.brandLogo !== false, brand, getMedia: (s) => this.media.get(s), getRef: (m) => this.media.ref(m), getThumb: (m) => this.media.thumb(m), getShot: (sh) => this.media.ref(this.playable(sh).media) };
  }

  /** Keep the clip(s) of the visible scene(s) aligned with the timeline. */
  syncVideos(t: number, playing: boolean) {
    const tl = timeline(this.sb);
    if (this.sb?.mode === 'edit') return this.syncShots(tl, t, playing);
    const active = new Set<HTMLVideoElement>();
    const cur = tl.find((s) => t >= s.start && t < s.end);
    const segs = cur ? [cur] : [];
    if (cur && tl[cur.i + 1] && cur.end - t < XF + 0.3) segs.push(tl[cur.i + 1]);
    for (const seg of segs) {
      // Edit mode: the clip of the current shot, played from the shot's in-point.
      const local0 = Math.max(0, t - seg.start);
      const at = seg.scene.shots?.length ? shotAt(seg.scene, local0) : null;
      const v = at ? this.media.videoOf(at.shot.media) : this.media.video(seg.scene);
      if (!v) continue;
      active.add(v);
      const local = at ? (at.shot.from || 0) + at.local : local0;
      const target = v.duration && isFinite(v.duration) ? local % v.duration : local;
      if (playing) {
        if (v.paused) v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > 0.35 && v.readyState >= 1) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04 && v.readyState >= 1) v.currentTime = target;
      }
    }
    this.media.pauseAll(active);
  }

  /** Edit mode: play the current shot's clip from its in-point; preload the next two; drop everything else. */
  private syncShots(tl: Segment[], t: number, playing: boolean) {
    const flat: { start: number; shot: NonNullable<Scene['shots']>[number] }[] = [];
    for (const seg of tl) { let s = seg.start; for (const shot of seg.scene.shots || []) { flat.push({ start: s, shot }); s += shot.dur; } }
    let i = flat.findIndex((x) => t < x.start + x.shot.dur);
    if (i < 0) i = flat.length - 1;
    const near = flat.slice(Math.max(0, i), i + 3).map((x) => ({ ...x, play: this.playable(x.shot) }));
    proxies.bump(flat.slice(i, i + 6).map((x) => x.shot));
    this.media.keepOnly(new Set(near.filter((x) => x.play.media.type === 'video').map((x) => x.play.media.url)));
    const cur = near[0];
    const v = cur && this.media.videoOf(cur.play.media);
    for (const x of near.slice(1)) if (x.play.media.url !== cur?.play.media.url) this.media.prime(x.play.media, x.play.offset);
    this.waiting = !!v && playing && (v.readyState < 3 || v.seeking);
    if (!cur || !v) return;
    const local = cur.play.offset + Math.max(0, t - cur.start);
    const target = v.duration && isFinite(v.duration) ? Math.min(local, v.duration - 0.05) : local;
    if (playing) {
      if (v.paused) v.play().catch(() => {});
      // Seek only when really off, and never while a seek is still loading: every seek is a new request to Drive.
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.5 && v.readyState >= 1) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.04 && v.readyState >= 1) v.currentTime = target;
    }
  }

  draw(t = this.time, canvas = this.canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    renderFrame(ctx, canvas.width, canvas.height, this.sb, t, this.renderOpts());
  }

  play() {
    if (!this.sb?.scenes.length) return;
    if (this.time >= this.total - 0.05) this.time = 0;
    this.playing = true;
    this.startPerf = performance.now(); this.startOffset = this.time;
    this.restartAudio();
    cancelAnimationFrame(this.raf);
    const loop = () => {
      if (!this.playing) return;
      if (this.waiting) { this.startPerf = performance.now(); this.startOffset = this.time; } // hold while buffering
      else this.time = this.startOffset + (performance.now() - this.startPerf) / 1000;
      if (this.time >= this.total) { this.time = this.total; this.pause(); this.draw(); this.emit(); return; }
      this.syncVideos(this.time, true);
      this.draw();
      this.emit();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.emit();
  }
  pause() {
    this.playing = false; this.waiting = false; cancelAnimationFrame(this.raf);
    audio.stop(); this.media.pauseAll();
    this.emit();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t: number) {
    this.time = Math.max(0, Math.min(this.total, t));
    if (this.playing) { this.startPerf = performance.now(); this.startOffset = this.time; this.restartAudio(); }
    this.syncVideos(this.time, this.playing);
    this.draw(); this.emit();
  }
  restartAudio() {
    if (!this.sb) return;
    audio.play(this.sb, this.time, this.total, { music: this.opts.music, voice: this.opts.voice });
  }
}

export const player = new Player();

// A clip's proxy just became ready: redraw so a paused frame switches to it.
proxies.subscribe(() => { if (!player.playing) player.draw(); });
