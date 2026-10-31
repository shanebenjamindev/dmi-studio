// Playback controller: owns the clock, keeps AI video clips in sync, draws frames.
import type { Storyboard, Scene } from '../types';
import { renderFrame, timeline, totalDuration, XF, type RenderOpts } from './renderer';
import { audio } from './audio';

type Listener = () => void;
export interface PlayerOpts { captions: boolean; logo: boolean; music: boolean; voice: boolean }

const brand = (() => {
  const mk = (src: string) => { const i = new Image(); i.src = src; i.onload = () => player.draw(); return i; };
  return { full: mk('/brand/logo.png'), white: mk('/brand/logo-white.png'), mark: mk('/brand/mark.png') };
})();

class MediaCache {
  private videos = new Map<string, HTMLVideoElement>();
  private images = new Map<string, HTMLImageElement>();
  get(scene: Scene): HTMLVideoElement | HTMLImageElement | null {
    const m = scene.media; if (!m?.url) return null;
    if (m.type === 'video') {
      let v = this.videos.get(m.url);
      if (!v) {
        v = document.createElement('video');
        v.src = m.url; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
        v.addEventListener('loadeddata', () => player.draw());
        v.addEventListener('seeked', () => { if (!player.playing) player.draw(); });
        this.videos.set(m.url, v);
      }
      return v.readyState >= 2 ? v : null;
    }
    let i = this.images.get(m.url);
    if (!i) { i = new Image(); i.src = m.url; i.onload = () => player.draw(); this.images.set(m.url, i); }
    return i.complete && i.naturalWidth ? i : null;
  }
  video(scene: Scene) { return scene.media?.type === 'video' ? this.videos.get(scene.media.url) || (this.get(scene), this.videos.get(scene.media.url)) : undefined; }
  pauseAll(except: Set<HTMLVideoElement> = new Set()) { this.videos.forEach((v) => { if (!except.has(v) && !v.paused) v.pause(); }); }
  async ready(sb: Storyboard) {
    await Promise.all(sb.scenes.map((s) => new Promise<void>((res) => {
      if (!s.media?.url) return res();
      this.get(s);
      const el: any = s.media.type === 'video' ? this.videos.get(s.media.url) : this.images.get(s.media.url);
      if (!el) return res();
      if (s.media.type === 'video' ? el.readyState >= 2 : el.complete) return res();
      const done = () => res();
      el.addEventListener(s.media.type === 'video' ? 'loadeddata' : 'load', done, { once: true });
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

  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  attach(c: HTMLCanvasElement | null) { this.canvas = c; this.draw(); }
  setStoryboard(sb: Storyboard | null) {
    this.sb = sb;
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

  renderOpts(): RenderOpts { return { captions: this.opts.captions, logo: this.opts.logo, brand, getMedia: (s) => this.media.get(s) }; }

  /** Keep the clip(s) of the visible scene(s) aligned with the timeline. */
  syncVideos(t: number, playing: boolean) {
    const tl = timeline(this.sb);
    const active = new Set<HTMLVideoElement>();
    const cur = tl.find((s) => t >= s.start && t < s.end);
    const segs = cur ? [cur] : [];
    if (cur && tl[cur.i + 1] && cur.end - t < XF + 0.3) segs.push(tl[cur.i + 1]);
    for (const seg of segs) {
      const v = this.media.video(seg.scene);
      if (!v) continue;
      active.add(v);
      const local = Math.max(0, t - seg.start);
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
      this.time = this.startOffset + (performance.now() - this.startPerf) / 1000;
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
    this.playing = false; cancelAnimationFrame(this.raf);
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
