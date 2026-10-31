// In-browser video analysis: no upload, no API. Samples frames from a local file and measures
// cuts, pacing, camera motion, zoom, slow-motion (speed ramp) segments and the colour look,
// then writes prompts that describe how to recreate the edit.
import type { Aspect } from '../types';
import { TEMPLATES, type CarTemplate } from '../templates';

export type CameraMove = 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' | 'zoom-in' | 'zoom-out' | 'handheld';
export type TransitionKind = 'cut' | 'jump-cut' | 'flash' | 'fade-black' | 'fade-white' | 'dissolve' | 'whip';
export type Effect = 'shake' | 'freeze' | 'letterbox' | 'flash' | 'jump-cuts' | 'speed-ramp';
export type EditStyle = 'ugc' | 'talking' | 'velocity' | 'cinematic' | 'montage' | 'slideshow' | 'oneshot';
export interface Shot { start: number; end: number; move: CameraMove; motion: number; lum: number; enter: TransitionKind | null }
export interface Point { t: number; motion: number }
export interface Look { lum: number; contrast: number; sat: number; warmth: number }
export interface AudioInfo { has: boolean; voice: boolean; music: boolean; bpm: number | null; beatSync: number | null; ler: number; tempoConf: number }
export interface Analysis {
  name: string; duration: number; width: number; height: number; aspect: Aspect; step: number;
  points: Point[]; cuts: number[]; transitions: { t: number; kind: TransitionKind }[]; shots: Shot[]; slowmo: [number, number][];
  effects: Effect[]; audio: AudioInfo; style: EditStyle;
  palette: string[]; look: Look; keyframes: { t: number; url: string }[];
}

const SW = 64; // analysis frame width (px)
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a: number[], q: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

/** Seek and wait for the frame. Resolves false on a media error or if the browser never reports the seek. */
function seek(v: HTMLVideoElement, t: number, ms = 5000) {
  return new Promise<boolean>((res) => {
    let timer = 0;
    const end = (ok: boolean) => { clearTimeout(timer); v.removeEventListener('seeked', onSeeked); v.removeEventListener('error', onError); res(ok); };
    const onSeeked = () => end(true), onError = () => end(false);
    v.addEventListener('seeked', onSeeked); v.addEventListener('error', onError);
    timer = window.setTimeout(() => end(!v.error && v.readyState >= 2), ms);
    v.currentTime = t;
  });
}
const H264 = 'video/mp4; codecs="avc1.42E01E"';
function mediaError(v: HTMLVideoElement) {
  if (!v.canPlayType(H264)) return 'Trình duyệt này không hỗ trợ video MP4 (H.264), thường gặp ở khung xem trước của VS Code. Hãy mở trang bằng Chrome hoặc Safari.';
  const code = v.error?.code;
  if (code === 4) return 'Trình duyệt không hỗ trợ định dạng/codec của video này. Hãy thử file .mp4 (H.264) hoặc mở bằng Chrome.';
  if (code === 3) return `Video bị lỗi khi giải mã${v.error?.message ? ` (${v.error.message})` : ''}. Hãy thử tải lại file hoặc dùng Chrome.`;
  return `Trình duyệt không đọc được video này${code ? ` (mã lỗi ${code})` : ''}.`;
}
/** A hidden <video> attached to the page: Safari decodes detached media elements unreliably. */
export function loadVideo(url: string) {
  return new Promise<HTMLVideoElement>((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('aria-hidden', 'true');
    v.style.cssText = 'position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    v.onloadeddata = () => { v.onerror = null; res(v); };
    v.onerror = () => { const msg = mediaError(v); v.remove(); rej(new Error(msg)); };
    v.src = url;
  });
}
function dispose(v: HTMLVideoElement) { v.removeAttribute('src'); v.load(); v.remove(); }

interface Frame { t: number; gray: Uint8ClampedArray; hist: Float32Array; lum: number; sat: number; r: number; b: number; std: number }

function measure(img: ImageData, t: number, pixels: number[][]): Frame {
  const { data, width, height } = img, n = width * height;
  const gray = new Uint8ClampedArray(n), hist = new Float32Array(48);
  let lum = 0, sat = 0, r = 0, b = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
    const y = 0.299 * R + 0.587 * G + 0.114 * B, mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    gray[i] = y; lum += y; sq += y * y; r += R; b += B; sat += mx ? (mx - mn) / mx : 0;
    hist[R >> 4]++; hist[16 + (G >> 4)]++; hist[32 + (B >> 4)]++;
    if (i % 9 === 0) pixels.push([R, G, B]);
  }
  for (let k = 0; k < 48; k++) hist[k] /= n * 3;
  lum /= n;
  return { t, gray, hist, lum, sat: sat / n, r: r / n, b: b / n, std: Math.sqrt(Math.max(0, sq / n - lum * lum)) };
}

/** Best global shift (content displacement) and zoom between two grayscale frames. */
function flow(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number) {
  const m = 6, cx = w / 2, cy = h / 2;
  const sad = (fx: (x: number, y: number) => number) => {
    let s = 0, c = 0;
    for (let y = m; y < h - m; y += 2) for (let x = m; x < w - m; x += 2) { const v = fx(x, y); if (v >= 0) { s += Math.abs(b[y * w + x] - v); c++; } }
    return c ? s / c : 1e9;
  };
  const at = (x: number, y: number) => { const xi = Math.round(x), yi = Math.round(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : a[yi * w + xi]; };
  let best = { dx: 0, dy: 0, z: 1, e: sad((x, y) => a[y * w + x]) };
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    if (!dx && !dy) continue;
    const e = sad((x, y) => at(x + dx, y + dy));
    if (e < best.e * 0.97) best = { dx, dy, z: 1, e };
  }
  for (const z of [1.05, 0.95]) {
    const e = sad((x, y) => at(cx + (x - cx) / z, cy + (y - cy) / z));
    if (e < best.e * 0.97) best = { dx: 0, dy: 0, z, e };
  }
  return best;
}

function kmeans(px: number[][], k = 5) {
  if (!px.length) return [];
  const sorted = [...px].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]));
  let cs = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]]);
  let count = new Array(k).fill(0);
  for (let it = 0; it < 10; it++) {
    const sum = cs.map(() => [0, 0, 0]); count = new Array(k).fill(0);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cs.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; count[bi]++;
    }
    cs = cs.map((c, i) => (count[i] ? sum[i].map((s) => s / count[i]) : c));
  }
  return cs.map((c, i) => ({ c, n: count[i] })).filter((x) => x.n > 0).sort((p, q) => q.n - p.n).map((x) => hex(x.c[0], x.c[1], x.c[2]));
}

function aspectOf(w: number, h: number): Aspect {
  const r = w / h;
  return r > 1.25 ? '16:9' : r < 0.8 ? '9:16' : '1:1';
}

export async function analyzeVideo(file: File, url: string, onProgress: (k: number) => void): Promise<Analysis> {
  let v = await loadVideo(url);
  /** Seek, and on failure reopen the file once and retry — a single bad seek shouldn't sink the whole analysis. */
  const grab = async (t: number) => {
    if (await seek(v, t)) return true;
    dispose(v);
    v = await loadVideo(url);
    return seek(v, t);
  };
  let failed = 0;
  const duration = Math.min(v.duration || 0, 90);
  if (!duration || !isFinite(duration)) throw new Error('Không đọc được thời lượng video');
  const vw = v.videoWidth, vh = v.videoHeight;
  const W = SW, H = Math.max(16, Math.round((SW * vh) / vw));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const step = clamp(duration / 220, 1 / 12, 0.5);
  const frames: Frame[] = [], pixels: number[][] = [];
  const total = Math.floor(duration / step);
  for (let i = 0; i <= total; i++) {
    const t = Math.min(duration - 0.02, i * step);
    if (await grab(t)) {
      g.drawImage(v, 0, 0, W, H);
      frames.push(measure(g.getImageData(0, 0, W, H), t, pixels));
    } else if (++failed > Math.max(5, total * 0.3)) { const msg = mediaError(v); dispose(v); throw new Error(msg); }
    onProgress((i / total) * 0.85);
  }
  if (frames.length < 3) { dispose(v); throw new Error('Không lấy được khung hình nào từ video.'); }

  const audioP = analyzeAudio(file, duration);
  const n = frames.length, at = (i: number) => frames[Math.max(0, Math.min(n - 1, i))];

  // Transitions. Two signals per sample: colour-histogram change (scene/colour change) and the residual left
  // after the best camera-motion alignment (structure change — catches jump cuts inside the same location).
  // A cut is a single-sample spike in either; camera motion keeps the residual high for several samples instead.
  const flows = frames.map((f, i) => (i ? flow(frames[i - 1].gray, f.gray, W, H) : null));
  const dh = frames.map((f, i) => (i ? f.hist.reduce((x, v, k) => x + Math.abs(v - frames[i - 1].hist[k]), 0) : 0));
  const de = flows.map((f) => (f ? f.e : 0));
  const medH = median(dh.slice(1)), medE = median(de.slice(1));
  const spike = (arr: number[], i: number) => arr[i] > 1.8 * Math.max(arr[i - 1] || 0, arr[i + 1] || 0, 1e-6);
  const transitions: { t: number; kind: TransitionKind; i: number }[] = [];
  const push = (i: number, kind: TransitionKind) => {
    const last = transitions[transitions.length - 1];
    if (last && frames[i].t - last.t < 0.35) return;
    transitions.push({ t: frames[i].t, kind, i });
  };
  for (let i = 1; i < n; i++) {
    const colour = dh[i] > 0.45 && dh[i] > medH * 3 && spike(dh, i);
    const struct = de[i] > Math.max(16, medE * 3.2) && spike(de, i);
    if (!colour && !struct) continue;
    let kind: TransitionKind = dh[i] < 0.3 ? 'jump-cut' : 'cut';
    const win = [-2, -1, 0, 1, 2].map((k) => at(i + k).lum), around = (at(i - 4).lum + at(i + 4).lum) / 2;
    const bright = win.filter((l) => l > 215).length, dark = win.filter((l) => l < 18).length;
    if (bright && Math.max(...win) - around > 50) kind = bright >= 3 ? 'fade-white' : 'flash';
    else if (dark >= 2 && around > 40) kind = 'fade-black';
    else if (Math.min(Math.abs(flows[i - 1]?.dx || 0), Math.abs(flows[i + 1]?.dx || 0)) >= 5) kind = 'whip';
    push(i, kind);
  }
  // dissolves: a gradual colour change spread over several samples with no camera motion and no hard cut
  for (let i = 2; i < n - 2; i++) {
    const w = [dh[i - 1], dh[i], dh[i + 1], dh[i + 2]];
    const still = [i - 1, i, i + 1, i + 2].every((k) => !flows[k] || (Math.abs(flows[k]!.dx) <= 1 && Math.abs(flows[k]!.dy) <= 1));
    if (still && w.every((x) => x > 0.08 && x < 0.45) && w.reduce((x, y) => x + y, 0) > 0.6 && !transitions.some((tr) => Math.abs(tr.i - i) < 4)) {
      transitions.push({ t: frames[i].t, kind: 'dissolve', i });
    }
  }
  transitions.sort((x, y) => x.t - y.t);
  const cuts = transitions.map((tr) => tr.t);
  const cutIdx = new Set(transitions.map((tr) => tr.i));

  const points: Point[] = frames.map((f, i) => {
    if (!i || cutIdx.has(i)) return { t: f.t, motion: NaN };
    let x = 0; const a = frames[i - 1].gray;
    for (let k = 0; k < f.gray.length; k++) x += Math.abs(f.gray[k] - a[k]);
    return { t: f.t, motion: x / f.gray.length / step / 10 };
  });
  points.forEach((p, i) => { if (isNaN(p.motion)) p.motion = points[i - 1]?.motion || 0; });

  // shots
  const bounds = [0, ...cuts, duration];
  const shots: Shot[] = [];
  let shakeVotes = 0, shakeShots = 0;
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const idx = frames.map((_, i) => i).filter((i) => frames[i].t >= a && frames[i].t < b && !cutIdx.has(i));
    const fl = idx.map((i) => flows[i]).filter(Boolean) as ReturnType<typeof flow>[];
    const vx = fl.reduce((x, f) => x + f.dx, 0) / Math.max(1, fl.length) / W / step;
    const vy = fl.reduce((x, f) => x + f.dy, 0) / Math.max(1, fl.length) / H / step;
    const zoom = fl.reduce((x, f) => x + (f.z > 1 ? 1 : f.z < 1 ? -1 : 0), 0) / Math.max(1, fl.length);
    const jitter = fl.length ? fl.filter((f) => f.dx || f.dy).length / fl.length : 0;
    // shake = the shift keeps flipping direction rather than drifting one way
    const flips = fl.slice(1).filter((f, j) => f.dx * fl[j].dx < 0 || f.dy * fl[j].dy < 0).length / Math.max(1, fl.length - 1);
    if (fl.length > 3) { shakeShots++; if (flips > 0.35 && jitter > 0.5) shakeVotes++; }
    const motion = idx.reduce((x, i) => x + points[i].motion, 0) / Math.max(1, idx.length);
    let move: CameraMove = 'static';
    if (Math.abs(zoom) > 0.35) move = zoom > 0 ? 'zoom-in' : 'zoom-out';
    else if (Math.max(Math.abs(vx), Math.abs(vy)) > 0.04) move = Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? 'pan-left' : 'pan-right') : (vy < 0 ? 'tilt-up' : 'tilt-down');
    else if (jitter > 0.5 && motion > 1) move = 'handheld'; // frame really shifts; big motion alone is action inside the frame
    shots.push({ start: a, end: b, move, motion, lum: idx.reduce((x, i) => x + frames[i].lum, 0) / Math.max(1, idx.length), enter: k ? transitions[k - 1].kind : null });
  }

  // slow motion: a sustained dip where things still move (not a static hold), with busy motion on both sides
  const slowmo: [number, number][] = [];
  for (const sh of shots) {
    if (sh.end - sh.start < 1.5) continue;
    const ps = points.filter((p) => p.t > sh.start + step && p.t < sh.end - step);
    const sm = ps.map((_, i) => ps.slice(Math.max(0, i - 1), i + 2).reduce((x, q) => x + q.motion, 0) / ps.slice(Math.max(0, i - 1), i + 2).length);
    const peak = pct(sm, 0.8);
    if (peak < 3) continue;
    let from = -1;
    for (let i = 0; i <= sm.length; i++) {
      const low = i < sm.length && sm[i] < peak * 0.3 && sm[i] > 0.5;
      if (low && from < 0) from = i;
      if (!low && from >= 0) {
        const t0 = ps[from].t, t1 = ps[i - 1].t;
        const before = sm.slice(0, from).some((x) => x > peak * 0.6);
        const after = sm.slice(i).some((x) => x > peak * 0.6) && sh.end - t1 >= 0.3;
        if (t1 - t0 >= 0.4 && t1 - t0 <= 3 && before && after) slowmo.push([t0, t1]);
        from = -1;
      }
    }
  }

  // effects
  const effects: Effect[] = [];
  if (shakeShots && shakeVotes / shakeShots > 0.5) effects.push('shake');
  const run = Math.ceil(0.5 / step);
  for (const sh of shots) {
    if (sh.motion < 2) continue;
    const ps = points.filter((p) => p.t > sh.start && p.t < sh.end);
    let r = 0;
    if (ps.some((p) => ((r = p.motion < 0.05 ? r + 1 : 0), r >= run))) { effects.push('freeze'); break; }
  }
  const bars = frames.filter((f) => {
    let top = 0, bot = 0;
    for (let x = 0; x < W; x++) { top += f.gray[x] + f.gray[W + x]; bot += f.gray[(H - 1) * W + x] + f.gray[(H - 2) * W + x]; }
    return top / (2 * W) < 12 && bot / (2 * W) < 12 && f.lum > 30;
  }).length;
  if (bars > n * 0.85) effects.push('letterbox');
  if (transitions.some((tr) => tr.kind === 'flash')) effects.push('flash');
  if (transitions.filter((tr) => tr.kind === 'jump-cut').length >= 2) effects.push('jump-cuts');
  if (slowmo.length) effects.push('speed-ramp');

  const look: Look = {
    lum: frames.reduce((x, f) => x + f.lum, 0) / n,
    contrast: frames.reduce((x, f) => x + f.std, 0) / n,
    sat: frames.reduce((x, f) => x + f.sat, 0) / n,
    warmth: frames.reduce((x, f) => x + f.r - f.b, 0) / n / 255,
  };
  const step2 = Math.max(1, Math.floor(pixels.length / 4000));
  const palette = kmeans(pixels.filter((_, i) => i % step2 === 0), 5);

  // keyframes: middle of each shot (max 12), or evenly spaced for one-shot clips
  const times = shots.length > 1 ? shots.slice(0, 12).map((x) => (x.start + x.end) / 2) : [0.15, 0.4, 0.65, 0.9].map((k) => k * duration);
  const kc = document.createElement('canvas'); kc.width = 320; kc.height = Math.round((320 * vh) / vw);
  const kg = kc.getContext('2d')!;
  const keyframes: { t: number; url: string }[] = [];
  for (const [i, t] of times.entries()) {
    if (await grab(t)) { kg.drawImage(v, 0, 0, kc.width, kc.height); keyframes.push({ t, url: kc.toDataURL('image/jpeg', 0.82) }); }
    onProgress(0.85 + (0.15 * (i + 1)) / times.length);
  }
  dispose(v);

  const { onsets, ...audio } = await audioP;
  if (audio.music && cuts.length >= 2 && onsets.length) {
    audio.beatSync = cuts.filter((c) => onsets.some((o) => Math.abs(o - c) < 0.09)).length / cuts.length;
  }
  const result: Analysis = {
    name: file.name, duration, width: vw, height: vh, aspect: aspectOf(vw, vh), step,
    points, cuts, transitions: transitions.map(({ t, kind }) => ({ t, kind })), shots, slowmo, effects, audio, style: 'montage',
    palette, look, keyframes,
  };
  result.style = classify(result);
  return result;
}

// ---------------------------------------------------------------- audio: voice vs music, tempo, onsets
function fft(re: Float64Array, im: Float64Array) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
const NO_AUDIO = { has: false, voice: false, music: false, bpm: null, beatSync: null, ler: 0, tempoConf: 0, onsets: [] as number[] };
async function analyzeAudio(file: File, duration: number): Promise<AudioInfo & { onsets: number[] }> {
  let buf: AudioBuffer;
  try {
    const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    buf = await new Ctx(1, 22050, 22050).decodeAudioData(await file.arrayBuffer());
  } catch { return NO_AUDIO; }
  const sr = buf.sampleRate, len = Math.min(buf.length, Math.floor(duration * sr));
  const mono = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / buf.numberOfChannels; }
  const N = 1024, hop = 512, fps = sr / hop, frames = Math.floor((len - N) / hop);
  if (frames < fps * 2) return NO_AUDIO;
  const rms = new Float64Array(frames), flux = new Float64Array(frames);
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float64Array(N / 2);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let i = 0; i < N; i++) { const x = mono[f * hop + i]; e += x * x; re[i] = x * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let fl = 0;
    for (let k = 1; k < N / 2; k++) { mag[k] = Math.log1p(10 * Math.hypot(re[k], im[k])); fl += Math.max(0, mag[k] - prev[k]); }
    flux[f] = fl; prev = mag;
  }
  const meanRms = rms.reduce((x, y) => x + y, 0) / frames;
  if (meanRms < 0.003) return NO_AUDIO;
  // low-energy ratio: speech has many short pauses, music is continuous
  const win = Math.round(fps);
  let ler = 0, wins = 0;
  for (let s0 = 0; s0 + win <= frames; s0 += win) {
    let m = 0; for (let f = s0; f < s0 + win; f++) m += rms[f]; m /= win;
    let low = 0; for (let f = s0; f < s0 + win; f++) if (rms[f] < 0.5 * m) low++;
    ler += low / win; wins++;
  }
  ler /= Math.max(1, wins);
  // onset envelope → tempo by autocorrelation
  const avgW = Math.round(fps * 0.5);
  const env = Array.from(flux, (x, i) => {
    let m = 0, c = 0; for (let k = Math.max(0, i - avgW); k < Math.min(frames, i + avgW); k++) { m += flux[k]; c++; }
    return Math.max(0, x - m / c);
  });
  let best = 0, bestLag = 0;
  const r0 = env.reduce((x, y) => x + y * y, 0) || 1;
  for (let bpm = 70; bpm <= 180; bpm++) {
    const lag = Math.round((fps * 60) / bpm);
    let r = 0; for (let i = lag; i < env.length; i++) r += env[i] * env[i - lag];
    r /= r0;
    if (r > best) { best = r; bestLag = lag; }
  }
  const envMean = env.reduce((x, y) => x + y, 0) / env.length;
  const envSd = Math.sqrt(env.reduce((x, y) => x + (y - envMean) ** 2, 0) / env.length);
  const onsets: number[] = [];
  for (let i = 1; i < env.length - 1; i++) if (env[i] > envMean + 1.5 * envSd && env[i] >= env[i - 1] && env[i] >= env[i + 1]) onsets.push(i / fps);
  const music = best > 0.3;
  return {
    has: true, voice: ler > 0.22, music, bpm: music && bestLag ? Math.round((fps * 60) / bestLag) : null,
    beatSync: null, ler, tempoConf: best, onsets,
  };
}

/** Edit style from pacing, camera, audio and transitions — every video gets its own label, not a fixed "car edit". */
function classify(a: Analysis): EditStyle {
  if (a.shots.length === 1) return 'oneshot';
  const share = (f: (x: Shot) => boolean) => a.shots.filter(f).reduce((t, x) => t + x.end - x.start, 0) / a.duration;
  const handheld = share((x) => x.move === 'handheld'), still = share((x) => x.motion < 1.2);
  const avgShot = a.duration / a.shots.length;
  const jump = a.transitions.filter((x) => x.kind === 'jump-cut').length;
  if (a.shots.length >= 3 && still > 0.7) return 'slideshow';
  if (a.audio.voice && avgShot > 3) return 'talking';
  if (a.audio.voice && handheld > 0.3 && (jump >= 1 || avgShot < 3) && a.look.lum > 70) return 'ugc';
  if ((a.slowmo.length && !a.audio.voice) || (a.audio.music && (a.audio.beatSync ?? 0) >= 0.5 && avgShot < 1.5) || (a.audio.music && avgShot < 0.8)) return 'velocity';
  if (avgShot > 2.5 && handheld < 0.4) return 'cinematic';
  return 'montage';
}

// ---------------------------------------------------------------- words
export const STYLE: Record<EditStyle, { vi: string; en: string; finish: string }> = {
  ugc: {
    vi: 'UGC / quảng cáo mạng xã hội',
    en: 'UGC-style social media video ad: authentic smartphone footage, POV and handheld angles, natural light, quick jump cuts, real people reacting and talking to camera, problem → solution storytelling',
    finish: 'Authentic, unpolished smartphone look, natural skin tones, no watermark.',
  },
  talking: {
    vi: 'Nói vào camera / vlog',
    en: 'talking-to-camera vlog: a person speaking directly to the lens, simple framing, few cuts, natural light',
    finish: 'Natural, authentic look, clear face and eye contact, no watermark.',
  },
  velocity: {
    vi: 'Velocity / music edit',
    en: 'high-energy music-video edit: hard cuts on the beat, speed ramps, dynamic camera, punchy grade',
    finish: 'Photoreal, sharp detail, strong motion blur on fast moves, no watermark.',
  },
  cinematic: {
    vi: 'Điện ảnh / quảng cáo',
    en: 'polished cinematic commercial: smooth stabilized camera moves, longer shots, controlled lighting',
    finish: 'Photoreal, sharp detail, shallow depth of field, premium grade, no watermark.',
  },
  montage: {
    vi: 'Montage cắt nhanh',
    en: 'fast-paced social media montage with quick cuts',
    finish: 'Photoreal, consistent subject across shots, no watermark.',
  },
  slideshow: {
    vi: 'Slideshow cảnh tĩnh',
    en: 'slideshow of mostly still shots joined by simple cuts',
    finish: 'Clean, sharp images, no watermark.',
  },
  oneshot: {
    vi: 'Một cảnh liền',
    en: 'single continuous shot with no cuts',
    finish: 'Photoreal, sharp detail, no watermark.',
  },
};
const TRANS_EN: Record<TransitionKind, [string, string]> = {
  cut: ['hard cut', 'hard cuts'], 'jump-cut': ['jump cut', 'jump cuts'], flash: ['white flash transition', 'white flash transitions'],
  'fade-black': ['fade through black', 'fades through black'], 'fade-white': ['fade through white', 'fades through white'],
  dissolve: ['cross-dissolve', 'cross-dissolves'], whip: ['whip-pan transition', 'whip-pan transitions'],
};
export const TRANS_VI: Record<TransitionKind, string> = {
  cut: 'Cắt thẳng', 'jump-cut': 'Jump cut', flash: 'Flash trắng', 'fade-black': 'Fade đen', 'fade-white': 'Fade trắng', dissolve: 'Hoà cảnh', whip: 'Whip pan',
};
const EFFECT_EN: Record<Effect, string> = {
  shake: 'camera shake', freeze: 'freeze frame', letterbox: 'cinematic black letterbox bars', flash: 'white flash frames on the cuts',
  'jump-cuts': 'jump cuts inside the same scene', 'speed-ramp': 'speed ramp',
};
const EFFECT_VI: Record<Effect, string> = {
  shake: 'Rung máy', freeze: 'Đứng hình', letterbox: 'Viền đen điện ảnh', flash: 'Flash', 'jump-cuts': 'Jump cut', 'speed-ramp': 'Speed ramp',
};

export function colorName(h: string) {
  const r = parseInt(h.slice(1, 3), 16) / 255, g = parseInt(h.slice(3, 5), 16) / 255, b = parseInt(h.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  if (l < 0.1) return 'black';
  if (s < 0.15) return l > 0.85 ? 'white' : l > 0.55 ? 'silver' : l > 0.25 ? 'gray' : 'charcoal';
  let hue = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  hue = (hue * 60 + 360) % 360;
  const name = hue < 15 ? 'red' : hue < 40 ? (l < 0.4 ? 'brown' : 'orange') : hue < 60 ? 'amber' : hue < 75 ? 'yellow' : hue < 160 ? 'green' : hue < 190 ? 'teal' : hue < 205 ? 'cyan' : hue < 255 ? 'blue' : hue < 290 ? 'purple' : hue < 335 ? 'magenta' : 'red';
  return (l < 0.3 ? 'deep ' : l > 0.75 ? 'pale ' : '') + name;
}

const moveEn = (m: CameraMove, style: EditStyle) => ({
  static: 'locked-off static camera', 'pan-left': 'camera pans left following the action', 'pan-right': 'camera pans right following the action',
  'tilt-up': 'camera tilts up', 'tilt-down': 'camera tilts down', 'zoom-in': 'push-in / zoom toward the subject',
  'zoom-out': 'pull-back / zoom out revealing the scene',
  handheld: style === 'ugc' || style === 'talking' ? 'handheld smartphone camera' : 'energetic handheld camera',
} as Record<CameraMove, string>)[m];
export const MOVE_VI: Record<CameraMove, string> = {
  static: 'Máy đứng yên', 'pan-left': 'Lia trái', 'pan-right': 'Lia phải', 'tilt-up': 'Ngước lên', 'tilt-down': 'Chúc xuống',
  'zoom-in': 'Zoom / đẩy vào', 'zoom-out': 'Zoom ra / lùi', handheld: 'Cầm tay',
};
export const motionLevel = (m: number) => (m < 1.2 ? 'tĩnh' : m < 3 ? 'chậm' : m < 6 ? 'vừa' : 'nhanh');
const motionEn = (m: number) => (m < 1.2 ? 'almost still' : m < 3 ? 'gentle on-screen motion' : m < 6 ? 'moderate on-screen action' : 'fast on-screen action with motion blur');
const fmtS = (s: number) => s.toFixed(1) + 's';
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

export function lookWords(a: Analysis) {
  const { lum, contrast, sat, warmth } = a.look, w: string[] = [];
  w.push(lum < 70 ? 'night / low-key lighting, deep shadows' : lum > 165 ? 'bright high-key lighting' : 'natural daylight');
  if (sat > 0.45 && lum < 120) w.push('saturated neon accents');
  else if (sat < 0.15) w.push('desaturated, almost monochrome grade');
  if (warmth > 0.08) w.push('warm golden / orange tones');
  else if (warmth < -0.05) w.push('cool blue tones');
  if (contrast > 62) w.push('high contrast');
  else if (contrast < 35) w.push('soft low contrast');
  return w;
}
/** Beat estimate: the music tempo when there is music, otherwise the cut rhythm folded into 80–160 BPM. */
export function bpmGuess(a: Analysis) {
  if (a.audio.music && a.audio.bpm) return a.audio.bpm;
  if (a.audio.voice || a.cuts.length < 3) return null; // cut rhythm only means a tempo when cutting to music
  const gaps = a.cuts.slice(1).map((c, i) => c - a.cuts[i]);
  let bpm = 60 / median(gaps);
  while (bpm < 80) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return Math.round(bpm);
}
export function audioVi(a: Analysis) {
  const x = a.audio;
  if (!x.has) return 'Không tiếng';
  if (x.voice && x.music) return 'Lời + nhạc';
  if (x.voice) return 'Lời thoại';
  if (x.music) return x.bpm ? `Nhạc ~${x.bpm} BPM` : 'Nhạc';
  return 'Âm thanh nền';
}
export function tagsVi(a: Analysis) {
  const { lum, sat, warmth, contrast } = a.look, t: string[] = [];
  t.push(lum < 70 ? 'Tối / ban đêm' : lum > 165 ? 'Sáng' : 'Ánh sáng tự nhiên');
  if (sat > 0.45 && lum < 120) t.push('Neon');
  if (warmth > 0.08) t.push('Tông ấm'); else if (warmth < -0.05) t.push('Tông lạnh');
  if (contrast > 62) t.push('Tương phản cao');
  const avg = a.duration / a.shots.length;
  if (a.shots.length > 1) t.push(avg < 1 ? 'Cắt rất nhanh' : avg < 3 ? 'Cắt nhanh' : 'Cảnh dài');
  if (a.audio.music && a.audio.beatSync !== null && a.audio.beatSync >= 0.5) t.push('Cắt khớp beat');
  for (const e of a.effects) if (!t.includes(EFFECT_VI[e])) t.push(EFFECT_VI[e]);
  return t;
}
function dominantMove(a: Analysis): CameraMove {
  const score = new Map<CameraMove, number>();
  for (const s of a.shots) score.set(s.move, (score.get(s.move) || 0) + (s.end - s.start));
  return [...score.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || 'static';
}
function transitionSummary(a: Analysis) {
  const count = new Map<TransitionKind, number>();
  for (const tr of a.transitions) count.set(tr.kind, (count.get(tr.kind) || 0) + 1);
  return [...count.entries()].sort((x, y) => y[1] - x[1]).map(([k, c]) => `${c} ${TRANS_EN[k][c > 1 ? 1 : 0]}`).join(', ');
}
function audioEn(a: Analysis) {
  const x = a.audio, bpm = x.bpm ? ` (~${x.bpm} BPM)` : '';
  if (!x.has) return 'Audio: none (silent).';
  if (x.voice && x.music) return `Audio: spoken dialogue / voiceover over a background music track${bpm}.`;
  if (x.voice) return 'Audio: spoken dialogue / voiceover, no strong music beat.';
  if (x.music) return `Audio: music track${bpm}${x.beatSync !== null && x.beatSync >= 0.5 ? ', cuts land on the beat' : ''}.`;
  return 'Audio: ambient sound.';
}

/** One self-contained prompt carrying every measured input, worded for the style this particular video has. */
export function buildPrompts(a: Analysis, subject: string) {
  const subj = subject.trim();
  const who = subj || 'the main subject';
  const st = STYLE[a.style];
  const frame = a.aspect === '9:16' ? 'vertical 9:16' : a.aspect === '1:1' ? 'square 1:1' : 'widescreen 16:9';
  const palette = a.palette.slice(0, 5).map((c) => `${colorName(c)} ${c}`).join(', ');
  const avgMotion = a.points.reduce((x, p) => x + p.motion, 0) / a.points.length;
  const multi = a.shots.length > 1;
  const fx = a.effects.filter((e) => e !== 'speed-ramp' && e !== 'jump-cuts').map((e) => EFFECT_EN[e]);
  const prompt = [
    `${cap(st.en)}${subj ? `, featuring ${subj}` : ''}.`,
    `Format: ${frame}, ${fmtS(a.duration)} long, ${multi ? `${a.shots.length} shots (about ${fmtS(a.duration / a.shots.length)} each); transitions: ${transitionSummary(a)}` : 'one continuous shot'}.`,
    audioEn(a),
    `Look: ${lookWords(a).join(', ')}. Color palette: ${palette}.`,
    `Camera and pace: mostly ${moveEn(dominantMove(a), a.style)}; overall ${motionEn(avgMotion)}.`,
    a.slowmo.length
      ? `Speed: ${a.slowmo.map(([x, y]) => `real time, then slow motion (about 0.2x) from ${fmtS(x)} to ${fmtS(y)}, then back to fast speed`).join('; ')}.`
      : 'Speed: real time, no slow motion.',
    fx.length ? `Effects: ${fx.join(', ')}.` : '',
    multi ? 'Shot list:' : '',
    ...(multi ? a.shots.slice(0, 15).map((sh, i) => {
      const slow = a.slowmo.find(([x, y]) => x < sh.end && y > sh.start);
      const light = sh.lum < 70 ? 'dark scene' : sh.lum > 165 ? 'bright scene' : 'natural light';
      const enter = sh.enter && sh.enter !== 'cut' ? ` [${TRANS_EN[sh.enter][0]} in]` : '';
      return `${i + 1}. ${fmtS(sh.start)}–${fmtS(sh.end)}${enter}: ${who}, ${moveEn(sh.move, a.style)}, ${motionEn(sh.motion)}, ${light}${slow ? `, slow motion ${fmtS(slow[0])}–${fmtS(slow[1])}` : ''}.`;
    }) : []),
    st.finish,
  ].filter(Boolean).join('\n');

  const meta = `I'm attaching a short video (or keyframes from it). Analyze it and write ONE detailed English text-to-video prompt that recreates the same video: its type/genre and story, what happens in every shot with timestamps (people, objects, actions, setting), camera angle and movement, transitions, speed changes, effects, on-screen text, audio (dialogue, voiceover, music) and color grade.${subj ? ` Replace the main subject with: ${subj}.` : ''}

Measurements from my analyzer, use them as hints:
- Edit style: ${st.en}.
- ${a.duration.toFixed(1)}s, ${a.aspect}, ${a.shots.length} shots; transitions at ${a.transitions.length ? a.transitions.map((x) => `${fmtS(x.t)} ${x.kind}`).join(', ') : 'none'}.
- Camera per shot: ${a.shots.slice(0, 15).map((x, i) => `#${i + 1} ${x.move}`).join(', ')}.
- ${audioEn(a)}
- Slow motion: ${a.slowmo.length ? a.slowmo.map(([x, y]) => `${fmtS(x)}–${fmtS(y)}`).join(', ') : 'none detected'}. Effects: ${a.effects.map((e) => EFFECT_EN[e]).join(', ') || 'none detected'}.
- Look: ${lookWords(a).join(', ')}; palette ${a.palette.join(' ')}.`;
  return { prompt, meta };
}

/** Library templates whose prompt shares the most look/motion words with the analysis. */
export function similarTemplates(a: Analysis, n = 3): CarTemplate[] {
  const words: [string, number][] = [];
  const { lum, sat, warmth } = a.look, mv = dominantMove(a);
  if (a.slowmo.length) words.push(['speed ramp', 4], ['slow motion', 2]);
  if (lum < 70) words.push(['night', 2], ['dark', 1]);
  if (lum > 165) words.push(['bright', 2], ['white', 1], ['snow', 1]);
  if (sat > 0.45 && lum < 120) words.push(['neon', 3], ['cyan', 1], ['magenta', 1]);
  if (warmth > 0.08) words.push(['golden', 2], ['sunset', 2], ['orange', 1], ['desert', 1]);
  if (warmth < -0.05) words.push(['blue', 1], ['cold', 1]);
  if (mv === 'zoom-in') words.push(['zoom', 3], ['push-in', 2]);
  if (mv === 'pan-left' || mv === 'pan-right') words.push(['tracking', 2], ['pans', 2], ['orbit', 1]);
  if (mv === 'tilt-down' || mv === 'tilt-up') words.push(['drone', 2], ['dive', 2]);
  if (mv === 'handheld') words.push(['shake', 2], ['fpv', 1]);
  if (a.shots.length > 4) words.push(['music-video', 2], ['edit', 1]);
  if (a.style === 'ugc' || a.style === 'talking' || a.style === 'slideshow') return [];
  return TEMPLATES.map((t) => {
    const text = (t.prompt + ' ' + t.tags.join(' ')).toLowerCase();
    return { t, s: words.reduce((x, [w, k]) => x + (text.includes(w) ? k : 0), 0) };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.t);
}

/** One PNG with the keyframes and their timestamps, for chatbots that take images but not video. */
export async function contactSheet(a: Analysis): Promise<Blob> {
  const imgs = await Promise.all(a.keyframes.map((k) => new Promise<HTMLImageElement>((res) => { const i = new Image(); i.onload = () => res(i); i.src = k.url; })));
  const cols = Math.min(3, imgs.length), rows = Math.ceil(imgs.length / cols), w = imgs[0].width, h = imgs[0].height, pad = 8;
  const c = document.createElement('canvas'); c.width = cols * (w + pad) + pad; c.height = rows * (h + pad) + pad;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  g.font = '600 16px -apple-system, Inter, sans-serif';
  imgs.forEach((im, i) => {
    const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + pad);
    g.drawImage(im, x, y);
    const label = `#${i + 1} · ${fmtS(a.keyframes[i].t)}`;
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x + 6, y + 6, g.measureText(label).width + 12, 24);
    g.fillStyle = '#fff'; g.fillText(label, x + 12, y + 24);
  });
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
