// Local copies of Drive clips for ffmpeg. Letting ffmpeg read a MOV straight from Drive is slow: it issues many small
// range requests and Drive takes ~1 s to answer each (a 7 s cut can take minutes). Instead the bytes are fetched here
// with a few large parallel ranges, then ffmpeg reads a local file.
//   • Small clips (≤ 24 MB) are copied whole and kept in a cache.
//   • Bigger clips get one sparse file each, of their full size, that keeps every byte range fetched so far (listed in
//     a sidecar .json): the container header, the index (moov), and for each cut exactly the bytes from the keyframe
//     before it to just past it, read from the index (mp4index.ts). Offsets are unchanged, so ffmpeg reads it like the
//     original, and later cuts of the same clip (other proxies, CapCut exports) fetch only what is still missing.
//     If a cut from it comes out short or damaged, it is tried again a few seconds wider, then from a whole copy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';
import * as G from './google';
import { readIndex, spanOf, type Track } from './mp4index';

const DIR = path.join(DATA_DIR, 'originals');
const WHOLE_MAX = 24 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;
const PARALLEL = 8;
const CACHE_MAX = 20 * 1024 * 1024 * 1024; // trim the cache past 20 GB (bytes on disk), least recently used first
const MARGIN = 2.5; // seconds around a cut when the index cannot be read and bytes are estimated from the bitrate

const url = (id: string) => `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
const inflight = new Map<string, Promise<string>>();

async function range(account: string, id: string, from: number, to: number) { // [from, to)
  const r = await G.gfetch(account, url(id), { headers: { range: `bytes=${from}-${to - 1}` } });
  if (!r.ok && r.status !== 206) throw new Error(`Google Drive: không tải được video (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Fetch [from, to) ranges into `fd` at their own offsets, in CHUNK pieces, PARALLEL at a time. */
async function fill(account: string, id: string, fd: number, spans: [number, number][]) {
  const pieces: [number, number][] = [];
  for (const [a, b] of spans) for (let o = a; o < b; o += CHUNK) pieces.push([o, Math.min(b, o + CHUNK)]);
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let i = next++; i < pieces.length; i = next++) {
      const [a, b] = pieces[i];
      let buf: Buffer | null = null;
      for (let attempt = 0; attempt < 3 && !buf; attempt++) buf = await range(account, id, a, b).catch((e) => { if (attempt === 2) throw e; return null; });
      fs.writeSync(fd, buf!, 0, buf!.length, a);
    }
  }));
}

type TopBox = { type: string; off: number; size: number; head: number };
/** Top-level MP4/MOV boxes (type, offset, total size, header size), read box header by box header. */
async function boxes(account: string, id: string, size: number) {
  const out: TopBox[] = [];
  let off = 0;
  const first = await range(account, id, 0, Math.min(size, 65536));
  while (off < size && out.length < 32) {
    const h = off + 16 <= first.length ? first.subarray(off, off + 16) : await range(account, id, off, Math.min(size, off + 16));
    if (h.length < 8) break;
    let len = h.readUInt32BE(0), head = 8;
    const type = h.toString('latin1', 4, 8);
    if (len === 1) { len = Number(h.readBigUInt64BE(8)); head = 16; } else if (len === 0) len = size - off;
    if (len < head) break;
    out.push({ type, off, size: len, head });
    off += len;
  }
  return out;
}

// ---------------------------------------------------------------- one sparse file per clip, filled as cuts need it
type Side = { size: number; boxes: TopBox[] | null; have: [number, number][] };
const sparse = (id: string) => path.join(DIR, `${id}.sparse`);
const sideOf = (id: string) => `${sparse(id)}.json`;
function readSide(id: string, size: number): Side {
  try {
    const s = JSON.parse(fs.readFileSync(sideOf(id), 'utf8')) as Side;
    if (s.size === size && fs.existsSync(sparse(id)) && fs.statSync(sparse(id)).size === size) return s;
  } catch { /* none yet */ }
  return { size, boxes: null, have: [] };
}
/** Sorted, merged intervals. */
function merge(list: [number, number][]) {
  const out: [number, number][] = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
/** The parts of `want` not covered by `have` (both merged). */
function missing(have: [number, number][], want: [number, number][]) {
  const out: [number, number][] = [];
  for (const [a0, b] of merge(want)) {
    let a = a0;
    for (const [x, y] of have) {
      if (y <= a || x >= b) continue;
      if (x > a) out.push([a, x]);
      a = Math.max(a, y);
      if (a >= b) break;
    }
    if (a < b) out.push([a, b]);
  }
  return out;
}
// One fetch at a time per clip (two cuts of the same clip share what the first one fetched).
const locks = new Map<string, Promise<unknown>>();
function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) || Promise.resolve()).catch(() => {}).then(fn);
  const tail = run.then(() => {}, () => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}
/** Make sure the clip's sparse file holds `want` (and learn its top-level boxes the first time). */
function ensure(account: string, id: string, size: number, want: (s: Side) => Promise<[number, number][]> | [number, number][]) {
  return locked(id, async () => {
    const side = readSide(id, size);
    if (!side.have.length) { const fd = fs.openSync(sparse(id), 'w'); fs.ftruncateSync(fd, size); fs.closeSync(fd); }
    if (!side.boxes) side.boxes = await boxes(account, id, size);
    const need = missing(side.have, (await want(side)).filter(([a, b]) => b > a));
    if (need.length) {
      const fd = fs.openSync(sparse(id), 'r+');
      try { await fill(account, id, fd, need); } finally { fs.closeSync(fd); }
      side.have = merge([...side.have, ...need]);
    }
    fs.writeFileSync(sideOf(id), JSON.stringify(side));
    const now = new Date();
    fs.utimesSync(sparse(id), now, now);
    return side;
  });
}
const indexes = new Map<string, Track[] | null>(); // "<id>:<size>" (a new revision of the file has another size)
/** The clip's index, read from its sparse file (which then holds the moov box). */
function indexOf(id: string, size: number, moov: TopBox) {
  const key = `${id}:${size}`;
  if (!indexes.has(key)) {
    const fd = fs.openSync(sparse(id), 'r'), buf = Buffer.alloc(moov.size);
    try { fs.readSync(fd, buf, 0, moov.size, moov.off); } finally { fs.closeSync(fd); }
    indexes.set(key, readIndex(buf));
  }
  return indexes.get(key)!;
}

/** Disk use of the cache (sparse files count only their fetched bytes), trimmed least recently used first. */
function trimCache() {
  try {
    const files = fs.readdirSync(DIR).filter((f) => !f.endsWith('.json')).map((f) => {
      const p = path.join(DIR, f), st = fs.statSync(p);
      return { p, size: st.blocks * 512, t: st.atimeMs, stale: f.endsWith('.part') && Date.now() - st.mtimeMs > 3600e3 };
    });
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files.sort((a, b) => +b.stale - +a.stale || a.t - b.t)) {
      if (total <= CACHE_MAX && !f.stale) break;
      if (f.p.endsWith('.sparse') && locks.has(path.basename(f.p, '.sparse'))) continue;
      fs.rmSync(f.p, { force: true }); fs.rmSync(`${f.p}.json`, { force: true });
      for (const k of indexes.keys()) if (k.startsWith(`${path.basename(f.p, '.sparse')}:`)) indexes.delete(k);
      total -= f.size;
    }
  } catch { /* nothing cached yet */ }
}

// A clip's size and length, asked once per few minutes (every cut of a timeline asks).
const metas = new Map<string, { at: number; size: number; dur: number }>();
async function metaOf(account: string, id: string) {
  const hit = metas.get(id);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit;
  const meta = await (await G.gfetch(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=size,videoMediaMetadata(durationMillis)&supportsAllDrives=true`)).json() as any;
  const out = { at: Date.now(), size: Number(meta.size), dur: Number(meta.videoMediaMetadata?.durationMillis) / 1000 || 0 };
  if (out.size) metas.set(id, out);
  return out;
}

/**
 * A local file ffmpeg can cut [s, e] (seconds) from. `whole` forces a full copy; `widen` adds that many seconds on each
 * side. Returns the path and a cleanup (nothing to clean: copies stay cached for the next cut).
 */
export async function localCopy(account: string, id: string, s: number, e: number, o: { whole?: boolean; widen?: number } = {}): Promise<{ file: string; done: () => void }> {
  fs.mkdirSync(DIR, { recursive: true });
  const { size, dur } = await metaOf(account, id);
  if (!size) throw new Error('Google Drive: không đọc được kích thước video');
  // A whole copy made earlier serves every cut.
  const file = path.join(DIR, id);
  if (fs.existsSync(file) && fs.statSync(file).size === size) { fs.utimesSync(file, new Date(), new Date()); return { file, done: () => {} }; }

  if (!o.whole && size > WHOLE_MAX) {
    const w = o.widen || 0;
    let ok = true;
    await ensure(account, id, size, async (side) => {
      const list = side.boxes || [], mdat = list.find((b) => b.type === 'mdat'), moov = list.find((b) => b.type === 'moov');
      if (!mdat || !moov) { ok = false; return []; }
      return [[0, Math.min(size, 65536)], [moov.off, moov.off + moov.size]];
    });
    if (ok) {
      await ensure(account, id, size, (side) => {
        const list = side.boxes!, mdat = list.find((b) => b.type === 'mdat')!, moov = list.find((b) => b.type === 'moov')!;
        const index = indexOf(id, size, moov);
        if (index) return [spanOf(index, s - w, e + w), spanOf(index, 0, 0.3)].filter(Boolean) as [number, number][];
        if (!dur) { ok = false; return []; }
        // No readable index: estimate from the average bitrate, with a margin for the keyframe before the cut.
        const dataStart = mdat.off + mdat.head, bps = (mdat.size - mdat.head) / dur, pad = Math.max(2 * 1024 * 1024, bps * 0.5);
        return [[Math.max(dataStart, Math.floor(dataStart + Math.max(0, s - MARGIN - w) * bps - pad)), Math.min(mdat.off + mdat.size, Math.ceil(dataStart + Math.min(dur, e + MARGIN + w) * bps + pad))]];
      });
      if (ok) { trimCache(); return { file: sparse(id), done: () => {} }; }
    }
  }

  // One download per clip even when several cuts ask at once.
  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      const tmp = `${file}.${crypto.randomUUID()}.part`;
      const fd = fs.openSync(tmp, 'w');
      try { await fill(account, id, fd, [[0, size]]); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
      trimCache();
      return file;
    })().finally(() => inflight.delete(id)));
  }
  return { file: await inflight.get(id)!, done: () => {} };
}

/**
 * Cut [s, e] of a Drive clip into `out` with ffmpeg `encode` options, from a local copy. A cut from a partial copy that
 * comes out short or with decode errors is tried again a few seconds wider, then from a whole copy.
 */
export async function cutFromDrive(account: string, id: string, s: number, e: number, out: string, encode: string[]) {
  const { spawn } = await import('node:child_process');
  const { FFMPEG } = await import('./config');
  const run = (src: string) => new Promise<{ ok: boolean; log: string }>((resolve) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-y', '-ss', String(s), '-t', String(e - s), '-i', src, ...encode, out], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', (b) => (log += b));
    const timer = setTimeout(() => child.kill(), 15 * 60e3);
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, log }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
  });
  const good = (r: { ok: boolean; log: string }) => {
    if (!r.ok || /error while decoding|Invalid NAL|corrupt|non-existing PPS|Invalid data found/i.test(r.log)) return false;
    const t = [...r.log.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
    const got = t ? +t[1] * 3600 + +t[2] * 60 + +t[3] : 0;
    return got >= (e - s) - 0.4;
  };
  let r = await run((await localCopy(account, id, s, e)).file);
  if (!good(r)) r = await run((await localCopy(account, id, s, e, { widen: 3 })).file);
  if (!good(r)) {
    r = await run((await localCopy(account, id, s, e, { whole: true })).file);
    if (!r.ok) throw new Error(r.log.trim().split('\n').pop() || 'ffmpeg lỗi');
  }
}
