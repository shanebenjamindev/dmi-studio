// Local copies of Drive clips for ffmpeg. Letting ffmpeg read a MOV straight from Drive is slow: it issues many small
// range requests and Drive takes ~1 s to answer each (a 7 s cut can take minutes). Instead the bytes are fetched here
// with a few large parallel ranges, then ffmpeg reads a local file.
//   • Small clips (≤ 150 MB) are copied whole and kept in a cache, so proxies, exports and re-exports reuse them.
//   • Big clips get a sparse file of their full size holding only the container header, the index (moov) and the bytes
//     around the wanted seconds; offsets are unchanged, so ffmpeg reads it like the original. If a cut from it comes out
//     short or damaged the caller asks again with `whole`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';
import * as G from './google';

const DIR = path.join(DATA_DIR, 'originals');
const WHOLE_MAX = 150 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;
const PARALLEL = 6;
const CACHE_MAX = 20 * 1024 * 1024 * 1024; // trim the cache past 20 GB, oldest first
const MARGIN = 2.5; // seconds of extra bytes on each side of a partial copy (covers the keyframe before the cut)

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

/** Top-level MP4/MOV boxes (type, offset, total size, header size), read box header by box header. */
async function boxes(account: string, id: string, size: number) {
  const out: { type: string; off: number; size: number; head: number }[] = [];
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
  return { list: out, first };
}

function trimCache() {
  try {
    const files = fs.readdirSync(DIR).map((f) => { const p = path.join(DIR, f), st = fs.statSync(p); return { p, size: st.size, t: st.atimeMs }; });
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files.sort((a, b) => a.t - b.t)) { if (total <= CACHE_MAX) break; fs.rmSync(f.p, { force: true }); total -= f.size; }
  } catch { /* nothing cached yet */ }
}

/**
 * A local file ffmpeg can cut [s, e] (seconds) from. `whole` forces a full copy. Returns the path and a cleanup for
 * temporary partial copies (cached whole copies are kept).
 */
export async function localCopy(account: string, id: string, s: number, e: number, o: { whole?: boolean } = {}): Promise<{ file: string; done: () => void }> {
  fs.mkdirSync(DIR, { recursive: true });
  const meta = await (await G.gfetch(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=size,videoMediaMetadata(durationMillis)&supportsAllDrives=true`)).json() as any;
  const size = Number(meta.size), dur = Number(meta.videoMediaMetadata?.durationMillis) / 1000 || 0;
  if (!size) throw new Error('Google Drive: không đọc được kích thước video');

  if (o.whole || size <= WHOLE_MAX || !dur) {
    const file = path.join(DIR, id);
    if (fs.existsSync(file) && fs.statSync(file).size === size) { fs.utimesSync(file, new Date(), new Date()); return { file, done: () => {} }; }
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

  // Partial: header + index + the bytes for [s - MARGIN, e + MARGIN], estimated from the clip's average bitrate.
  const { list, first } = await boxes(account, id, size);
  const mdat = list.find((b) => b.type === 'mdat'), moov = list.find((b) => b.type === 'moov');
  if (!mdat || !moov) return localCopy(account, id, s, e, { whole: true });
  const dataStart = mdat.off + mdat.head, dataLen = mdat.size - mdat.head, bps = dataLen / dur;
  const pad = Math.max(2 * 1024 * 1024, bps * 0.5);
  const a = Math.max(dataStart, Math.floor(dataStart + Math.max(0, s - MARGIN) * bps - pad));
  const b = Math.min(mdat.off + mdat.size, Math.ceil(dataStart + Math.min(dur, e + MARGIN) * bps + pad));
  const file = path.join(DIR, `${id}.${crypto.randomUUID()}.sparse`);
  const fd = fs.openSync(file, 'w');
  try {
    fs.ftruncateSync(fd, size); // a hole of the full size; only the fetched parts take disk space
    fs.writeSync(fd, first, 0, first.length, 0);
    await fill(account, id, fd, [[moov.off, moov.off + moov.size], [a, b]]);
  } catch (err) { fs.closeSync(fd); fs.rmSync(file, { force: true }); throw err; }
  fs.closeSync(fd);
  return { file, done: () => fs.rmSync(file, { force: true }) };
}

/**
 * Cut [s, e] of a Drive clip into `out` with ffmpeg `encode` options, from a local copy. A cut from a partial copy that
 * comes out short or with decode errors is redone from a whole copy.
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
  let copy = await localCopy(account, id, s, e);
  try {
    let r = await run(copy.file);
    if (!good(r)) {
      copy.done();
      copy = await localCopy(account, id, s, e, { whole: true });
      r = await run(copy.file);
      if (!r.ok) throw new Error(r.log.trim().split('\n').pop() || 'ffmpeg lỗi');
    }
  } finally { copy.done(); }
}
