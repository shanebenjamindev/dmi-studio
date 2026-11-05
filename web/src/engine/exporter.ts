// Real-time export: draws every frame to an off-screen canvas and records it with MediaRecorder.
import type { Storyboard, Aspect } from '../types';
import { renderFrame, totalDuration } from './renderer';
import { player } from './player';
import { audio } from './audio';

export const SIZES: Record<Aspect, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };

export function pickMime() {
  const list = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || '';
}

export function canExport() { return !!(window as any).MediaRecorder && !!HTMLCanvasElement.prototype.captureStream; }

export async function exportVideo(sb: Storyboard, aspect: Aspect, shortSide: number, onProgress: (t: number, T: number) => void, signal?: { cancelled: boolean }) {
  const [bw, bh] = SIZES[aspect];
  const k = shortSide / Math.min(bw, bh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bw * k); canvas.height = Math.round(bh * k);
  canvas.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  try {
    player.pause();
    try { await document.fonts.ready; } catch { /* ignore */ }
    await player.media.ready(sb);
    const T = totalDuration(sb);
    const stream = canvas.captureStream(30);
    audio.ensure();
    const tracks: MediaStreamTrack[] = [...stream.getVideoTracks()];
    if (player.opts.music || player.opts.voice) tracks.push(...audio.recDest.stream.getAudioTracks());
    const mime = pickMime();
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: shortSide >= 1080 ? 12e6 : 6e6 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    const opts = player.renderOpts();
    player.syncVideos(0, false);
    renderFrame(ctx, canvas.width, canvas.height, sb, 0, opts);
    rec.start(250);
    await audio.play(sb, 0, T, { music: player.opts.music, voice: player.opts.voice });
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        if (signal?.cancelled) return resolve();
        player.syncVideos(Math.min(t, T - 0.001), true);
        renderFrame(ctx, canvas.width, canvas.height, sb, Math.min(t, T), opts);
        onProgress(Math.min(t, T), T);
        if (t >= T + 0.2) return resolve();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    rec.stop(); await stopped;
    audio.stop(); player.media.pauseAll();
    if (signal?.cancelled) return null;
    const type = (mime || 'video/webm').split(';')[0];
    return new Blob(chunks, { type });
  } finally {
    canvas.remove();
  }
}
