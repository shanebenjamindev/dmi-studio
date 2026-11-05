// Outro from a logo: the client's logo on a background the size of the project's frame, easing in, with a light
// sweeping across it, rendered to an MP4 that goes at the end of the timeline like any clip (and into the CapCut
// export). Nothing here calls an AI service:
//   • Background removal: a logo that is already transparent is kept as it is; a logo on a plain background has that
//     background keyed out from the picture's edges inward (soft edges, the background's tint taken out of them);
//     anything else is cut out with macOS Vision's subject mask (outro/fgmask.swift, compiled once), else kept.
//   • Fit: the logo is scaled to fit inside a safe box of the frame (never cropped) and the background always fills the
//     whole frame: by default a gradient in the logo's colours (the colour it stood on, if that was a colour; else its
//     main colour, pale behind a dark logo and deep behind a light one), or black, white or a chosen colour, or, for a
//     logo kept with its background, that picture enlarged and blurred behind it (a plain "expand", not generative fill).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Router, HttpError, json, readBody, readJson, sendFile } from './http';
import { DATA_DIR, FFMPEG } from './config';
import { get } from './db';

const DIR = path.join(DATA_DIR, 'outro');
const FPS = 30;
/** Frame size per aspect, the same as the CapCut export's canvas. */
export const FRAME: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };
// The largest logo box per frame shape, as fractions of the frame's width and height ("Lớn"); "Vừa" and "Nhỏ" shrink it.
const BOX: Record<string, [number, number]> = { '9:16': [0.7, 0.28], '16:9': [0.48, 0.46], '1:1': [0.62, 0.42] };
const SIZE = { S: 0.7, M: 0.85, L: 1 };
const IN = 0.6, SWEEP: [number, number] = [0.75, 1.75]; // seconds: logo eases in, then the light crosses it

export type Opts = { dur: number; bg: string; removeBg: boolean; holes: boolean; shine: boolean; size: 'S' | 'M' | 'L' };
export function checkOpts(o: any): Opts {
  const x = o && typeof o === 'object' ? o : {};
  return {
    dur: Math.min(8, Math.max(1.5, Math.round((Number(x.dur) || 3) * 10) / 10)),
    bg: /^(auto|black|white|#[0-9a-f]{6})$/i.test(String(x.bg)) ? String(x.bg).toLowerCase() : 'auto',
    removeBg: x.removeBg !== false, holes: !!x.holes, shine: x.shine !== false,
    size: x.size === 'S' || x.size === 'L' ? x.size : 'M',
  };
}

type Img = { w: number; h: number; d: Buffer }; // RGBA, 8 bits per channel, not premultiplied
type RGB = [number, number, number];

function ffmpeg(args: string[], input?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (b) => out.push(b));
    p.stderr.on('data', (b) => (err += b));
    p.stdin.on('error', () => {});
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg lỗi'))));
    p.stdin.end(input);
  });
}

/** Any picture ffmpeg reads (PNG, JPEG, WebP, GIF) as RGBA, its longest side at most `max` px. */
async function decode(file: string, max = 1600): Promise<Img> {
  const buf = await ffmpeg(['-i', file, '-frames:v', '1', '-vf', `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease`, '-f', 'image2pipe', '-c:v', 'pam', '-pix_fmt', 'rgba', '-']);
  const end = buf.indexOf('ENDHDR\n');
  const head = buf.subarray(0, Math.max(0, end)).toString('latin1');
  const w = Number(head.match(/WIDTH (\d+)/)?.[1]), h = Number(head.match(/HEIGHT (\d+)/)?.[1]);
  if (end < 0 || !w || !h) throw new HttpError(400, 'Không đọc được file ảnh logo');
  return { w, h, d: Buffer.from(buf.subarray(end + 7, end + 7 + w * h * 4)) };
}
/** RGBA pixels to a picture file (PNG or JPEG by its name); `extra`: more ffmpeg output options. */
const encode = (img: Img, out: string, extra: string[] = []) =>
  ffmpeg(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${img.w}x${img.h}`, '-i', '-', ...extra, '-frames:v', '1', out], img.d);

const dist = (d: Buffer, o: number, c: RGB) => Math.hypot(d[o] - c[0], d[o + 1] - c[1], d[o + 2] - c[2]);
const lum = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
type HSL = [number, number, number]; // hue 0–360, saturation and lightness 0–1
function toHsl([r, g, b]: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l];
}
function fromHsl([h, s, l]: HSL): RGB {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = (((h % 360) + 360) % 360) / 360;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map((v) => Math.round(v * 255)) as RGB;
}
/** A colour that reads as a colour (not black, white or grey). */
const colourful = (c: RGB | null) => { if (!c) return false; const [, s, l] = toHsl(c); return s >= 0.2 && l > 0.1 && l < 0.92; };
/** The far end of a gradient that starts at `c`: darker (a little less for very light colours), hue turned slightly. */
const deeper = (c: RGB) => { const [h, s, l] = toHsl(c); return fromHsl([h + 8, s, l > 0.85 ? l - 0.14 : l * 0.42]); };

/**
 * The logo's colours, most present first: hue groups of its coloured pixels (black, white and greys left out), plus
 * the colour it stood on (`extra`), weighted like a quarter of the logo.
 */
function palette(img: Img, extra: RGB | null) {
  const bins = Array.from({ length: 24 }, () => [0, 0, 0, 0]); // weight, r, g, b (15° of hue each)
  let n = 0;
  const add = (c: RGB, wt: number) => {
    const [h, s, l] = toHsl(c);
    if (s < 0.25 || l < 0.12 || l > 0.9) return;
    const bin = bins[Math.floor(h / 15) % 24], w = wt * s;
    bin[0] += w; bin[1] += c[0] * w; bin[2] += c[1] * w; bin[3] += c[2] * w;
  };
  for (let i = 0; i < img.d.length; i += 8) if (img.d[i + 3] > 128) { add([img.d[i], img.d[i + 1], img.d[i + 2]], 1); n++; }
  if (extra) add(extra, n * 0.25);
  const out: RGB[] = [], taken: number[] = [];
  for (const k of bins.map((_, k) => k).sort((a, b) => bins[b][0] - bins[a][0])) {
    const w = bins[k][0];
    if (w < n * 0.015 || out.length === 4) break;
    if (taken.some((t) => Math.min(Math.abs(t - k), 24 - Math.abs(t - k)) < 2)) continue; // within 30° of one already taken
    taken.push(k);
    out.push([bins[k][1] / w, bins[k][2] / w, bins[k][3] / w].map(Math.round) as RGB);
  }
  return out;
}

/** The picture's border: the share of it that is transparent, and its colour when it is (nearly) one colour. */
function border(img: Img) {
  const { w, h, d } = img;
  const px: number[] = [];
  for (let x = 0; x < w; x++) px.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) px.push(y * w, y * w + w - 1);
  const clear = px.filter((p) => d[p * 4 + 3] < 16).length / px.length;
  const solid = px.filter((p) => d[p * 4 + 3] > 240);
  if (solid.length < px.length * 0.5) return { clear, color: null };
  const med = (k: number) => { const v = solid.map((p) => d[p * 4 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const c: RGB = [med(0), med(1), med(2)];
  return { clear, color: solid.filter((p) => dist(d, p * 4, c) < 30).length / solid.length > 0.9 ? c : null };
}

/** The largest value of `v` within `r` pixels (a square) of each pixel. */
function spread<T extends Float32Array | Uint8Array>(v: T, w: number, h: number, r: number): T {
  const tmp = new (v.constructor as any)(v.length) as T, out = new (v.constructor as any)(v.length) as T;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) if (v[y * w + k] > m) m = v[y * w + k];
    tmp[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
    out[y * w + x] = m;
  }
  return out;
}

/**
 * Key out a plain background of colour `bg`: the pixels close to it that reach the picture's edge through other such
 * pixels (with `holes`, all of them, also those enclosed by the logo like the inside of an O). Pixels on the logo's
 * edge get the alpha of their mix between the background and the strongest logo colour nearby, and the background's
 * tint is taken out of them, so there is no light or dark fringe on another background.
 */
function keyOut(img: Img, bg: RGB, holes: boolean) {
  const { w, h, d } = img, n = w * h, T = 48;
  const dd = new Float32Array(n);
  for (let i = 0; i < n; i++) dd[i] = dist(d, i * 4, bg);
  const reg = new Uint8Array(n);
  if (holes) for (let i = 0; i < n; i++) reg[i] = dd[i] < T ? 1 : 0;
  else {
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    const add = (i: number) => { if (!reg[i] && dd[i] < T) { reg[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
    while (qh < qt) {
      const i = q[qh++], x = i % w;
      if (x > 0) add(i - 1);
      if (x < w - 1) add(i + 1);
      if (i >= w) add(i - w);
      if (i < n - w) add(i + w);
    }
  }
  const far = spread(dd, w, h, 3), near = spread(reg, w, h, 2);
  for (let i = 0; i < n; i++) {
    if (!near[i]) continue;
    let a = far[i] < 64 || dd[i] < 12 ? 0 : Math.min(1, dd[i] / far[i]);
    if (!reg[i] && a > 0.9) continue; // the logo itself, next to the background
    const o = i * 4;
    a = Math.min(a, d[o + 3] / 255);
    if (a > 0 && a < 1) for (let k = 0; k < 3; k++) d[o + k] = Math.max(0, Math.min(255, Math.round(bg[k] + (d[o + k] - bg[k]) / a)));
    d[o + 3] = Math.round(a * 255);
  }
}

/** The logo's bounding box (alpha above 8) with a 2 px margin. */
function trim(img: Img): Img {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.d[(y * img.w + x) * 4 + 3] <= 8) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new HttpError(400, 'Logo trống sau khi xoá nền. Thử tắt “Xoá nền logo”.');
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(img.w - 1, x1 + 2); y1 = Math.min(img.h - 1, y1 + 2);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) img.d.copy(d, y * w * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x1 + 1) * 4);
  return { w, h, d };
}

/** Resample to w×h on premultiplied colour (no fringes from transparent pixels), averaging when shrinking. */
function resize(img: Img, w: number, h: number): Img {
  const W = img.w, H = img.h, s = img.d, sx = W / w, sy = H / h;
  const tx = Math.max(1, Math.ceil(sx)), ty = Math.max(1, Math.ceil(sy)), taps = tx * ty;
  const d = Buffer.alloc(w * h * 4), acc = new Float64Array(4);
  const add = (px: number, py: number, wt: number) => {
    const o = (py * W + px) * 4, al = s[o + 3] * wt;
    acc[0] += s[o] * al; acc[1] += s[o + 1] * al; acc[2] += s[o + 2] * al; acc[3] += al;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    acc.fill(0);
    for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
      const fx = Math.min(W - 1, Math.max(0, (x + (i + 0.5) / tx) * sx - 0.5)), fy = Math.min(H - 1, Math.max(0, (y + (j + 0.5) / ty) * sy - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      add(x0, y0, (1 - ax) * (1 - ay)); add(x1, y0, ax * (1 - ay)); add(x0, y1, (1 - ax) * ay); add(x1, y1, ax * ay);
    }
    const o = (y * w + x) * 4, a = acc[3];
    if (a > 0) { d[o] = acc[0] / a + 0.5; d[o + 1] = acc[1] / a + 0.5; d[o + 2] = acc[2] / a + 0.5; }
    d[o + 3] = a / taps + 0.5;
  }
  return { w, h, d };
}

/** Fade the picture's border out over `r` px (in place), so it blends into the background around it. */
function feather(img: Img, r: number) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const e = Math.min(x, y, img.w - 1 - x, img.h - 1 - y);
    if (e >= r) continue;
    const t = (e + 0.5) / r, o = (y * img.w + x) * 4;
    img.d[o + 3] = img.d[o + 3] * t * t * (3 - 2 * t);
  }
  return img;
}

/** `img` with `p` transparent pixels around it (room for the glow). */
function pad(img: Img, p: number): Img {
  const w = img.w + 2 * p, h = img.h + 2 * p, d = Buffer.alloc(w * h * 4);
  for (let y = 0; y < img.h; y++) img.d.copy(d, ((y + p) * w + p) * 4, y * img.w * 4, (y + 1) * img.w * 4);
  return { w, h, d };
}

/** Where the light spills just outside the logo's edges: its alpha blurred, minus the logo itself (0–1). */
function halo(img: Img, r: number) {
  const { w, h, d } = img, n = w * h;
  let a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3] / 255;
  for (let pass = 0; pass < 3; pass++) { // three box blurs ≈ a Gaussian
    const t = new Float32Array(n), o = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) { s += a[y * w + k]; c++; } t[y * w + x] = s / c; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) { s += t[k * w + x]; c++; } o[y * w + x] = s / c; }
    a = o;
  }
  for (let i = 0; i < n; i++) a[i] = Math.max(0, Math.min(1, a[i] * 1.6 - d[i * 4 + 3] / 255));
  return a;
}

/** The light band's strength at each logo pixel when it is `p` (0→1) of the way across: tilted, soft, bright core. */
function sweep(img: Img, p: number) {
  const tilt = Math.tan(Math.PI / 9), span = img.w + img.h * tilt, sigma = Math.max(14, img.w * 0.07);
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  const c = -3 * sigma + e * (span + 6 * sigma);
  return (x: number, y: number) => { const z = (x + (img.h - y) * tilt - c) / sigma, z2 = z * z; return 0.55 * Math.exp(-z2) + 0.3 * Math.exp(-z2 * 9); };
}

/** Draw `logo` over the frame at (ox, oy) with opacity `op`; `light` lights the logo and, through `glow`, its rim. */
function over(frame: Buffer, W: number, H: number, logo: Img, ox: number, oy: number, op: number, light?: (x: number, y: number) => number, glow?: Float32Array) {
  const s = logo.d;
  for (let y = 0; y < logo.h; y++) {
    const fy = oy + y;
    if (fy < 0 || fy >= H) continue;
    for (let x = 0; x < logo.w; x++) {
      const fx = ox + x;
      if (fx < 0 || fx >= W) continue;
      const i = y * logo.w + x, o = i * 4, f = (fy * W + fx) * 4, a = (s[o + 3] / 255) * op;
      const l = light ? light(x, y) : 0;
      if (a <= 0 && !(l > 0.01 && glow && glow[i] > 0)) continue;
      let br = frame[f], bg = frame[f + 1], bb = frame[f + 2];
      if (l > 0 && glow) { const k = l * glow[i] * 0.7; br += (255 - br) * k; bg += (255 - bg) * k; bb += (255 - bb) * k; }
      let r = s[o], g = s[o + 1], b = s[o + 2];
      if (l > 0) { r += (255 - r) * l; g += (255 - g) * l; b += (255 - b) * l; }
      frame[f] = br + (r - br) * a + 0.5; frame[f + 1] = bg + (g - bg) * a + 0.5; frame[f + 2] = bb + (b - bb) * a + 0.5;
    }
  }
}

/**
 * The frame's background: `a` behind the logo in the middle, turning into `b` toward the edges and more so toward the
 * bottom, dithered against banding in the video.
 */
function gradient(W: number, H: number, a: RGB, b: RGB) {
  const d = Buffer.alloc(W * H * 4);
  let seed = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / Math.SQRT2;
    const t = Math.min(1, 0.8 * r + 0.4 * Math.max(0, (2 * y) / H - 1)), e = t * t * (3 - 2 * t), o = (y * W + x) * 4;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed / 0x7fffffff - 0.5) * 1.5;
    for (let k = 0; k < 3; k++) d[o + k] = Math.max(0, Math.min(255, a[k] + (b[k] - a[k]) * e + n + 0.5));
    d[o + 3] = 255;
  }
  return d;
}

/** The picture enlarged to cover the frame and blurred: the background for a logo kept with its own background. */
async function expand(file: string, W: number, H: number) {
  return ffmpeg(['-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${Math.round(W / 18)},eq=brightness=-0.05`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
}

let tool: Promise<string | null> | null = null;
/** macOS Vision's subject cut-out as a small program, built once with the Swift compiler; null when unavailable. */
function vision() {
  return (tool ??= (async () => {
    if (process.platform !== 'darwin') return null;
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), 'outro', 'fgmask.swift');
    const bin = path.join(DATA_DIR, 'bin', 'fgmask');
    if (fs.existsSync(bin) && fs.statSync(bin).mtimeMs >= fs.statSync(src).mtimeMs) return bin;
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    return new Promise<string | null>((resolve) => execFile('swiftc', ['-O', src, '-o', bin], { timeout: 300e3 }, (e) => resolve(e ? null : bin)));
  })());
}
async function visionCut(file: string, out: string) {
  const bin = await vision();
  if (!bin) return null;
  return new Promise<string | null>((resolve) => execFile(bin, [file, out], { timeout: 60e3 }, (e) => resolve(!e && fs.existsSync(out) ? out : null)));
}

/** Write the RGBA frames `frame(0…n-1)` to an H.264 MP4 (BT.709, like camera footage, so colours match in CapCut). */
async function video(out: string, W: number, H: number, n: number, frame: (f: number) => Buffer) {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '', closed = false;
  p.stderr.on('data', (b) => (err += b));
  p.stdin.on('error', () => (closed = true));
  const done = new Promise<void>((resolve, reject) => { p.on('error', reject); p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'ffmpeg lỗi')))); });
  for (let f = 0; f < n && !closed; f++) if (!p.stdin.write(frame(f))) await new Promise((r) => p.stdin.once('drain', r));
  p.stdin.end();
  await done;
}

export type Removed = 'alpha' | 'key' | 'vision' | 'none';

/** Make the outro for project `id` from its uploaded logo; returns what to put on the timeline and show. */
async function render(id: string, aspect: string, o: Opts) {
  const dir = path.join(DIR, id);
  const src = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith('source.'));
  if (!src) throw new HttpError(400, 'Chưa có logo. Hãy nhập logo trước.');
  const file = path.join(dir, src);
  const pic = await decode(file);
  const edge = border(pic);
  let removed: Removed = 'none', logo = pic, keyed: RGB | null = null;
  if (o.removeBg) {
    if (edge.clear > 0.5) removed = 'alpha';
    else if (edge.color) { keyOut(pic, edge.color, o.holes); removed = 'key'; keyed = edge.color; }
    else {
      const cut = await visionCut(file, path.join(dir, 'vision.png'));
      if (cut) { logo = await decode(cut); removed = 'vision'; }
    }
  }
  logo = trim(logo);
  const stamp = Date.now().toString(36);
  await encode(logo, path.join(dir, 'logo.png'));

  // A picture kept with its own background, on the automatic background, is "expanded": it fits the whole frame (not
  // the logo box), its border fades into a blurred enlargement of itself around it.
  const extend = o.bg === 'auto' && removed === 'none' && edge.clear <= 0.5;
  const [W, H] = FRAME[aspect] || FRAME['9:16'], [bw, bh] = extend ? [1, 1] : BOX[aspect] || BOX['9:16'];
  const k = Math.min((bw * W * SIZE[o.size]) / logo.w, (bh * H * SIZE[o.size]) / logo.h);
  const G = Math.max(6, Math.round(Math.min(W, H) * 0.012)); // glow room around the logo
  const sized = resize(logo, Math.max(2, Math.round(logo.w * k)), Math.max(2, Math.round(logo.h * k)));
  const fit = pad(extend ? feather(sized, Math.round(Math.min(sized.w, sized.h) * 0.06)) : sized, G);
  let ink = 0, cover = 0; // the logo's mean lightness, to pick a contrasting background
  for (let i = 0; i < fit.d.length; i += 4) { const a = fit.d[i + 3] / 255; ink += lum([fit.d[i], fit.d[i + 1], fit.d[i + 2]]) * a; cover += a; }
  ink = cover ? ink / cover : 0.5;

  // The gradient behind the logo, `under` in the middle to `rim` (no `under`: the expanded picture).
  const pal = palette(fit, removed === 'key' ? keyed : null), dark = ink < 0.45, black: RGB = [30, 30, 34], white: RGB = [255, 255, 255];
  let under: RGB | null = null, rim: RGB = [0, 0, 0], bg: string;
  if (o.bg === 'black') { under = black; rim = [5, 5, 7]; bg = 'black'; }
  else if (o.bg === 'white') { under = white; rim = [228, 228, 232]; bg = 'white'; }
  else if (o.bg.startsWith('#')) { under = hex(o.bg); rim = deeper(under); bg = o.bg; }
  else if (extend) bg = 'expand';
  else if (removed === 'key' && colourful(keyed)) { under = keyed; rim = deeper(keyed!); bg = 'logo-bg'; } // the colour the logo stood on
  else if (pal.length) { // the logo's main colour: pale behind a dark logo, deep behind a light one
    const [h, s] = toHsl(pal[0]);
    [under, rim] = dark ? [fromHsl([h, Math.min(s, 0.6), 0.96]), fromHsl([h - 8, Math.min(s, 0.5), 0.84])] : [fromHsl([h, Math.min(s, 0.75), 0.24]), fromHsl([h + 12, Math.min(s, 0.8), 0.06])];
    bg = 'logo';
  } else if (dark) { under = white; rim = [228, 228, 232]; bg = 'white'; }
  else { under = black; rim = [5, 5, 7]; bg = 'black'; }
  const back = under ? gradient(W, H, under, rim) : await expand(file, W, H);
  const faint = !!under && Math.abs(lum(under) - ink) < 0.2; // a dark logo on a dark background, or light on light

  const glow = o.shine && !extend ? halo(fit, Math.max(3, Math.round(G / 2))) : undefined;
  const ox = Math.round((W - fit.w) / 2), oy = Math.round((H - fit.h) / 2);
  const still = Buffer.from(back);
  over(still, W, H, fit, ox, oy, 1);
  const n = Math.round(o.dur * FPS);
  const out = path.join(dir, `${stamp}.mp4`);
  await video(out, W, H, n, (f) => {
    const t = f / FPS, lit = o.shine && t >= SWEEP[0] && t <= SWEEP[1];
    if (t >= IN && !lit) return still;
    const fr = Buffer.from(back);
    if (t < IN) { // ease in: fade up from 94 % size
      const e = 1 - (1 - t / IN) ** 3, s = 0.94 + 0.06 * e;
      const img = resize(fit, Math.max(2, Math.round(fit.w * s)), Math.max(2, Math.round(fit.h * s)));
      over(fr, W, H, img, Math.round((W - img.w) / 2), Math.round((H - img.h) / 2), e);
    } else over(fr, W, H, fit, ox, oy, 1, sweep(fit, (t - SWEEP[0]) / (SWEEP[1] - SWEEP[0])), glow);
    return fr;
  });
  await ffmpeg(['-y', '-ss', String(Math.min(o.dur - 0.1, SWEEP[1] + 0.3)), '-i', out, '-frames:v', '1', '-vf', 'scale=-2:360', '-q:v', '4', path.join(dir, `${stamp}.jpg`)]);
  // Keep the last few versions (undo on the timeline can bring an older one back).
  const olds = fs.readdirSync(dir).filter((f) => /^[0-9a-z]+\.mp4$/.test(f)).sort((a, b) => parseInt(b, 36) - parseInt(a, 36)).slice(5);
  for (const f of olds) { fs.rmSync(path.join(dir, f), { force: true }); fs.rmSync(path.join(dir, f.replace('.mp4', '.jpg')), { force: true }); }
  return {
    media: { type: 'video', assetId: `outro_${id}_${stamp}`, url: `/api/outro/${id}/${stamp}.mp4?v=1`, mime: 'video/mp4', provider: 'outro', prompt: 'Outro logo', duration: n / FPS },
    logo: `/api/outro/${id}/logo.png?v=${stamp}`, opts: o, aspect, removed, bg, small: Math.max(logo.w, logo.h) < 400, faint, at: Date.now(),
    palette: pal.map(toHex), colors: under ? [toHex(under), toHex(rim)] : [],
  };
}

/** The file on disk behind an outro clip's URL, or null (the CapCut export copies it instead of cutting from Drive). */
export function outroFile(url: string) {
  const m = String(url).match(/^\/api\/outro\/(p_[a-z0-9]+)\/([0-9a-z]+\.mp4)(\?|$)/);
  const file = m && path.join(DIR, m[1], m[2]);
  return file && fs.existsSync(file) ? file : null;
}

const project = async (id: string) => {
  const p = await get<any>('SELECT id, aspect FROM projects WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'Không tìm thấy dự án');
  if (!FFMPEG) throw new HttpError(400, 'Máy chủ chưa có ffmpeg');
  return p;
};
const ID = /^p_[a-z0-9]+$/, FILE = /^(logo\.png|[0-9a-z]+\.(mp4|jpg))$/;

export function registerOutro(api: Router) {
  // A new logo (the request body), made into an outro with `opts` (JSON in the query). The project keeps the result
  // when the editor saves it (the outro and the clip it puts on the timeline), so there is a single writer.
  api.post('/api/projects/:id/outro/logo', async (req, res) => {
    const p = await project(req.params.id);
    const mime = String(req.headers['content-type'] || '').split(';')[0];
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) throw new HttpError(400, 'Logo cần là ảnh PNG, JPG, WebP hoặc GIF');
    const buf = await readBody(req, 30 * 1024 * 1024);
    if (!buf.length) throw new HttpError(400, 'File rỗng');
    let opts: any = {};
    try { opts = JSON.parse(String(req.query.get('opts') || '{}')); } catch { /* defaults */ }
    const dir = path.join(DIR, p.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.startsWith('source.') || f === 'vision.png') fs.rmSync(path.join(dir, f), { force: true });
    fs.writeFileSync(path.join(dir, `source.${mime === 'image/jpeg' ? 'jpg' : mime.slice(6)}`), buf);
    json(res, 200, { outro: await render(p.id, p.aspect, checkOpts(opts)) });
  });
  // The same logo again, with other options or for the project's current frame shape.
  api.post('/api/projects/:id/outro', async (req, res) => {
    const p = await project(req.params.id);
    json(res, 200, { outro: await render(p.id, p.aspect, checkOpts((await readJson(req)).opts)) });
  });
  // The poster frame of an outro clip, for timeline and list thumbnails ("<clip url>/thumb").
  api.get('/api/outro/:project/:file/thumb', async (req, res) => {
    const { project: id, file } = req.params;
    if (!ID.test(id) || !/^[0-9a-z]+\.mp4$/.test(file) || !sendFile(req, res, path.join(DIR, id), file.replace('.mp4', '.jpg'), { cache: 'private, max-age=31536000' })) throw new HttpError(404, 'Không có ảnh');
  });
  api.get('/api/outro/:project/:file', async (req, res) => {
    const { project: id, file } = req.params;
    if (!ID.test(id) || !FILE.test(file) || !sendFile(req, res, path.join(DIR, id), file, { cache: file === 'logo.png' ? 'no-cache' : 'private, max-age=31536000' })) throw new HttpError(404, 'Không có file');
  });
}
