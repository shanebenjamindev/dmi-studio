// Video and audio, converted in the browser with Mediabunny (WebCodecs; hardware encoders where the machine has them).
// A track already in the target codec is copied as it is (fast, no quality loss) unless it is resized or re-compressed.
// GIF: frames drawn from the video and written with gifenc; an animated GIF becomes MP4 through the browser's ImageDecoder.
import {
  Input, Output, ALL_FORMATS, BlobSource, BufferTarget, Conversion, ConversionCanceledError, CanvasSink, CanvasSource,
  Mp4OutputFormat, MovOutputFormat, WebMOutputFormat, MkvOutputFormat, Mp3OutputFormat, WavOutputFormat, OggOutputFormat,
  AdtsOutputFormat, Quality, canEncodeAudio, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
  type OutputFormat, type VideoCodec, type AudioCodec,
} from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { canReadGif } from './formats';

export type MediaOpts = {
  /** Short side of the picture in px (0: as it is); never enlarged. */
  size: number;
  quality: 'keep' | 'high' | 'medium' | 'low';
  onProgress: (p: number) => void;
  signal: AbortSignal;
};
const QUALITY: Record<string, Quality> = { high: new Quality('high'), medium: new Quality('medium'), low: new Quality('low') };

// The container for each target and the codecs to try, most compatible first (no list: whatever the source has).
const TARGETS: Record<string, { format: () => OutputFormat; video?: VideoCodec[]; audio?: AudioCodec[]; audioOnly?: boolean }> = {
  mp4: { format: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), video: ['avc', 'hevc', 'vp9', 'av1'], audio: ['aac', 'opus'] },
  mov: { format: () => new MovOutputFormat({ fastStart: 'in-memory' }), video: ['avc', 'hevc'], audio: ['aac'] },
  webm: { format: () => new WebMOutputFormat(), video: ['vp9', 'vp8', 'av1'], audio: ['opus', 'vorbis'] },
  mkv: { format: () => new MkvOutputFormat() },
  mp3: { format: () => new Mp3OutputFormat(), audio: ['mp3'], audioOnly: true },
  m4a: { format: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), audio: ['aac'], audioOnly: true },
  wav: { format: () => new WavOutputFormat(), audio: ['pcm-s16'], audioOnly: true },
  ogg: { format: () => new OggOutputFormat(), audio: ['opus', 'vorbis'], audioOnly: true },
  aac: { format: () => new AdtsOutputFormat(), audio: ['aac'], audioOnly: true },
};
export const MIME: Record<string, string> = { m4a: 'audio/mp4', aac: 'audio/aac' };

let mp3Ready = false;
async function needMp3() {
  if (!mp3Ready && !(await canEncodeAudio('mp3'))) registerMp3Encoder();
  mp3Ready = true;
}
const failed = (e: unknown) => (e instanceof ConversionCanceledError ? new Error('Đã dừng') : e);

/** Converts `file`; `warn` notes what had to be left out (e.g. a sound track the browser cannot encode). */
export async function convertMedia(file: File, to: string, opts: MediaOpts): Promise<{ blob: Blob; warn?: string }> {
  if (/\.gif$/i.test(file.name) && to === 'mp4') return { blob: await gifToVideo(file, opts) };
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (to === 'gif') return { blob: await videoToGif(input, opts) };
    const t = TARGETS[to];
    if (!t) throw new Error('Không hỗ trợ định dạng này');
    if (to === 'mp3') await needMp3();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!audio && (t.audioOnly || !video)) throw new Error('File không có âm thanh');
    const quality = QUALITY[opts.quality];
    // Resize on the short side so a vertical video keeps the same sharpness as a horizontal one.
    let dims: { width?: number; height?: number } = {};
    if (video && opts.size) {
      const { displayWidth: w, displayHeight: h } = video;
      if (Math.min(w, h) > opts.size) dims = w <= h ? { width: opts.size } : { height: opts.size };
    }
    // The first codec this browser can encode; with none, a source already in one of them can still be copied.
    let vcodec = video && t.video ? await getFirstEncodableVideoCodec(t.video, { width: video.displayWidth, height: video.displayHeight }) : null;
    if (!vcodec && video?.codec && t.video?.includes(video.codec)) vcodec = video.codec;
    let acodec = audio && t.audio ? await getFirstEncodableAudioCodec(t.audio, { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }) : null;
    if (!acodec && audio?.codec && t.audio?.includes(audio.codec)) acodec = audio.codec;
    if (t.audio && audio && !acodec && (t.audioOnly || !video)) throw new Error(`Trình duyệt này không xuất được ${to.toUpperCase()}`);
    const output = new Output({ format: t.format(), target: new BufferTarget() });
    const conv = await Conversion.init({
      input, output, showWarnings: false,
      video: t.audioOnly ? { discard: true } : { ...dims, codec: vcodec ?? undefined, quality },
      audio: t.audio && !acodec ? { discard: true } : { codec: acodec ?? undefined, quality },
    });
    const lost = conv.discardedTracks.filter((d) => d.reason !== 'discarded_by_user');
    if (!conv.isValid || (video && !t.audioOnly && lost.some((d) => d.track.isVideoTrack()))) {
      throw new Error(lost.some((d) => d.reason === 'undecodable_source_codec') ? 'Trình duyệt này không giải mã được file này — thử Chrome hoặc Safari bản mới' : `Trình duyệt này không xuất được ${to.toUpperCase()}`);
    }
    const warn = audio && !t.audioOnly && ((t.audio && !acodec) || lost.some((d) => d.track.isAudioTrack())) ? 'Đã bỏ âm thanh: trình duyệt không mã hoá được tiếng cho định dạng này' : undefined;
    conv.onProgress = (p) => opts.onProgress(p);
    const stop = () => { void conv.cancel(); };
    opts.signal.addEventListener('abort', stop);
    try { await conv.execute(); } catch (e) { throw failed(e); } finally { opts.signal.removeEventListener('abort', stop); }
    return { blob: new Blob([output.target.buffer!], { type: MIME[to] || output.format.mimeType }), warn };
  } finally { input.dispose(); }
}

const GIF_FPS = 12, GIF_MAX_SECONDS = 60;
/** The video as an animated GIF: 12 frames a second, the long side at most 480 px (or the size chosen, if smaller), the first minute. */
async function videoToGif(input: Input, opts: MediaOpts) {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('File không có hình');
  if (!(await track.canDecode())) throw new Error('Trình duyệt này không giải mã được video này');
  const long = Math.min(480, opts.size || 480), { displayWidth: w, displayHeight: h } = track;
  const k = Math.min(1, long / Math.max(w, h)), width = Math.max(2, Math.round(w * k)), height = Math.max(2, Math.round(h * k));
  const start = await track.getFirstTimestamp(), end = Math.min(await track.computeDuration(), start + GIF_MAX_SECONDS);
  const times = Array.from({ length: Math.max(1, Math.floor((end - start) * GIF_FPS)) }, (_, i) => start + i / GIF_FPS);
  const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 });
  const gif = GIFEncoder();
  let n = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (opts.signal.aborted) throw new Error('Đã dừng');
    n++;
    if (!frame) continue;
    const data = (frame.canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, width, height).data;
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: 1000 / GIF_FPS });
    opts.onProgress(n / times.length);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/** An animated GIF as an MP4 (H.264 where the browser has it), transparent parts on white. */
async function gifToVideo(file: File, opts: MediaOpts) {
  if (!canReadGif()) throw new Error('Trình duyệt này không đọc được GIF động — hãy dùng Chrome');
  const dec = new (window as any).ImageDecoder({ data: file.stream(), type: 'image/gif' });
  try {
    await dec.completed;
    const count: number = dec.tracks.selectedTrack.frameCount;
    const first = (await dec.decode({ frameIndex: 0 })).image;
    // Video encoders need even sizes.
    const width = Math.ceil(first.displayWidth / 2) * 2, height = Math.ceil(first.displayHeight / 2) * 2;
    first.close();
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'hevc'], { width, height });
    if (!codec) throw new Error('Trình duyệt này không xuất được MP4');
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d')!;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new CanvasSource(canvas, { codec, quality: QUALITY[opts.quality] || QUALITY.high });
    output.addVideoTrack(source);
    await output.start();
    let t = 0;
    for (let i = 0; i < count; i++) {
      if (opts.signal.aborted) { await output.cancel(); throw new Error('Đã dừng'); }
      const { image } = await dec.decode({ frameIndex: i });
      // Browsers play a GIF frame shorter than 20 ms as 100 ms.
      const d = image.duration && image.duration >= 20000 ? image.duration / 1e6 : 0.1;
      g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
      g.drawImage(image, 0, 0, width, height);
      image.close();
      await source.add(t, d);
      t += d;
      opts.onProgress((i + 1) / count);
    }
    await output.finalize();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally { dec.close(); }
}
