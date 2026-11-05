// The index of an MP4/MOV file (its moov box): for each audio and video track, when every sample plays, where its
// bytes are and which video samples are keyframes. With it a cut of [s, e] needs only the bytes from the keyframe
// before s to a little after e, instead of an estimate from the average bitrate.

export interface Track { kind: string; times: Float64Array; offsets: Float64Array; sizes: Uint32Array; sync: Set<number> | null }
type Box = { type: string; start: number; end: number };

/** The boxes directly inside buf[from, to): their type and body. */
function* kids(buf: Buffer, from: number, to: number): Generator<Box> {
  let o = from;
  while (o + 8 <= to) {
    let len = buf.readUInt32BE(o), head = 8;
    const type = buf.toString('latin1', o + 4, o + 8);
    if (len === 1) { len = Number(buf.readBigUInt64BE(o + 8)); head = 16; } else if (len === 0) len = to - o;
    if (len < head || o + len > to) return;
    yield { type, start: o + head, end: o + len };
    o += len;
  }
}
const kid = (buf: Buffer, box: Box | null, type: string) => {
  if (!box) return null;
  for (const k of kids(buf, box.start, box.end)) if (k.type === type) return k;
  return null;
};

/** One track's sample table, or null when it is not audio or video or its table is not one this reads. */
function track(buf: Buffer, trak: Box): Track | null {
  const mdia = kid(buf, trak, 'mdia'), mdhd = kid(buf, mdia, 'mdhd'), hdlr = kid(buf, mdia, 'hdlr');
  const stbl = kid(buf, kid(buf, mdia, 'minf'), 'stbl');
  if (!mdhd || !hdlr || !stbl) return null;
  const kind = buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  if (kind !== 'vide' && kind !== 'soun') return null;
  const scale = buf.readUInt32BE(mdhd.start + (buf[mdhd.start] === 1 ? 20 : 12));
  const stts = kid(buf, stbl, 'stts'), stsc = kid(buf, stbl, 'stsc'), stsz = kid(buf, stbl, 'stsz'), stss = kid(buf, stbl, 'stss');
  const stco = kid(buf, stbl, 'stco'), co64 = kid(buf, stbl, 'co64');
  if (!scale || !stts || !stsc || !stsz || !(stco || co64)) return null;

  const n = buf.readUInt32BE(stsz.start + 8), fixed = buf.readUInt32BE(stsz.start + 4);
  const sizes = new Uint32Array(n);
  for (let i = 0; i < n; i++) sizes[i] = fixed || buf.readUInt32BE(stsz.start + 12 + i * 4);

  const times = new Float64Array(n);
  let t = 0, idx = 0;
  for (let e = 0, count = buf.readUInt32BE(stts.start + 4); e < count && idx < n; e++) {
    const c = buf.readUInt32BE(stts.start + 8 + e * 8), d = buf.readUInt32BE(stts.start + 12 + e * 8);
    for (let k = 0; k < c && idx < n; k++) { times[idx++] = t / scale; t += d; }
  }

  const chunks = co64 || stco!, wide = !!co64, nChunks = buf.readUInt32BE(chunks.start + 4);
  const chunkAt = (c: number) => (wide ? Number(buf.readBigUInt64BE(chunks.start + 8 + c * 8)) : buf.readUInt32BE(chunks.start + 8 + c * 4));
  const offsets = new Float64Array(n);
  const runs = buf.readUInt32BE(stsc.start + 4);
  let sample = 0;
  for (let r = 0; r < runs && sample < n; r++) {
    const first = buf.readUInt32BE(stsc.start + 8 + r * 12), per = buf.readUInt32BE(stsc.start + 12 + r * 12);
    const next = r + 1 < runs ? buf.readUInt32BE(stsc.start + 8 + (r + 1) * 12) : nChunks + 1;
    for (let c = first; c < next && sample < n; c++) {
      let off = chunkAt(c - 1);
      for (let k = 0; k < per && sample < n; k++) { offsets[sample] = off; off += sizes[sample]; sample++; }
    }
  }

  let sync: Set<number> | null = null; // no table: every sample is a keyframe
  if (stss) {
    sync = new Set();
    for (let i = 0, count = buf.readUInt32BE(stss.start + 4); i < count; i++) sync.add(buf.readUInt32BE(stss.start + 8 + i * 4) - 1);
  }
  return { kind, times, offsets, sizes, sync };
}

/** The audio and video tracks of a moov box (the whole box, header included), or null if it cannot be read. */
export function readIndex(moov: Buffer): Track[] | null {
  try {
    const top = [...kids(moov, 0, moov.length)][0];
    if (!top || top.type !== 'moov') return null;
    const tracks = [...kids(moov, top.start, top.end)].filter((b) => b.type === 'trak').map((b) => track(moov, b)).filter(Boolean) as Track[];
    return tracks.some((t) => t.kind === 'vide') ? tracks : null;
  } catch { return null; }
}

/** First index whose time is >= t. */
function at(times: Float64Array, t: number) {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * The bytes [from, to) holding what plays in [s, e] seconds on every track: video from the keyframe before s, audio
 * from that keyframe's time too (ffmpeg seeks every track there), both a little past e. Null when nothing falls in it.
 */
export function spanOf(tracks: Track[], s: number, e: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity, start = Math.max(0, s);
  const take = (tr: Track, a: number) => {
    const b = Math.min(tr.times.length - 1, at(tr.times, e + 0.5));
    for (let i = a; i <= b; i++) { lo = Math.min(lo, tr.offsets[i]); hi = Math.max(hi, tr.offsets[i] + tr.sizes[i]); }
  };
  for (const tr of tracks.filter((t) => t.kind === 'vide' && t.times.length)) {
    let a = Math.min(tr.times.length - 1, at(tr.times, s));
    if (a > 0 && tr.times[a] > s) a--; // the frame on screen at s
    if (tr.sync) while (a > 0 && !tr.sync.has(a)) a--; // back to its keyframe
    start = Math.min(start, tr.times[a]);
    take(tr, a);
  }
  for (const tr of tracks.filter((t) => t.kind === 'soun' && t.times.length)) take(tr, Math.min(tr.times.length - 1, at(tr.times, Math.max(0, start - 0.25))));
  return lo < hi ? [lo, hi] : null;
}
